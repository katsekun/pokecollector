import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollectionData, EMPTY_COLLECTION } from './collection';
import { CollectionStore } from './collection-store';
import { FirebaseAuthService } from './firebase-auth';
import { FirebaseCloudSync } from './firebase-cloud-sync';
import { FirebaseCollectionRepository } from './firebase-collection';
import { BROWSER_STORAGE } from './repositories';
import { Groups, Group } from './groups';
import { GroupCollectionRepository, GroupSnapshot } from './group-collection';

afterEach(() => {
  vi.restoreAllMocks();
});

function configure(
  local: CollectionData,
  cloud: CollectionData = EMPTY_COLLECTION,
  automatic = true,
) {
  const data = signal(local);
  const repository = {
    load: vi.fn(async () => cloud),
    save: vi.fn(async () => undefined),
    saveIfUnchanged: vi.fn<
      (...arguments_: [string, CollectionData, CollectionData]) => Promise<void>
    >(async () => undefined),
  };
  const auth = {
    _user: signal<{ uid: string; email: string } | null>({
      uid: 'personal-uid',
      email: 'owner@example.test',
    }),
  };
  const storage = { getItem: vi.fn(() => String(automatic)), setItem: vi.fn() };
  const store = {
    _collection: data,
    _allSpecies: signal([{ id: 1, name: 'Bulbasaur', generation: 1 }]),
    _isLoading: signal(false),
    _storageBlocked: signal(false),
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
      { provide: BROWSER_STORAGE, useValue: storage },
    ],
  });
  return { data, repository, store, storage, auth, service: TestBed.inject(FirebaseCloudSync) };
}

function configureShared(local: CollectionData, cloud: CollectionData = local) {
  const scope = signal('group:personal-uid:pair');
  const data = signal(local);
  const auth = {
    _user: signal<{ uid: string; email: string } | null>({
      uid: 'personal-uid',
      email: 'owner@gmail.com',
    }),
  };
  const group: Group = {
    id: 'pair',
    ownerUid: 'personal-uid',
    ownerEmail: 'owner@gmail.com',
    invitedEmail: 'friend@gmail.com',
    memberUids: ['personal-uid', 'friend'],
    contributedUids: ['personal-uid'],
    status: 'active',
    activeRevision: 'first',
  };
  const groups = signal<readonly Group[]>([group]);
  let remote: GroupSnapshot = { data: cloud, revision: 'first' };
  const shared = {
    load: vi.fn(async () => remote),
    save: vi.fn(
      async (_groupId: string, _uid: string, expected: string, changed: CollectionData) => {
        if (expected !== remote.revision) throw new Error('El grupo cambió.');
        remote = { data: changed, revision: 'next' };
        groups.set([{ ...group, activeRevision: 'next' }]);
        return 'next';
      },
    ),
  };
  const personal = {
    load: vi.fn(async () => EMPTY_COLLECTION),
    save: vi.fn(async () => undefined),
  };
  const store = {
    _scope: scope,
    _collection: data,
    _allSpecies: signal([{ id: 1, name: 'Bulbasaur', generation: 1 }]),
    _isLoading: signal(false),
    _storageBlocked: signal(false),
    switchScope: vi.fn((target: string) => {
      scope.set(target);
      data.set(EMPTY_COLLECTION);
      return true;
    }),
    restore: vi.fn((text: string) => {
      const backup = JSON.parse(text) as CollectionData;
      data.set({ entries: backup.entries, albums: backup.albums });
      return true;
    }),
  };
  const storage = new Map<string, string>();
  TestBed.configureTestingModule({
    providers: [
      FirebaseCloudSync,
      { provide: FirebaseAuthService, useValue: auth },
      { provide: CollectionStore, useValue: store },
      { provide: FirebaseCollectionRepository, useValue: personal },
      { provide: GroupCollectionRepository, useValue: shared },
      {
        provide: Groups,
        useValue: { _groups: groups, _loaded: signal(true), _busy: signal(false) },
      },
      {
        provide: BROWSER_STORAGE,
        useValue: {
          getItem: (key: string) => storage.get(key) ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
        },
      },
    ],
  });
  return {
    scope,
    data,
    store,
    shared,
    groups,
    group,
    personal,
    auth,
    service: TestBed.inject(FirebaseCloudSync),
    changeRemote: (changed: CollectionData, revision = 'remote') => {
      remote = { data: changed, revision };
      groups.set([{ ...group, activeRevision: revision }]);
    },
  };
}

