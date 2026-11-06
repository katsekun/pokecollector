import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectionData, EMPTY_COLLECTION } from './collection';
import { CollectionStore } from './collection-store';
import { FirebaseAuthService } from './firebase-auth';
import { FirebaseCloudSync } from './firebase-cloud-sync';
import { FirebaseCollectionRepository } from './firebase-collection';

afterEach(() => {
  vi.restoreAllMocks();
});

function configure(local: CollectionData, cloud: CollectionData = EMPTY_COLLECTION) {
  const data = signal(local);
  const repository = { load: vi.fn(async () => cloud), save: vi.fn(async () => undefined) };
  const auth = { _user: signal({ uid: 'personal-uid', email: 'owner@example.test' }) };
  const store = {
    _collection: data,
    _allSpecies: signal([{ id: 1, name: 'Bulbasaur', generation: 1 }]),
    _isLoading: signal(false),
    restore: vi.fn((backup: string) => {
      const restored = JSON.parse(backup) as { entries: unknown[]; albums: unknown[] };
      data.set({ entries: restored.entries as never[], albums: restored.albums as never[] });
      return true;
    }),
  };
  TestBed.configureTestingModule({
    providers: [
      FirebaseCloudSync,
      { provide: FirebaseAuthService, useValue: auth },
      { provide: CollectionStore, useValue: store },
      { provide: FirebaseCollectionRepository, useValue: repository },
    ],
  });
  return { data, repository, store, service: TestBed.inject(FirebaseCloudSync) };
}

describe('Firebase cloud sync', () => {
  it('asks before merging local data and persists the merged collection after confirmation', async () => {
    const local: CollectionData = {
      entries: [],
      albums: [{ id: 'local-album', name: 'Local', speciesIds: [] }],
    };
    const cloud: CollectionData = {
      entries: [],
      albums: [{ id: 'cloud-album', name: 'Cloud', speciesIds: [] }],
    };
    const setup = configure(local, cloud);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
    expect(confirm).toHaveBeenCalledOnce();
    expect(setup.store.restore).toHaveBeenCalledOnce();
    expect(setup.data().albums.map((album) => album.id)).toEqual(['cloud-album', 'local-album']);
    expect(setup.repository.save).toHaveBeenCalledWith('personal-uid', setup.data());
  });

  it('does not upload or replace local data when the first-merge confirmation is cancelled', async () => {
    const local: CollectionData = {
      entries: [],
      albums: [{ id: 'local-album', name: 'Local', speciesIds: [] }],
    };
    const setup = configure(local);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    setup.service.start();
    await vi.waitFor(() => expect(setup.repository.load).toHaveBeenCalledOnce());
    expect(setup.repository.save).not.toHaveBeenCalled();
    expect(setup.store.restore).not.toHaveBeenCalled();
    expect(setup.data()).toEqual(local);
    expect(setup.service._status()).toBe('local');
    expect(setup.service._error()).toContain('Sincronización pausada');
  });

  it('keeps local data and reports the owner UID when Firestore rules deny access', async () => {
    const local: CollectionData = {
      entries: [],
      albums: [{ id: 'local-album', name: 'Local', speciesIds: [] }],
    };
    const setup = configure(local);
    setup.repository.load.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { code: 'permission-denied' }),
    );
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('error'));
    expect(setup.data()).toEqual(local);
    expect(setup.repository.save).not.toHaveBeenCalled();
    expect(setup.service._error()).toContain('personal-uid');
  });
});
