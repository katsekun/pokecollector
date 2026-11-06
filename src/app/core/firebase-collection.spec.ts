import { describe, expect, it } from 'vitest';
import { Card, CollectionData, EMPTY_COLLECTION, PokemonSpecies } from './collection';
import { mergeCollections, validateCloudData } from './firebase-collection';

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
