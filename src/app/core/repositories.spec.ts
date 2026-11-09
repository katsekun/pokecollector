import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { CollectionData } from './collection';
import { BROWSER_STORAGE, LocalCollectionRepository } from './repositories';

describe('Scoped local collections', () => {
  it('keeps guest, accounts and groups separate without overwriting legacy data', () => {
    const values = new Map<string, string>();
    TestBed.configureTestingModule({
      providers: [
        LocalCollectionRepository,
        {
          provide: BROWSER_STORAGE,
          useValue: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
          },
        },
      ],
    });
    const repository = TestBed.inject(LocalCollectionRepository);
    const original: CollectionData = {
      entries: [],
      albums: [{ id: 'original', name: 'Original', speciesIds: [] }],
    };
    repository.save(original);
    const legacy = values.get(LocalCollectionRepository.key);
    repository.save(
      { entries: [], albums: [{ id: 'group', name: 'Grupo', speciesIds: [] }] },
      'group:one',
    );
    repository.save({ entries: [], albums: [] }, 'personal:one');
    expect(repository.load([]).albums).toEqual(original.albums);
    expect(repository.load([], 'group:one').albums[0].name).toBe('Grupo');
    expect(repository.load([], 'personal:two').albums).toEqual([]);
    expect(values.get(LocalCollectionRepository.key)).toBe(legacy);
  });
});
