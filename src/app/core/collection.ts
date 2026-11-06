import {
  array,
  boolean,
  enum as enumeration,
  iso,
  literal,
  number,
  object,
  string,
  url,
  type infer as Infer,
} from 'zod';
import { findCardForm, nationalNumber } from './pokemon-forms';

const identifier = string().trim().min(1).max(160);
const money = number().int().min(0).max(100_000_000);
const httpsUrl = url().refine((value) => new URL(value).protocol === 'https:');

export const speciesSchema = object({
  id: number().int().positive(),
  nationalId: number().int().positive().optional(),
  form: string().optional(),
  formName: string().optional(),
  isDefault: boolean().optional(),
  aliases: array(string()).optional(),
  formNames: array(string()).optional(),
  name: string().min(1),
  generation: number().int().min(1).max(20),
});

export const cardSchema = object({
  id: identifier,
  speciesId: number().int().positive(),
  nationalId: number().int().positive().optional(),
  requiresFormConfirmation: boolean().optional(),
  name: identifier,
  language: string().min(2).max(12),
  set: identifier,
  number: identifier,
  rarity: identifier,
  illustration: enumeration([
    'standard',
    'full-art',
    'illustration-rare',
    'special-illustration-rare',
  ]),
  image: httpsUrl.nullable(),
  imageProvider: enumeration(['tcgdex', 'tcgplayer']).optional(),
  imageLanguage: string().min(2).max(12).optional(),
  source: httpsUrl,
});

export const entrySchema = object({
  speciesId: number().int().positive(),
  card: cardSchema,
  status: enumeration(['wanted', 'owned']),
  needsFormReview: boolean().optional(),
  paidCents: money.nullable(),
  valueCents: money.nullable(),
  valuedAt: iso.datetime().nullable(),
});

export const albumSchema = object({
  id: identifier,
  name: string().trim().min(1).max(60),
  speciesIds: array(number().int().positive()).max(5000),
});

export const backupSchema = object({
  schemaVersion: literal(1).or(literal(2)),
  exportedAt: iso.datetime(),
  currency: literal('EUR'),
  entries: array(entrySchema).max(5000),
  albums: array(albumSchema).max(200),
});

export type PokemonSpecies = Readonly<Infer<typeof speciesSchema>>;
export type Card = Readonly<Infer<typeof cardSchema>>;
export type CollectionEntry = Readonly<Infer<typeof entrySchema>>;
export type Album = Readonly<Infer<typeof albumSchema>>;
export type CollectionBackup = Readonly<Infer<typeof backupSchema>>;
export type CollectionData = Pick<CollectionBackup, 'entries' | 'albums'>;
export type CollectionStatus = CollectionEntry['status'];

export const EMPTY_COLLECTION: CollectionData = { entries: [], albums: [] };
export const ILLUSTRATION_LABELS: Record<Card['illustration'], string> = {
  standard: 'Clásica',
  'full-art': 'Full Art',
  'illustration-rare': 'Illustration Rare',
  'special-illustration-rare': 'Special Illustration Rare',
};

function migrateLegacyBackup(
  backup: CollectionBackup,
  species: readonly PokemonSpecies[],
): CollectionBackup {
  if (backup.schemaVersion !== 1) return backup;
  const remapping = new Map<number, number>();
  const entries = backup.entries.map((entry) => {
    const previous = species.find((pokemon) => pokemon.id === entry.speciesId);
    if (!previous || entry.card.speciesId !== entry.speciesId)
      throw new Error('Referencia antigua no válida.');
    const siblings = species.filter(
      (pokemon) => nationalNumber(pokemon) === nationalNumber(previous),
    );
    const matched = findCardForm(entry.card.name, siblings);
    const target = matched ?? previous;
    remapping.set(entry.speciesId, target.id);
    return {
      ...entry,
      speciesId: target.id,
      ...(siblings.length > 1 && !matched ? { needsFormReview: true } : {}),
      card: { ...entry.card, speciesId: target.id, nationalId: nationalNumber(target) },
    };
  });
  return {
    ...backup,
    schemaVersion: 2,
    entries,
    albums: backup.albums.map((album) => ({
      ...album,
      speciesIds: album.speciesIds.map((id) => remapping.get(id) ?? id),
    })),
  };
}

