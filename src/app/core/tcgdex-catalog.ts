import { Injectable, signal } from '@angular/core';
import { array, number, object, string, union } from 'zod';
import { Card, cardSchema, PokemonSpecies } from './collection';
import { findCardForm, nationalNumber } from './pokemon-forms';

export const TCGDEX_LANGUAGES = [
  { id: 'es', name: 'Español' },
  { id: 'en', name: 'Inglés' },
  { id: 'ja', name: 'Japonés' },
  { id: 'fr', name: 'Francés' },
  { id: 'de', name: 'Alemán' },
  { id: 'it', name: 'Italiano' },
  { id: 'pt', name: 'Portugués (Brasil)' },
  { id: 'zh-tw', name: 'Chino (Taiwán)' },
  { id: 'id', name: 'Bahasa Indonesia' },
  { id: 'th', name: 'ไทย' },
] as const;
export type TcgdexLanguage = (typeof TCGDEX_LANGUAGES)[number]['id'];

const briefSchema = object({ id: string().regex(/^[a-zA-Z0-9.-]+$/) });
const pocketSetIds = new Set([
  'P-A',
  'A1',
  'A1a',
  'A2',
  'A2a',
  'A2b',
  'A3',
  'A3a',
  'A3b',
  'A4',
  'A4a',
  'B1',
  'B1a',
  'B2',
  'B2a',
]);
const detailSchema = object({
  id: string(),
  name: string(),
  localId: union([string(), number()]),
  dexId: array(number()).optional(),
  image: string().nullish(),
  rarity: string().optional(),
  set: object({ id: string(), name: string() }),
  variants_detailed: array(
    object({
      thirdParty: object({
        tcgplayer: number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
      }).optional(),
    }),
  )
    .optional()
    .catch(undefined),
});

export interface TcgdexPage {
  readonly cards: readonly Card[];
  readonly hasMore: boolean;
  readonly omitted: number;
}

export interface TcgdexFormPage extends TcgdexPage {
  readonly unverified: readonly Card[];
}

export function tcgdexIllustration(rarity: string, setId = ''): Card['illustration'] {
  const normalized = rarity
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (
    ['special illustration rare', 'special art rare', 'rara ilustracion especial', 'sar'].includes(
      normalized,
    )
  )
    return 'special-illustration-rare';
  if (['illustration rare', 'rara ilustracion', 'art rare', 'ar'].includes(normalized))
    return 'illustration-rare';
  if (
    normalized === 'full art' ||
    (setId.startsWith('sv') && ['ultra rare', 'rare ultra', 'rara ultra'].includes(normalized))
  )
    return 'full-art';
  return 'standard';
}

function isPocketCard(setId: string, image?: string | null): boolean {
  const url = image && URL.canParse(image) ? new URL(image) : null;
  return pocketSetIds.has(setId) || !!url?.pathname.includes('/tcgp/');
}

export function mapTcgdexCard(
  raw: unknown,
  speciesId: number,
  language: TcgdexLanguage,
): Card | null {
  const detail = detailSchema.parse(raw);
  if (isPocketCard(detail.set.id, detail.image) || !detail.dexId?.includes(speciesId)) return null;
  let imageUrl: string | null = null;
  if (detail.image && URL.canParse(detail.image)) {
    const image = new URL(detail.image);
    if (image.protocol === 'https:' && image.hostname === 'assets.tcgdex.net')
      imageUrl = `${image.href.replace(/\/$/, '')}/high.webp`;
  }
  const rarity = detail.rarity ?? 'Sin especificar';
  return cardSchema.parse({
    id: `tcgdex:${language}:${detail.id}`,
    speciesId,
    name: detail.name,
    language,
    set: detail.set.name,
    number: String(detail.localId),
    rarity,
    illustration: tcgdexIllustration(rarity, detail.set.id),
    image: imageUrl,
    ...(imageUrl ? { imageProvider: 'tcgdex', imageLanguage: language } : {}),
    source: `https://api.tcgdex.net/v2/${language}/cards/${encodeURIComponent(detail.id)}`,
  });
}