describe('Shared collection synchronization', () => {
  it('rebases edits made during publication without dropping remote additions', async () => {
    const setup = configureShared(EMPTY_COLLECTION);
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
    setup.service.setAutoSync(false);
    const remote: CollectionData = {
      entries: [],
      albums: [{ id: 'remote', name: 'Remoto', speciesIds: [] }],
    };
    setup.changeRemote(remote, 'remote');
    setup.data.set({ entries: [], albums: [{ id: 'local', name: 'Local', speciesIds: [] }] });
    let finish!: (revision: string) => void;
    setup.shared.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    setup.service.syncNow();
    await vi.waitFor(() => expect(finish).toBeDefined());
    setup.data.set({
      entries: [],
      albums: [{ id: 'local', name: 'Más reciente', speciesIds: [] }],
    });
    finish('next');
    await vi.waitFor(() =>
      expect(
        setup
          .data()
          .albums.map((album) => album.name)
          .sort(),
      ).toEqual(['Más reciente', 'Remoto']),
    );
    expect(setup.personal.save).not.toHaveBeenCalled();
  });
  it('downloads a group without using or writing the personal repository', async () => {
    const cloud: CollectionData = {
      entries: [],
      albums: [{ id: 'album', name: 'Grupo', speciesIds: [] }],
    };
    const setup = configureShared(EMPTY_COLLECTION, cloud);
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
    expect(setup.data()).toEqual(cloud);
    expect(setup.personal.load).not.toHaveBeenCalled();
    expect(setup.personal.save).not.toHaveBeenCalled();
    expect(setup.shared.save).not.toHaveBeenCalled();
  });
  it('publishes edits against the last-read revision and keeps a separate local baseline', async () => {
    const setup = configureShared(EMPTY_COLLECTION);
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
    setup.data.set({ entries: [], albums: [{ id: 'album', name: 'Editado', speciesIds: [] }] });
    await vi.waitFor(() => expect(setup.shared.save).toHaveBeenCalled(), { timeout: 3000 });
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
    expect(setup.shared.save).toHaveBeenCalledWith('pair', 'personal-uid', 'first', setup.data());
    expect(setup.personal.save).not.toHaveBeenCalled();
  });
  it('downloads another member edits and returns to personal on closure while keeping group cache untouched', async () => {
    const setup = configureShared(EMPTY_COLLECTION);
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
    const remote: CollectionData = {
      entries: [],
      albums: [{ id: 'album', name: 'Remoto', speciesIds: [] }],
    };
    setup.changeRemote(remote);
    await vi.waitFor(() => expect(setup.data()).toEqual(remote));
    setup.groups.set([{ ...setup.group, status: 'closed', activeRevision: 'remote' }]);
    await vi.waitFor(() => expect(setup.scope()).toBe('personal:personal-uid'));
    expect(setup.store.switchScope).toHaveBeenCalledWith('personal:personal-uid');
  });
  it('blocks switching scopes during a shared publication', async () => {
    const setup = configureShared(EMPTY_COLLECTION);
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
    let finish!: (revision: string) => void;
    setup.shared.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    setup.data.set({ entries: [], albums: [{ id: 'album', name: 'Local', speciesIds: [] }] });
    await vi.waitFor(() => expect(finish).toBeDefined(), { timeout: 3000 });
    expect(setup.service.openCollection('personal:personal-uid')).toBe(false);
    finish('next');
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
    expect(setup.scope()).toBe('group:personal-uid:pair');
  });
  it('does not publish shared local edits after an account switch', async () => {
    const setup = configureShared(EMPTY_COLLECTION);
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
    setup.data.set({ entries: [], albums: [{ id: 'album', name: 'Pendiente', speciesIds: [] }] });
    await TestBed.tick();
    setup.auth._user.set({ uid: 'another', email: 'another@gmail.com' });
    await vi.waitFor(() => expect(setup.scope()).toBe('personal:another'));
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(setup.shared.save).not.toHaveBeenCalled();
  });
});

