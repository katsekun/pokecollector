import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Card, createBackup, EMPTY_COLLECTION } from './collection';
import { CollectionStore } from './collection-store';
import {
  BROWSER_STORAGE,
  CardCatalogRepository,
  CollectionRepository,
  LocalCollectionRepository,
  StaticCardCatalogRepository,
} from './repositories';

afterEach(() => vi.unstubAllGlobals());

const species = [{ id: 1, name: 'Bulbasaur', generation: 1 }];
const card: Card = {
  id: 'a',
  speciesId: 1,
  name: 'Bulbasaur',
  language: 'en',
  set: '151',
  number: '166',
  rarity: 'Illustration Rare',
  illustration: 'illustration-rare',
  image: 'https://example.com/card.png',
  source: 'https://example.com/data',
};

describe('StaticCardCatalogRepository', () => {
  it('loads national species without requesting any local sample cards', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(species));
    vi.stubGlobal('fetch', fetchMock);
    const catalog = await new StaticCardCatalogRepository().load();
    expect(catalog).toEqual({ species, cards: [] });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('data/pokemon-species.json');
  });
});

describe('CollectionStore', () => {
  const repository = { load: vi.fn(() => EMPTY_COLLECTION), save: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    repository.load.mockReturnValue(EMPTY_COLLECTION);
    TestBed.configureTestingModule({
      providers: [
        CollectionStore,
        {
          provide: CardCatalogRepository,
          useValue: { load: async () => ({ species, cards: [card] }) },
        },
        { provide: CollectionRepository, useValue: repository },
      ],
    });
  });

  it('orders generation progress numerically without changing totals or species order', async () => {
    const generations = [6, 8, 1, 9, 2, 5, 7, 4, 3, 1];
    TestBed.overrideProvider(CardCatalogRepository, {
      useValue: {
        load: async () => ({
          species: generations.map((generation, index) => ({
            id: index + 1,
            name: `Pokemon ${index + 1}`,
            generation,
          })),
          cards: [],
        }),
      },
    });
    const store = TestBed.inject(CollectionStore);
    await store.initialize();
    store.selectCard({ ...card, speciesId: 3 }, 'owned');
    expect(store._generations().map((generation) => generation.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(store._generations()[0]).toMatchObject({ id: 1, total: 2, owned: 1 });
    expect(
      store
        ._generations()
        .slice(1)
        .every((generation) => generation.total === 1),
    ).toBe(true);
    expect(store._allSpecies().map((pokemon) => pokemon.generation)).toEqual(generations);
  });

  it('only publishes changes after successful persistence', async () => {
    const store = TestBed.inject(CollectionStore);
    await store.initialize();
    repository.save.mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(store.selectCard(card)).toBe(false);
    expect(store._entries()).toEqual([]);
    expect(store._notice()).toContain('No se pudo guardar');
  });
  it('loads the target scope before switching and keeps the current scope on read failure', async () => {
    const store = TestBed.inject(CollectionStore);
    await store.initialize();
    store.selectCard(card);
    repository.load.mockReturnValue({
      entries: [],
      albums: [{ id: 'group', name: 'Group', speciesIds: [] }],
    });
    expect(store.switchScope('group:one')).toBe(true);
    expect(store._scope()).toBe('group:one');
    expect(store._entries()).toEqual([]);
    store.saveAlbum('Another');
    expect(repository.save.mock.calls.at(-1)?.[1]).toBe('group:one');
    repository.load.mockImplementation(() => {
      throw new Error('Corrupt');
    });
    expect(store.switchScope('personal:one')).toBe(false);
    expect(store._scope()).toBe('group:one');
    expect(store._albums()).toHaveLength(2);
  });
  it('hides the previous account on a failed account switch without overwriting either stored copy', async () => {
    const store = TestBed.inject(CollectionStore);
    await store.initialize();
    store.selectCard(card);
    repository.save.mockClear();
    repository.load.mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    expect(store.switchScope('personal:another', true)).toBe(false);
    expect(store._scope()).toBe('personal:another');
    expect(store._entries()).toEqual([]);
    expect(store._storageBlocked()).toBe(true);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('persists selections, prices and albums without duplicate inventory', async () => {
    const store = TestBed.inject(CollectionStore);
    await store.initialize();
    store.selectCard(card);
    store.setStatus(1, 'owned');
    store.updateEntry(1, { paidCents: 0, valueCents: 1500, valuedAt: new Date().toISOString() });
    store.saveAlbum('Kanto');
    const album = store._albums()[0];
    store.toggleAlbumMember(album.id, 1);
    expect(store._progress().owned).toBe(1);
    expect(store._totals()).toMatchObject({ paid: 0, value: 1500, paidKnown: 1, valueKnown: 1 });
    store.deleteAlbum(album.id);
    expect(store._entries()).toHaveLength(1);
    expect(store.restore(store.exportJson())).toBe(true);
  });

  it('protects corrupt persisted data until explicit validated restore', async () => {
    repository.load.mockImplementation(() => {
      throw new Error('Corrupt');
    });
    const store = TestBed.inject(CollectionStore);
    await store.initialize();
    expect(store._storageBlocked()).toBe(true);
    expect(store.selectCard(card)).toBe(false);
    expect(repository.save).not.toHaveBeenCalled();
    expect(store.restore(JSON.stringify(createBackup(EMPTY_COLLECTION)))).toBe(true);
    expect(store._storageBlocked()).toBe(false);
  });

  it('rejects invalid restore without changing existing collection', async () => {
    const store = TestBed.inject(CollectionStore);
    await store.initialize();
    store.selectCard(card);
    const before = store._collection();
    expect(store.restore('{bad json')).toBe(false);
    expect(store._collection()).toBe(before);
  });

  it('reassigns an ambiguous migrated card without losing prices or album memberships', async () => {
    TestBed.overrideProvider(CardCatalogRepository, {
      useValue: {
        load: async () => ({
          species: [
            { id: 1, name: 'Bulbasaur', generation: 1 },
            { id: 110001, nationalId: 1, name: 'Otra forma', generation: 6 },
          ],
          cards: [],
        }),
      },
    });
    repository.load.mockReturnValue({
      entries: [
        {
          speciesId: 1,
          card,
          status: 'owned',
          paidCents: 500,
          valueCents: null,
          valuedAt: null,
          needsFormReview: true,
        },
      ],
      albums: [{ id: 'a', name: 'Favoritas', speciesIds: [1] }],
    });
    const store = TestBed.inject(CollectionStore);
    await store.initialize();
    expect(store.selectCard({ ...card, speciesId: 110001, nationalId: 1 })).toBe(true);
    expect(store._entries()).toHaveLength(1);
    expect(store._entries()[0]).toMatchObject({
      speciesId: 110001,
      paidCents: 500,
      status: 'owned',
      needsFormReview: false,
    });
    expect(store._albums()[0].speciesIds).toEqual([110001]);
  });
});

describe('LocalCollectionRepository', () => {
  it('roundtrips data and does not erase malformed saved content', () => {
    const storage = { getItem: vi.fn(() => null as string | null), setItem: vi.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: BROWSER_STORAGE, useValue: storage }],
    });
    const repository = TestBed.inject(LocalCollectionRepository);
    expect(repository.load(species)).toEqual(EMPTY_COLLECTION);
    repository.save(EMPTY_COLLECTION);
    storage.getItem.mockReturnValue(storage.setItem.mock.calls[0][1]);
    expect(repository.load(species).entries).toEqual([]);
    storage.getItem.mockReturnValue('broken');
    expect(() => repository.load(species)).toThrow();
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('reports blocked browser storage', () => {
    TestBed.configureTestingModule({ providers: [{ provide: BROWSER_STORAGE, useValue: null }] });
    const repository = TestBed.inject(LocalCollectionRepository);
    expect(() => repository.load(species)).toThrow();
    expect(() => repository.save(EMPTY_COLLECTION)).toThrow();
  });
});
