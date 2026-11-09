import { describe, expect, it } from 'vitest';
import { CollectionData } from './collection';
import { decodeGroupCollection, encodeGroupCollection } from './group-collection';

describe('Versioned group collections', () => {
  it('roundtrips multiple blocks including Unicode without changing the collection', async () => {
    const data: CollectionData = {
      entries: [],
      albums: Array.from({ length: 200 }, (_, index) => ({
        id: `album-${index}-${'x'.repeat(130)}`,
        name: 'Colección Pokémon',
        speciesIds: [],
      })),
    };
    const encoded = await encodeGroupCollection(data);
    expect(encoded.chunks.length).toBeGreaterThan(1);
    expect(await decodeGroupCollection(encoded.manifest, encoded.chunks, [])).toEqual(data);
  });
  it('rejects missing or changed blocks before loading local state', async () => {
    const encoded = await encodeGroupCollection({ entries: [], albums: [] });
    await expect(decodeGroupCollection(encoded.manifest, [], [])).rejects.toThrow('incompleta');
    await expect(decodeGroupCollection(encoded.manifest, ['changed'], [])).rejects.toThrow(
      'integridad',
    );
    await expect(
      decodeGroupCollection({ ...encoded.manifest, count: 9999 }, encoded.chunks, []),
    ).rejects.toThrow('incompleta');
  });
  it('never divides a surrogate pair between Firestore strings', async () => {
    const data: CollectionData = {
      entries: [],
      albums: Array.from({ length: 200 }, (_, index) => ({
        id: `album-${index}`,
        name: String.fromCodePoint(0x1f4da).repeat(30),
        speciesIds: [],
      })),
    };
    const encoded = await encodeGroupCollection(data);
    for (const chunk of encoded.chunks) {
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(last < 0xd800 || last > 0xdbff).toBe(true);
    }
    expect(await decodeGroupCollection(encoded.manifest, encoded.chunks, [])).toEqual(data);
  });
  it('refuses snapshots above the existing backup size limit', async () => {
    const data: CollectionData = {
      entries: [],
      albums: [{ id: 'large', name: 'x'.repeat(5_000_001), speciesIds: [] }],
    };
    await expect(encodeGroupCollection(data)).rejects.toThrow('5 MB');
  });
  it('supports valid collections above one MiB and above 450 entries', async () => {
    const species = Array.from({ length: 5000 }, (_, index) => ({
      id: index + 1,
      name: `Pokemon ${index + 1}`,
      generation: 1,
    }));
    const data: CollectionData = {
      entries: species.map((pokemon) => ({
        speciesId: pokemon.id,
        status: 'owned',
        paidCents: 100,
        valueCents: null,
        valuedAt: null,
        card: {
          id: `card-${pokemon.id}`,
          speciesId: pokemon.id,
          name: pokemon.name,
          language: 'es',
          set: 'Promo',
          number: String(pokemon.id),
          rarity: 'Promo',
          illustration: 'standard',
          image: null,
          source: `https://example.com/${'x'.repeat(500)}/${pokemon.id}`,
        },
      })),
      albums: [],
    };
    const encoded = await encodeGroupCollection(data);
    expect(encoded.manifest.bytes).toBeGreaterThan(1_048_576);
    expect(encoded.manifest.bytes).toBeLessThanOrEqual(5_000_000);
    expect(encoded.manifest.count).toBeLessThanOrEqual(313);
    expect(await decodeGroupCollection(encoded.manifest, encoded.chunks, species)).toEqual(data);
  });
});