@Injectable({ providedIn: 'root' })
export class TcgdexCatalog {
  public static readonly pageSize = 48;
  public readonly _allowTcgplayer = signal(true);
  private readonly cache = new Map<string, { expires: number; result: Promise<TcgdexPage> }>();
  private readonly detailCache = new Map<string, { expires: number; result: Promise<unknown> }>();
  private readonly recoveryCache = new Map<string, { expires: number; result: Promise<Card> }>();
  private activeDetailRequests = 0;
  private readonly detailQueue: (() => void)[] = [];

  public recoverImage(card: Card, failedImages: readonly string[]): Promise<Card> {
    const allowTcgplayer = this._allowTcgplayer();
    const key = JSON.stringify([
      card.id,
      card.source,
      card.speciesId,
      card.nationalId,
      allowTcgplayer,
      failedImages,
    ]);
    const cached = this.recoveryCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    const result = this.recoverCardImage(card, failedImages, allowTcgplayer);
    this.recoveryCache.set(key, { expires: Date.now() + 10 * 60_000, result });
    return result;
  }

  private async recoverCardImage(
    card: Card,
    failedImages: readonly string[],
    allowTcgplayer: boolean,
  ): Promise<Card> {
    const withoutImage: Card = {
      ...card,
      image: null,
      imageProvider: undefined,
      imageLanguage: undefined,
    };
    const language = TCGDEX_LANGUAGES.find((candidate) => candidate.id === card.language)?.id;
    if (!language || !URL.canParse(card.source)) return withoutImage;
    const source = new URL(card.source);
    if (
      source.origin !== 'https://api.tcgdex.net' ||
      !source.pathname.startsWith(`/v2/${language}/cards/`)
    )
      return withoutImage;
    try {
      const detail = detailSchema.parse(await this.readDetail(source.href, 5_000));
      const mapped = mapTcgdexCard(detail, card.nationalId ?? card.speciesId, language);
      if (mapped?.id !== card.id || String(detail.localId) !== card.number) return withoutImage;
      if (mapped.image && !failedImages.includes(mapped.image))
        return { ...card, image: mapped.image, imageProvider: 'tcgdex', imageLanguage: language };
      return await this.resolveImage(withoutImage, detail, allowTcgplayer, failedImages);
    } catch {
      return withoutImage;
    }
  }

  public async searchForm(
    pokemon: PokemonSpecies,
    forms: readonly PokemonSpecies[],
    language: TcgdexLanguage,
    page = 1,
  ): Promise<TcgdexFormPage> {
    const nationalId = nationalNumber(pokemon);
    const result = await this.search(nationalId, language, page);
    const siblings = forms.filter((form) => nationalNumber(form) === nationalId);
    const cards: Card[] = [];
    const unverified: Card[] = [];
    let otherForms = 0;
    for (const card of result.cards) {
      const matched = findCardForm(card.name, siblings);
      const candidate = { ...card, speciesId: pokemon.id, nationalId };
      if (matched?.id === pokemon.id) cards.push(candidate);
      else if (!matched) unverified.push({ ...candidate, requiresFormConfirmation: true });
      else otherForms += 1;
    }
    return { ...result, cards, unverified, omitted: result.omitted + otherForms };
  }

