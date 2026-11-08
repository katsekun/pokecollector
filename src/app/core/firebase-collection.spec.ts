import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DocumentReference, type Transaction } from 'firebase/firestore';
import { Card, CollectionData, EMPTY_COLLECTION, PokemonSpecies } from './collection';
import {
  checkAndWriteChanges,
  mergeCollections,
  planCollectionMerge,
  resolveCollectionMerge,
  validateCloudData,
} from './firebase-collection';

const firestoreMock = {
  documents: new Map<string, unknown>(),
  set: vi.fn(),
  delete: vi.fn(),
  get: vi.fn(),
};
const transaction = firestoreMock as unknown as Transaction;
const reference = (change: { path: string; id: string }): DocumentReference =>
  `users/owner/${change.path}/${change.id}` as unknown as DocumentReference;

const species: readonly PokemonSpecies[] = [
  { id: 1, name: 'Bulbasaur', generation: 1 },
  { id: 25, name: 'Pikachu', generation: 1 },
];

function card(speciesId: number, id: string): Card {
  return {
    id,
    speciesId,
    name: species.find((pokemon) => pokemon.id === speciesId)!.name,
    language: 'es',
    set: 'Promo',
    number: String(speciesId),
    rarity: 'Promo',
    illustration: 'standard',
    image: null,
    source: `https://api.tcgdex.net/v2/es/cards/${id}`,
  };
}