function validateEntry(entry: CollectionEntry, species: ReadonlyMap<number, PokemonSpecies>): void {
  const pokemon = species.get(entry.speciesId);
  if (!pokemon || entry.card.speciesId !== entry.speciesId) {
    throw new Error('Una carta no corresponde a una entrada válida de esta Pokédex.');
  }
  if (entry.card.nationalId !== undefined && entry.card.nationalId !== nationalNumber(pokemon)) {
    throw new Error('El número nacional no corresponde a la forma elegida.');
  }
  if ((entry.valueCents === null) !== (entry.valuedAt === null)) {
    throw new Error('La valoración y su fecha deben estar presentes juntas.');
  }
}

export function parseBackup(text: string, species: readonly PokemonSpecies[]): CollectionBackup {
  if (new TextEncoder().encode(text).length > 5_000_000) {
    throw new Error('El archivo supera el límite de 5 MB.');
  }
  const parsed = backupSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error('Formato de respaldo no válido o versión no compatible.');
  }
  if (
    new Set(parsed.data.entries.map((entry) => entry.speciesId)).size !== parsed.data.entries.length
  ) {
    throw new Error('El respaldo contiene selecciones duplicadas.');
  }
  const backup = migrateLegacyBackup(parsed.data, species);
  const speciesById = new Map(species.map((pokemon) => [pokemon.id, pokemon]));
  const entryIds = new Set(backup.entries.map((entry) => entry.speciesId));
  if (entryIds.size !== backup.entries.length) {
    throw new Error('El respaldo contiene más de una carta para un Pokémon.');
  }
  for (const entry of backup.entries) validateEntry(entry, speciesById);
  if (new Set(backup.albums.map((album) => album.id)).size !== backup.albums.length) {
    throw new Error('El respaldo contiene álbumes duplicados.');
  }
  for (const album of backup.albums) {
    if (
      new Set(album.speciesIds).size !== album.speciesIds.length ||
      album.speciesIds.some((speciesId) => !entryIds.has(speciesId))
    ) {
      throw new Error('Un álbum contiene referencias duplicadas o sin carta elegida.');
    }
  }
  return backup;
}

export function createBackup(data: CollectionData): CollectionBackup {
  return {
    schemaVersion: 2,
    currency: 'EUR',
    exportedAt: new Date().toISOString(),
    entries: data.entries,
    albums: data.albums,
  };
}

export function chooseCard(data: CollectionData, card: Card): CollectionData {
  const current = data.entries.find((entry) => entry.speciesId === card.speciesId);
  if (current?.card.id === card.id) {
    return current.needsFormReview
      ? {
          ...data,
          entries: data.entries.map((entry) =>
            entry === current ? { ...entry, card, needsFormReview: false } : entry,
          ),
        }
      : data;
  }
  const entry: CollectionEntry = {
    speciesId: card.speciesId,
    card,
    status: 'wanted',
    paidCents: null,
    valueCents: null,
    valuedAt: null,
  };
  return {
    ...data,
    entries: [...data.entries.filter((item) => item.speciesId !== card.speciesId), entry],
  };
}

export function removeSelection(data: CollectionData, speciesId: number): CollectionData {
  return {
    entries: data.entries.filter((entry) => entry.speciesId !== speciesId),
    albums: data.albums.map((album) => ({
      ...album,
      speciesIds: album.speciesIds.filter((member) => member !== speciesId),
    })),
  };
}

export function collectionProgress(
  entries: readonly CollectionEntry[],
  species: readonly PokemonSpecies[],
) {
  const owned = new Set(
    entries
      .filter((entry) => entry.status === 'owned' && !entry.needsFormReview)
      .map((entry) => entry.speciesId),
  );
  const count = species.filter((pokemon) => owned.has(pokemon.id)).length;
  return {
    owned: count,
    total: species.length,
    percent: species.length ? (count / species.length) * 100 : 0,
  };
}

export function parseEuroInput(value: string): number | null {
  if (!value.trim()) return null;
  const normalized = value.trim().replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Introduce un importe positivo con un máximo de dos decimales.');
  }
  const cents = Math.round(Number(normalized) * 100);
  if (!money.safeParse(cents).success) throw new Error('El importe supera el límite permitido.');
  return cents;
}
