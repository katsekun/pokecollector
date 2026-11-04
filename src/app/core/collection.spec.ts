import { describe, expect, it } from 'vitest';
import {
  Card,
  chooseCard,
  collectionProgress,
  createBackup,
  EMPTY_COLLECTION,
  parseBackup,
  parseEuroInput,
  removeSelection,
} from './collection';

const species = [
  { id: 1, name: 'Bulbasaur', generation: 1 },
  { id: 2, name: 'Ivysaur', generation: 1 },
];
const card: Card = {
  id: 'sv3pt5-166',
  speciesId: 1,
  name: 'Bulbasaur',
  language: 'en',
  set: '151',
  number: '166',
  rarity: 'Illustration Rare',
  illustration: 'illustration-rare',
  image: 'https://images.pokemontcg.io/sv3pt5/166_hires.png',
  source: 'https://github.com/PokemonTCG/pokemon-tcg-data',
};

describe('Collection rules', () => {
  it('starts empty and wanted cards do not count as owned', () => {
    expect(collectionProgress([], species).percent).toBe(0);
    expect(collectionProgress(chooseCard(EMPTY_COLLECTION, card).entries, species).owned).toBe(0);
  });

  it('counts each entry once', () => {
    const data = chooseCard(EMPTY_COLLECTION, card);
    const owned = data.entries.map((entry) => ({ ...entry, status: 'owned' as const }));
    expect(collectionProgress([...owned, ...owned], species)).toEqual({
      owned: 1,
      total: 2,
      percent: 50,
    });
  });

  it('replaces a card without inheriting possession or money', () => {
    const selected = chooseCard(EMPTY_COLLECTION, card);
    const data = {
      ...selected,
      entries: selected.entries.map((entry) => ({
        ...entry,
        status: 'owned' as const,
        paidCents: 500,
      })),
    };
    const replaced = chooseCard(data, { ...card, id: 'another-card' });
    expect(replaced.entries).toHaveLength(1);
    expect(replaced.entries[0]).toMatchObject({ status: 'wanted', paidCents: null });
    expect(chooseCard(replaced, replaced.entries[0].card)).toBe(replaced);
  });

  it('removes album references when a selection is removed', () => {
    const data = {
      ...chooseCard(EMPTY_COLLECTION, card),
      albums: [{ id: 'album', name: 'Favoritas', speciesIds: [1] }],
    };
    expect(removeSelection(data, 1)).toEqual({
      entries: [],
      albums: [{ id: 'album', name: 'Favoritas', speciesIds: [] }],
    });
  });

  it('roundtrips complete backups, including portable card snapshots', () => {
    const backup = createBackup(chooseCard(EMPTY_COLLECTION, card));
    expect(parseBackup(JSON.stringify(backup), species)).toEqual(backup);
  });

  it('creates a new export timestamp instead of inheriting loaded backup metadata', () => {
    const loaded = { ...createBackup(EMPTY_COLLECTION), exportedAt: '2000-01-01T00:00:00.000Z' };
    expect(createBackup(loaded).exportedAt).not.toBe(loaded.exportedAt);
  });

  it('rejects duplicate selections, wrong species, broken albums and unsafe URLs', () => {
    const backup = createBackup(chooseCard(EMPTY_COLLECTION, card));
    expect(() =>
      parseBackup(
        JSON.stringify({ ...backup, entries: [...backup.entries, ...backup.entries] }),
        species,
      ),
    ).toThrow();
    expect(() => parseBackup(JSON.stringify(backup), [])).toThrow();
    expect(() =>
      parseBackup(
        JSON.stringify({ ...backup, albums: [{ id: 'a', name: 'A', speciesIds: [2] }] }),
        species,
      ),
    ).toThrow();
    const invalid = {
      ...backup,
      entries: [{ ...backup.entries[0], card: { ...card, image: 'javascript:alert(1)' } }],
    };
    expect(() => parseBackup(JSON.stringify(invalid), species)).toThrow();
  });

  it('rejects truncated files, unknown versions and inconsistent valuations', () => {
    const backup = createBackup(chooseCard(EMPTY_COLLECTION, card));
    expect(() => parseBackup('{', species)).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...backup, schemaVersion: 3 }), species)).toThrow();
    expect(() =>
      parseBackup(
        JSON.stringify({ ...backup, entries: [{ ...backup.entries[0], valueCents: 100 }] }),
        species,
      ),
    ).toThrow();
  });

  it('accepts zero, decimal commas and absent money; rejects negatives and fractions of cents', () => {
    expect(parseEuroInput('0')).toBe(0);
    expect(parseEuroInput('12,34')).toBe(1234);
    expect(parseEuroInput('')).toBeNull();
    expect(() => parseEuroInput('-1')).toThrow();
    expect(() => parseEuroInput('1.234')).toThrow();
  });

  it('keeps two regional forms of the same national number as independent selections', () => {
    const forms = [
      { id: 52, nationalId: 52, name: 'Meowth', generation: 1 },
      { id: 110320, nationalId: 52, name: 'Meowth de Galar', generation: 8 },
    ];
    const normal = { ...card, id: 'normal', speciesId: 52, nationalId: 52 };
    const galar = { ...card, id: 'galar', speciesId: 110320, nationalId: 52 };
    const data = chooseCard(chooseCard(EMPTY_COLLECTION, normal), galar);
    expect(data.entries).toHaveLength(2);
    expect(
      collectionProgress(
        data.entries.map((entry) => ({ ...entry, status: 'owned' })),
        forms,
      ),
    ).toMatchObject({ owned: 2, total: 2 });
    expect(parseBackup(JSON.stringify(createBackup(data)), forms).entries).toHaveLength(2);
  });

  it('migrates a regional v1 card and album references without losing money', () => {
    const forms = [
      { id: 52, nationalId: 52, name: 'Meowth', generation: 1, aliases: ['Meowth'] },
      {
        id: 110320,
        nationalId: 52,
        name: 'Meowth de Galar',
        generation: 8,
        aliases: ['Galarian Meowth'],
      },
    ];
    const legacy = {
      ...createBackup(
        chooseCard(EMPTY_COLLECTION, { ...card, speciesId: 52, name: 'Galarian Meowth' }),
      ),
      schemaVersion: 1,
    };
    legacy.entries[0] = { ...legacy.entries[0], paidCents: 1234, status: 'owned' };
    legacy.albums = [{ id: 'a', name: 'Favoritas', speciesIds: [52] }];
    const migrated = parseBackup(JSON.stringify(legacy), forms);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.entries[0]).toMatchObject({
      speciesId: 110320,
      paidCents: 1234,
      status: 'owned',
    });
    expect(migrated.albums[0].speciesIds).toEqual([110320]);
  });

  it('preserves ambiguous legacy selections for review without falsely completing a form', () => {
    const forms = [
      { id: 6, nationalId: 6, name: 'Charizard', generation: 1 },
      { id: 110134, nationalId: 6, name: 'Mega Charizard X', generation: 6 },
    ];
    const legacy = {
      ...createBackup(
        chooseCard(EMPTY_COLLECTION, { ...card, speciesId: 6, name: 'M Charizard EX' }),
      ),
      schemaVersion: 1,
    };
    legacy.entries[0] = { ...legacy.entries[0], status: 'owned', paidCents: 500 };
    const migrated = parseBackup(JSON.stringify(legacy), forms);
    expect(migrated.entries[0]).toMatchObject({ needsFormReview: true, paidCents: 500 });
    expect(collectionProgress(migrated.entries, forms).owned).toBe(0);
  });
});