describe('Firebase collection merge', () => {
  beforeEach(() => {
    firestoreMock.documents.clear();
    firestoreMock.set.mockReset();
    firestoreMock.delete.mockReset();
    firestoreMock.get.mockReset().mockImplementation(async (path: string) => ({
      exists: () => firestoreMock.documents.has(path),
      data: () => firestoreMock.documents.get(path),
    }));
  });
  it('checks every known document before atomically writing changed documents', async () => {
    const expected: CollectionData = {
      entries: [],
      albums: [
        { id: 'one', name: 'Cloud', speciesIds: [] },
        { id: 'untouched', name: 'Unchanged', speciesIds: [] },
      ],
    };
    const result: CollectionData = {
      entries: [],
      albums: [
        { id: 'one', name: 'Local', speciesIds: [] },
        expected.albums[1],
        { id: 'new', name: 'New', speciesIds: [] },
      ],
    };
    firestoreMock.documents.set('users/owner/albums/one', {
      speciesIds: [],
      name: 'Cloud',
      id: 'one',
    });
    firestoreMock.documents.set('users/owner/albums/untouched', expected.albums[1]);
    await checkAndWriteChanges(
      transaction,
      [
        { path: 'albums', id: 'one', previous: expected.albums[0], next: result.albums[0] },
        { path: 'albums', id: 'untouched', previous: expected.albums[1], next: result.albums[1] },
        { path: 'albums', id: 'new', previous: null, next: result.albums[2] },
      ],
      reference,
    );
    expect(firestoreMock.get).toHaveBeenCalledTimes(3);
    expect(firestoreMock.set).toHaveBeenCalledTimes(2);
    expect(firestoreMock.set).toHaveBeenCalledWith('users/owner/albums/one', result.albums[0]);
    expect(firestoreMock.set).toHaveBeenCalledWith('users/owner/albums/new', result.albums[2]);
    expect(firestoreMock.delete).not.toHaveBeenCalled();
  });
  it('does not write anything if an unchanged document was edited remotely', async () => {
    const expected: CollectionData = {
      entries: [],
      albums: [{ id: 'one', name: 'Cloud', speciesIds: [] }],
    };
    const result: CollectionData = {
      entries: [],
      albums: [
        { id: 'one', name: 'Cloud', speciesIds: [] },
        { id: 'new', name: 'New', speciesIds: [] },
      ],
    };
    firestoreMock.documents.set('users/owner/albums/one', {
      id: 'one',
      name: 'Changed',
      speciesIds: [],
    });
    await expect(
      checkAndWriteChanges(
        transaction,
        [
          { path: 'albums', id: 'one', previous: expected.albums[0], next: result.albums[0] },
          { path: 'albums', id: 'new', previous: null, next: result.albums[1] },
        ],
        reference,
      ),
    ).rejects.toThrow('La nube cambió');
    expect(firestoreMock.set).not.toHaveBeenCalled();
    expect(firestoreMock.delete).not.toHaveBeenCalled();
  });
  it('exposes differing entries and album names while preserving unrelated cards and album membership', () => {
    const local: CollectionData = {
      entries: [
        {
          speciesId: 1,
          card: card(1, 'local'),
          status: 'owned',
          paidCents: 500,
          valueCents: null,
          valuedAt: null,
        },
      ],
      albums: [{ id: 'album', name: 'Local', speciesIds: [1] }],
    };
    const cloud: CollectionData = {
      entries: [
        { ...local.entries[0], card: card(1, 'cloud'), paidCents: 1000 },
        {
          speciesId: 25,
          card: card(25, 'pikachu'),
          status: 'wanted',
          paidCents: null,
          valueCents: null,
          valuedAt: null,
        },
      ],
      albums: [{ id: 'album', name: 'Nube', speciesIds: [1, 25] }],
    };
    const plan = planCollectionMerge(local, cloud);
    expect(plan.conflicts.map((conflict) => conflict.key)).toEqual(['entry:1', 'album:album']);
    expect(() => resolveCollectionMerge(plan, {})).toThrow('Elige una versión');
    const result = resolveCollectionMerge(plan, { 'entry:1': 'local', 'album:album': 'cloud' });
    expect(result.entries).toEqual([cloud.entries[1], local.entries[0]]);
    expect(result.albums).toEqual(cloud.albums);
    expect(validateCloudData(result, species)).toEqual(result);
  });
  it('distinguishes a one-sided deletion from a deletion conflicting with an edit', () => {
    const entry = {
      speciesId: 1,
      card: card(1, 'bulbasaur'),
      status: 'owned' as const,
      paidCents: null,
      valueCents: null,
      valuedAt: null,
    };
    const baseline: CollectionData = {
      entries: [entry],
      albums: [{ id: 'album', name: 'Album', speciesIds: [1] }],
    };
    const local: CollectionData = { entries: [], albums: baseline.albums };
    const cloud: CollectionData = {
      entries: [{ ...entry, paidCents: 500 }],
      albums: baseline.albums,
    };
    const plan = planCollectionMerge(local, cloud, baseline);
    expect(plan.conflicts).toMatchObject([
      { key: 'entry:1', local: null, cloud: { paidCents: 500 } },
    ]);
    expect(resolveCollectionMerge(plan, { 'entry:1': 'local' })).toEqual({
      entries: [],
      albums: [{ id: 'album', name: 'Album', speciesIds: [] }],
    });
    expect(planCollectionMerge(local, baseline, baseline).conflicts).toEqual([]);
    expect(planCollectionMerge(local, baseline, baseline).data.entries).toEqual([]);
  });
  it('unions local and cloud entries and album members while preferring local conflicts', () => {
    const local: CollectionData = {
      entries: [
        {
          speciesId: 1,
          card: card(1, 'local-card'),
          status: 'owned',
          paidCents: 500,
          valueCents: null,
          valuedAt: null,
        },
      ],
      albums: [{ id: 'favorites', name: 'Local name', speciesIds: [1] }],
    };
    const cloud: CollectionData = {
      entries: [
        {
          speciesId: 1,
          card: card(1, 'cloud-card'),
          status: 'wanted',
          paidCents: null,
          valueCents: null,
          valuedAt: null,
        },
        {
          speciesId: 25,
          card: card(25, 'pikachu'),
          status: 'owned',
          paidCents: null,
          valueCents: null,
          valuedAt: null,
        },
      ],
      albums: [{ id: 'favorites', name: 'Cloud name', speciesIds: [25] }],
    };

    expect(mergeCollections(local, cloud)).toEqual({
      entries: [local.entries[0], cloud.entries[1]],
      albums: [{ id: 'favorites', name: 'Local name', speciesIds: [25, 1] }],
    });
  });

  it('drops album references to entries absent from the merged collection', () => {
    expect(
      mergeCollections(EMPTY_COLLECTION, {
        entries: [],
        albums: [{ id: 'empty', name: 'Empty', speciesIds: [999] }],
      }).albums[0].speciesIds,
    ).toEqual([]);
  });

  it('validates remote data against the local species catalog before accepting it', () => {
    const valid: CollectionData = {
      entries: [
        {
          speciesId: 1,
          card: card(1, 'bulbasaur'),
          status: 'wanted',
          paidCents: null,
          valueCents: null,
          valuedAt: null,
        },
      ],
      albums: [],
    };
    expect(validateCloudData(valid, species)).toEqual(valid);
    expect(() =>
      validateCloudData(
        {
          entries: [{ ...valid.entries[0], speciesId: 999, card: card(1, 'wrong-species') }],
          albums: [],
        },
        species,
      ),
    ).toThrow();
  });
});