describe('Firebase cloud sync', () => {
  it('reports an in-flight cloud save failure even if automatic sync was disabled', async () => {
    const setup = configure(EMPTY_COLLECTION);
    let failSave!: (error: Error) => void;
    setup.repository.save.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failSave = reject;
        }),
    );
    setup.service.start();
    await vi.waitFor(() => expect(failSave).toBeDefined());
    setup.service.setAutoSync(false);
    failSave(new Error('Sin conexión'));
    await vi.waitFor(() => expect(setup.service._status()).toBe('error'));
    expect(setup.service._error()).toContain('Sin conexión');
    expect(setup.service._autoSync()).toBe(false);
  });
  it('does not overlap manual sync with an in-flight automatic read after disabling', async () => {
    const setup = configure(EMPTY_COLLECTION);
    let finishLoad!: (data: CollectionData) => void;
    setup.repository.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
    );
    setup.service.start();
    await vi.waitFor(() => expect(setup.repository.load).toHaveBeenCalledOnce());
    setup.service.setAutoSync(false);
    expect(setup.service._status()).toBe('connecting');
    setup.service.syncNow();
    expect(setup.repository.load).toHaveBeenCalledOnce();
    finishLoad(EMPTY_COLLECTION);
    await vi.waitFor(() => expect(setup.service._status()).toBe('paused'));
    expect(setup.repository.save).not.toHaveBeenCalled();
    setup.service.syncNow();
    await vi.waitFor(() => expect(setup.repository.save).toHaveBeenCalledOnce());
  });
  it('does not start another sync while the first cloud save is finishing', async () => {
    const setup = configure(EMPTY_COLLECTION);
    let finishSave!: () => void;
    setup.repository.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = () => resolve(undefined);
        }),
    );
    setup.service.start();
    await vi.waitFor(() => expect(finishSave).toBeDefined());
    expect(setup.service._status()).toBe('saving');
    setup.service.setAutoSync(false);
    setup.service.syncNow();
    expect(setup.repository.load).toHaveBeenCalledOnce();
    finishSave();
    await vi.waitFor(() => expect(setup.service._status()).toBe('paused'));
  });
  it('does not silently replace a different cloud entry during the first automatic merge', async () => {
    const card = {
      id: 'tcgdex:es:bulbasaur',
      speciesId: 1,
      name: 'Bulbasaur',
      language: 'es',
      set: 'Promo',
      number: '1',
      rarity: 'Promo',
      illustration: 'standard' as const,
      image: null,
      source: 'https://api.tcgdex.net/v2/es/cards/bulbasaur',
    };
    const local: CollectionData = {
      entries: [
        { speciesId: 1, card, status: 'owned', paidCents: 500, valueCents: null, valuedAt: null },
      ],
      albums: [],
    };
    const cloud: CollectionData = {
      entries: [{ ...local.entries[0], paidCents: 1000 }],
      albums: [],
    };
    const setup = configure(local, cloud);
    const confirm = vi.spyOn(window, 'confirm');
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('error'));
    expect(setup.service._error()).toContain('No se han combinado ni subido cambios');
    expect(setup.data()).toEqual(local);
    expect(setup.store.restore).not.toHaveBeenCalled();
    expect(setup.repository.save).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
  it('does not silently replace an album name during the first automatic merge', async () => {
    const local: CollectionData = {
      entries: [],
      albums: [{ id: 'album', name: 'Local', speciesIds: [] }],
    };
    const cloud: CollectionData = {
      entries: [],
      albums: [{ id: 'album', name: 'Nube', speciesIds: [] }],
    };
    const setup = configure(local, cloud);
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('error'));
    expect(setup.repository.save).not.toHaveBeenCalled();
    expect(setup.data()).toEqual(local);
  });
  it('respects deletions made in the cloud when local data is unchanged', async () => {
    const original: CollectionData = {
      entries: [],
      albums: [{ id: 'album', name: 'Álbum', speciesIds: [] }],
    };
    const setup = configure(original, original, false);
    setup.service.start();
    await TestBed.tick();
    setup.service.syncNow();
    await vi.waitFor(() => expect(setup.repository.save).toHaveBeenCalledOnce());
    setup.repository.load.mockResolvedValueOnce(EMPTY_COLLECTION);
    setup.service.syncNow();
    await vi.waitFor(() => expect(setup.data().albums).toEqual([]));
    expect(setup.repository.save).toHaveBeenLastCalledWith('personal-uid', EMPTY_COLLECTION);
  });
  it('keeps the setting warning visible if browser storage cannot save it', async () => {
    const setup = configure(EMPTY_COLLECTION);
    setup.auth._user.set(null);
    setup.storage.setItem.mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    setup.service.start();
    await TestBed.tick();
    setup.service.setAutoSync(false);
    await TestBed.tick();
    expect(setup.service._autoSync()).toBe(false);
    expect(setup.service._settingError()).toContain('solo hasta recargar');
    expect(setup.repository.load).not.toHaveBeenCalled();
  });
  it('does not duplicate a manual connection when automatic sync is enabled during it', async () => {
    const setup = configure(EMPTY_COLLECTION, EMPTY_COLLECTION, false);
    let finishLoad!: (data: CollectionData) => void;
    setup.repository.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
    );
    setup.service.start();
    await TestBed.tick();
    setup.service.syncNow();
    await vi.waitFor(() => expect(setup.repository.load).toHaveBeenCalledOnce());
    setup.service.setAutoSync(true);
    await TestBed.tick();
    expect(setup.repository.load).toHaveBeenCalledOnce();
    finishLoad(EMPTY_COLLECTION);
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
  });
  it('saves edits made while an earlier automatic save is still running', async () => {
    const setup = configure(EMPTY_COLLECTION);
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
    setup.repository.save.mockClear();
    let finishSave!: () => void;
    setup.repository.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = () => resolve(undefined);
        }),
    );
    setup.data.set({ entries: [], albums: [{ id: 'first', name: 'Local', speciesIds: [] }] });
    await vi.waitFor(() => expect(finishSave).toBeDefined());
    setup.data.set({ entries: [], albums: [{ id: 'second', name: 'Local', speciesIds: [] }] });
    finishSave();
    await vi.waitFor(() => expect(setup.repository.save).toHaveBeenCalledTimes(2), {
      timeout: 3000,
    });
    expect(setup.repository.save).toHaveBeenLastCalledWith('personal-uid', setup.data());
  });
  it('waits for an in-flight automatic save before allowing manual sync after disabling', async () => {
    const setup = configure(EMPTY_COLLECTION);
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
    let finishSave!: () => void;
    setup.repository.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = () => resolve(undefined);
        }),
    );
    setup.data.set({ entries: [], albums: [{ id: 'later', name: 'Local', speciesIds: [] }] });
    await vi.waitFor(() => expect(setup.service._status()).toBe('saving'));
    await vi.waitFor(() => expect(finishSave).toBeDefined());
    setup.service.setAutoSync(false);
    expect(setup.service._status()).toBe('saving');
    const loads = setup.repository.load.mock.calls.length;
    setup.service.syncNow();
    expect(setup.repository.load).toHaveBeenCalledTimes(loads);
    finishSave();
    await vi.waitFor(() => expect(setup.service._status()).toBe('paused'));
    expect(setup.service._autoSync()).toBe(false);
  });
  it('does not access the cloud while local storage is protected', async () => {
    const setup = configure(EMPTY_COLLECTION);
    setup.store._storageBlocked.set(true);
    setup.service.start();
    await TestBed.tick();
    setup.service.syncNow();
    expect(setup.repository.load).not.toHaveBeenCalled();
    expect(setup.repository.save).not.toHaveBeenCalled();
  });
  it('downloads remote changes during manual sync when local data is unchanged', async () => {
    const setup = configure(EMPTY_COLLECTION, EMPTY_COLLECTION, false);
    setup.service.start();
    await TestBed.tick();
    setup.service.syncNow();
    await vi.waitFor(() => expect(setup.repository.save).toHaveBeenCalledOnce());
    setup.repository.load.mockResolvedValueOnce({
      entries: [],
      albums: [{ id: 'remote', name: 'Nube', speciesIds: [] }],
    });
    setup.service.syncNow();
    await vi.waitFor(() =>
      expect(setup.data().albums.map((album) => album.id)).toEqual(['remote']),
    );
    expect(setup.repository.load).toHaveBeenCalledTimes(2);
  });
  it('does not overwrite either copy when local and remote both changed', async () => {
    const setup = configure(EMPTY_COLLECTION, EMPTY_COLLECTION, false);
    setup.service.start();
    await TestBed.tick();
    setup.service.syncNow();
    await vi.waitFor(() => expect(setup.repository.save).toHaveBeenCalledOnce());
    setup.repository.save.mockClear();
    setup.data.set({ entries: [], albums: [{ id: 'shared', name: 'Local', speciesIds: [] }] });
    setup.repository.load.mockResolvedValueOnce({
      entries: [],
      albums: [{ id: 'shared', name: 'Nube', speciesIds: [] }],
    });
    setup.service.syncNow();
    await vi.waitFor(() => expect(setup.service._status()).toBe('error'));
    expect(setup.service._error()).toContain('No se han combinado ni subido cambios');
    expect(setup.data().albums.map((album) => album.id)).toEqual(['shared']);
    expect(setup.repository.save).not.toHaveBeenCalled();
  });
  it('applies explicit choices through a checked cloud write', async () => {
    const local: CollectionData = {
      entries: [],
      albums: [{ id: 'shared', name: 'Local', speciesIds: [] }],
    };
    const cloud: CollectionData = {
      entries: [],
      albums: [{ id: 'shared', name: 'Nube', speciesIds: [] }],
    };
    const setup = configure(local, cloud);
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._conflict()).not.toBeNull());
    await setup.service.resolveConflicts({ 'album:shared': 'local' });
    expect(setup.repository.saveIfUnchanged).toHaveBeenCalledWith('personal-uid', cloud, local);
    expect(setup.data()).toEqual(local);
    expect(setup.service._conflict()).toBeNull();
    expect(setup.service._status()).toBe('synced');
  });
  it('refuses stale choices after a local or cloud change', async () => {
    const local: CollectionData = {
      entries: [],
      albums: [{ id: 'shared', name: 'Local', speciesIds: [] }],
    };
    const cloud: CollectionData = {
      entries: [],
      albums: [{ id: 'shared', name: 'Nube', speciesIds: [] }],
    };
    const setup = configure(local, cloud);
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._conflict()).not.toBeNull());
    setup.data.set({ entries: [], albums: [{ id: 'shared', name: 'Nuevo', speciesIds: [] }] });
    await setup.service.resolveConflicts({ 'album:shared': 'cloud' });
    expect(setup.repository.saveIfUnchanged).not.toHaveBeenCalled();
    expect(setup.data().albums[0].name).toBe('Nuevo');
    expect(setup.service._error()).toContain('cambió');
    setup.data.set(local);
    setup.repository.load.mockResolvedValueOnce({
      entries: [],
      albums: [{ id: 'shared', name: 'Nuevo remoto', speciesIds: [] }],
    });
    await setup.service.resolveConflicts({ 'album:shared': 'local' });
    expect(setup.repository.saveIfUnchanged).not.toHaveBeenCalled();
    expect(setup.service._error()).toContain('cambiaron');
  });
  it('preserves local edits made during the checked cloud write', async () => {
    const local: CollectionData = {
      entries: [],
      albums: [{ id: 'shared', name: 'Local', speciesIds: [] }],
    };
    const cloud: CollectionData = {
      entries: [],
      albums: [{ id: 'shared', name: 'Nube', speciesIds: [] }],
    };
    const setup = configure(local, cloud);
    let finish!: () => void;
    setup.repository.saveIfUnchanged.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(undefined);
        }),
    );
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._conflict()).not.toBeNull());
    const resolution = setup.service.resolveConflicts({ 'album:shared': 'cloud' });
    await vi.waitFor(() => expect(finish).toBeDefined());
    setup.data.set({ entries: [], albums: [{ id: 'shared', name: 'Editado', speciesIds: [] }] });
    finish();
    await resolution;
    expect(setup.data().albums[0].name).toBe('Editado');
    expect(setup.store.restore).not.toHaveBeenCalled();
    expect(setup.service._error()).toContain('La nube se actualizó');
  });
  it('finishes an explicitly requested resolution when automatic sync is disabled during the write', async () => {
    const local: CollectionData = {
      entries: [],
      albums: [{ id: 'shared', name: 'Local', speciesIds: [] }],
    };
    const cloud: CollectionData = {
      entries: [],
      albums: [{ id: 'shared', name: 'Nube', speciesIds: [] }],
    };
    const setup = configure(local, cloud);
    let finish!: () => void;
    setup.repository.saveIfUnchanged.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(undefined);
        }),
    );
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._conflict()).not.toBeNull());
    const resolution = setup.service.resolveConflicts({ 'album:shared': 'cloud' });
    await vi.waitFor(() => expect(finish).toBeDefined());
    setup.service.setAutoSync(false);
    finish();
    await resolution;
    expect(setup.data()).toEqual(cloud);
    expect(setup.service._conflict()).toBeNull();
    expect(setup.service._status()).toBe('paused');
  });
  it('does not restore the resolved collection after signing out during the write', async () => {
    const local: CollectionData = {
      entries: [],
      albums: [{ id: 'shared', name: 'Local', speciesIds: [] }],
    };
    const cloud: CollectionData = {
      entries: [],
      albums: [{ id: 'shared', name: 'Nube', speciesIds: [] }],
    };
    const setup = configure(local, cloud);
    let finish!: () => void;
    setup.repository.saveIfUnchanged.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(undefined);
        }),
    );
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._conflict()).not.toBeNull());
    const resolution = setup.service.resolveConflicts({ 'album:shared': 'cloud' });
    await vi.waitFor(() => expect(finish).toBeDefined());
    setup.auth._user.set(null);
    finish();
    await resolution;
    expect(setup.store.restore).not.toHaveBeenCalled();
    expect(setup.data()).toEqual(local);
  });
  it('does not contact the cloud when automatic sync is disabled and syncs on demand', async () => {
    const setup = configure(EMPTY_COLLECTION, EMPTY_COLLECTION, false);
    setup.service.start();
    await TestBed.tick();
    expect(setup.repository.load).not.toHaveBeenCalled();
    expect(setup.repository.save).not.toHaveBeenCalled();
    expect(setup.service._status()).toBe('paused');
    setup.service.syncNow();
    await vi.waitFor(() => expect(setup.repository.save).toHaveBeenCalledOnce());
    expect(setup.service._autoSync()).toBe(false);
  });
  it('persists the per-device setting and cancels automatic sync scheduled before disabling', async () => {
    const setup = configure(EMPTY_COLLECTION);
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
    setup.repository.save.mockClear();
    setup.data.set({ entries: [], albums: [{ id: 'later', name: 'Local', speciesIds: [] }] });
    await TestBed.tick();
    setup.service.setAutoSync(false);
    expect(setup.storage.setItem).toHaveBeenCalledWith('pokecollector.sync.auto', 'false');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(setup.repository.save).not.toHaveBeenCalled();
    expect(setup.data().albums).toHaveLength(1);
    setup.service.syncNow();
    await vi.waitFor(() =>
      expect(setup.repository.save).toHaveBeenCalledWith('personal-uid', setup.data()),
    );
  });
  it('merges local and cloud data automatically without showing a confirmation', async () => {
    const local: CollectionData = {
      entries: [],
      albums: [{ id: 'local-album', name: 'Local', speciesIds: [] }],
    };
    const cloud: CollectionData = {
      entries: [],
      albums: [{ id: 'cloud-album', name: 'Cloud', speciesIds: [] }],
    };
    const setup = configure(local, cloud);
    const confirm = vi.spyOn(window, 'confirm');
    setup.service.start();
    await vi.waitFor(() => expect(setup.service._status()).toBe('synced'));
    expect(confirm).not.toHaveBeenCalled();
    expect(setup.store.restore).toHaveBeenCalledOnce();
    expect(setup.data().albums.map((album) => album.id)).toEqual(['cloud-album', 'local-album']);
    expect(setup.repository.save).toHaveBeenCalledWith('personal-uid', setup.data());
  });

  it('merges on manual synchronization without showing a confirmation', async () => {
    const local: CollectionData = {
      entries: [],
      albums: [{ id: 'local-album', name: 'Local', speciesIds: [] }],
    };
    const cloud: CollectionData = {
      entries: [],
      albums: [{ id: 'cloud-album', name: 'Cloud', speciesIds: [] }],
    };
    const setup = configure(local, cloud, false);
    const confirm = vi.spyOn(window, 'confirm');
    setup.service.start();
    await TestBed.tick();
    expect(setup.repository.load).not.toHaveBeenCalled();
    setup.service.syncNow();
    await vi.waitFor(() => expect(setup.repository.save).toHaveBeenCalledOnce());
    expect(confirm).not.toHaveBeenCalled();
    expect(setup.data().albums.map((album) => album.id)).toEqual(['cloud-album', 'local-album']);
    expect(setup.service._autoSync()).toBe(false);
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