  public search(speciesId: number, language: TcgdexLanguage, page = 1): Promise<TcgdexPage> {
    if (
      !Number.isInteger(speciesId) ||
      speciesId < 1 ||
      !Number.isInteger(page) ||
      page < 1 ||
      !TCGDEX_LANGUAGES.some((item) => item.id === language)
    ) {
      return Promise.reject(new Error('Consulta de catálogo no válida.'));
    }
    const allowTcgplayer = this._allowTcgplayer();
    const key = `${language}:${speciesId}:${page}:${allowTcgplayer}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    const result = this.fetchPage(speciesId, language, page, allowTcgplayer).catch(
      (error: unknown) => {
        this.cache.delete(key);
        throw error;
      },
    );
    this.cache.set(key, { expires: Date.now() + 10 * 60_000, result });
    return result;
  }

  private async readJson(url: string, timeout = 15_000): Promise<unknown> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      credentials: 'omit',
    });
    if (!response.ok) throw new Error('TCGdex no está disponible. Inténtalo de nuevo más tarde.');
    return response.json();
  }

  private readDetail(url: string, timeout = 15_000): Promise<unknown> {
    const cached = this.detailCache.get(url);
    if (cached && cached.expires > Date.now()) return cached.result;
    const result = this.fetchDetail(url, timeout).catch((error: unknown) => {
      this.detailCache.delete(url);
      throw error;
    });
    this.detailCache.set(url, { expires: Date.now() + 10 * 60_000, result });
    return result;
  }

  private async fetchDetail(url: string, timeout: number): Promise<unknown> {
    await new Promise<void>((resolve) => {
      const start = (): void => {
        this.activeDetailRequests += 1;
        resolve();
      };
      if (this.activeDetailRequests < 3) start();
      else this.detailQueue.push(start);
    });
    try {
      return await this.readJson(url, timeout);
    } finally {
      this.activeDetailRequests -= 1;
      this.detailQueue.shift()?.();
    }
  }

  private async resolveImage(
    card: Card,
    detail: ReturnType<typeof detailSchema.parse>,
    allowTcgplayer: boolean,
    failedImages: readonly string[] = [],
  ): Promise<Card> {
    for (const language of ['en', 'fr'] as const) {
      if (language === card.language) continue;
      try {
        const alternative = detailSchema.parse(
          await this.readDetail(
            `https://api.tcgdex.net/v2/${language}/cards/${encodeURIComponent(detail.id)}`,
            5_000,
          ),
        );
        if (
          alternative.id !== detail.id ||
          alternative.set.id !== detail.set.id ||
          String(alternative.localId) !== String(detail.localId)
        )
          continue;
        const mapped = mapTcgdexCard(alternative, card.nationalId ?? card.speciesId, language);
        if (mapped?.image && !failedImages.includes(mapped.image))
          return { ...card, image: mapped.image, imageProvider: 'tcgdex', imageLanguage: language };
      } catch {
        continue;
      }
    }
    const productId = detail.variants_detailed?.find(
      (variant) => variant.thirdParty?.tcgplayer !== undefined,
    )?.thirdParty?.tcgplayer;
    const marketplaceImage =
      productId === undefined
        ? null
        : `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;
    return allowTcgplayer && marketplaceImage && !failedImages.includes(marketplaceImage)
      ? {
          ...card,
          image: marketplaceImage,
          imageProvider: 'tcgplayer',
        }
      : card;
  }

  private async fetchPage(
    speciesId: number,
    language: TcgdexLanguage,
    page: number,
    allowTcgplayer: boolean,
  ): Promise<TcgdexPage> {
    const base = `https://api.tcgdex.net/v2/${language}/cards`;
    const url = new URL(base);
    url.searchParams.set('dexId', `eq:${speciesId}`);
    url.searchParams.set('pagination:page', String(page));
    url.searchParams.set('pagination:itemsPerPage', String(TcgdexCatalog.pageSize));
    const briefs = array(briefSchema).parse(await this.readJson(url.href));
    const cards: Card[] = [];
    let pocketCards = 0;
    const queue = [...briefs];
    const next = async (): Promise<void> => {
      const brief = queue.shift();
      if (!brief) return;
      const raw = detailSchema.parse(
        await this.readDetail(`${base}/${encodeURIComponent(brief.id)}`),
      );
      if (isPocketCard(raw.set.id, raw.image)) {
        pocketCards += 1;
        return next();
      }
      const card = mapTcgdexCard(raw, speciesId, language);
      if (card) cards.push(card.image ? card : await this.resolveImage(card, raw, allowTcgplayer));
      return next();
    };
    await Promise.all(Array.from({ length: 3 }, () => next()));
    const unique = [...new Map(cards.map((card) => [card.id, card])).values()];
    return {
      cards: unique,
      hasMore: briefs.length === TcgdexCatalog.pageSize,
      omitted: briefs.length - cards.length - pocketCards,
    };
  }
}
