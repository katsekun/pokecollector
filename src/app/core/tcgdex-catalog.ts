import { Injectable } from '@angular/core';
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
  if (imageUrl === null) {
    const productId = detail.variants_detailed?.find(
      (variant) => variant.thirdParty?.tcgplayer !== undefined,
    )?.thirdParty?.tcgplayer;
    if (productId !== undefined)
      imageUrl = `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`;
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
    source: `https://api.tcgdex.net/v2/${language}/cards/${encodeURIComponent(detail.id)}`,
  });
}

@Injectable({ providedIn: 'root' })
export class TcgdexCatalog {
  public static readonly pageSize = 48;
  private readonly cache = new Map<string, { expires: number; result: Promise<TcgdexPage> }>();

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
    const key = `${language}:${speciesId}:${page}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    const result = this.fetchPage(speciesId, language, page).catch((error: unknown) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, { expires: Date.now() + 10 * 60_000, result });
    return result;
  }

  private async readJson(url: string): Promise<unknown> {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), credentials: 'omit' });
    if (!response.ok) throw new Error('TCGdex no está disponible. Inténtalo de nuevo más tarde.');
    return response.json();
  }

  private async fetchPage(
    speciesId: number,
    language: TcgdexLanguage,
    page: number,
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
        await this.readJson(`${base}/${encodeURIComponent(brief.id)}`),
      );
      if (isPocketCard(raw.set.id, raw.image)) {
        pocketCards += 1;
        return next();
      }
      const card = mapTcgdexCard(raw, speciesId, language);
      if (card) cards.push(card);
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
