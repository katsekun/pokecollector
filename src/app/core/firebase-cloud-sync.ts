import { effect, inject, Injectable, signal } from '@angular/core';
import { CollectionData, createBackup } from './collection';
import { CollectionStore } from './collection-store';
import { FirebaseAuthService } from './firebase-auth';
import { BROWSER_STORAGE } from './repositories';
import { GroupCollectionRepository } from './group-collection';
import { Groups } from './groups';
import {
  FirebaseCollectionRepository,
  CollectionMergePlan,
  mergeCollections,
  planCollectionMerge,
  resolveCollectionMerge,
  validateCloudData,
} from './firebase-collection';

export type CloudSyncStatus = 'local' | 'paused' | 'connecting' | 'synced' | 'saving' | 'error';

export interface SyncConflictReview {
  readonly uid: string;
  readonly local: CollectionData;
  readonly cloud: CollectionData;
  readonly plan: CollectionMergePlan;
  readonly scope?: string;
  readonly revision?: string;
}

@Injectable({ providedIn: 'root' })
export class FirebaseCloudSync {
  private readonly auth = inject(FirebaseAuthService);
  private readonly store = inject(CollectionStore);
  private readonly repository = inject(FirebaseCollectionRepository);
  private readonly storage = inject(BROWSER_STORAGE);
  private readonly groupRepository = inject(GroupCollectionRepository);
  public readonly groups = inject(Groups);
  private lastScope = '';
  private accountUid = '';
  private groupRevision = '';
  private observedGroupRevision = '';
  private static readonly autoSyncKey = 'pokecollector.sync.auto';
  private readonly _started = signal(false);
  private readonly _readyUid = signal('');
  private readonly _retryVersion = signal(0);
  private attemptedUid = '';
  private lastUid = '';
  private generation = 0;
  private lastSaved = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  public readonly _status = signal<CloudSyncStatus>('local');
  public readonly _error = signal('');
  public readonly _autoSync = signal(this.loadAutoSync());
  public readonly _settingError = signal('');
  public readonly _lastSyncedAt = signal<string | null>(null);
  public readonly _conflict = signal<SyncConflictReview | null>(null);

  public constructor() {
    effect(() => {
      if (!this._started()) return;
      this._retryVersion();
      const autoSync = this._autoSync();
      const user = this.auth._user();
      const data = this.store._collection();
      if (!this.store._allSpecies().length || this.store._isLoading()) return;
      if (!user) {
        this.resetSession();
        this.accountUid = '';
        if (this.store._scope?.() !== undefined && !this.store.switchScope('guest', true)) return;
        return;
      }
      const scope = this.scope();
      const switchedAccount = !!this.accountUid && this.accountUid !== user.uid;
      this.accountUid = user.uid;
      if (
        this.store._scope?.() !== undefined &&
        (scope === 'guest' ||
          switchedAccount ||
          (scope.startsWith('personal:') && scope !== `personal:${user.uid}`))
      ) {
        this.resetSession();
        if (!this.store.switchScope(`personal:${user.uid}`, true)) return;
        return;
      }
      if (this.store._storageBlocked()) return;
      if (scope !== this.lastScope) {
        this.resetSession();
        this.lastScope = scope;
        this.loadGroupBaseline();
      }
      if (scope.startsWith('group:')) {
        const group = this.groups._groups().find((item) => item.id === this.groupId(scope));
        if (this.groups._loaded() && (!group || group.status === 'closed')) {
          this.resetSession();
          if (this.store.switchScope(`personal:${user.uid}`))
            this._error.set(
              'La agrupación se cerró. Tu copia local del grupo se conserva y has vuelto a tu colección personal.',
            );
          return;
        }
        const headChanged = !!group && group.activeRevision !== this.observedGroupRevision;
        if (group && group.activeRevision === this.groupRevision)
          this.observedGroupRevision = group.activeRevision;
        if (
          headChanged &&
          group &&
          this._autoSync() &&
          group.activeRevision !== this.groupRevision &&
          !['connecting', 'saving', 'error'].includes(this._status()) &&
          !this._conflict()
        ) {
          this.observedGroupRevision = group.activeRevision;
          void this.connect(user.uid);
          return;
        }
      }
      if (this._conflict()?.uid !== user.uid) this._conflict.set(null);
      if (this._conflict()) return;
      if (!autoSync) {
        this.pauseAutomaticSync();
        return;
      }
      if (['connecting', 'saving', 'error'].includes(this._status())) return;
      if (this._readyUid() !== user.uid) {
        if (this.attemptedUid !== user.uid) void this.connect(user.uid);
        return;
      }
      const snapshot = this.fingerprint(data);
      if (snapshot === this.lastSaved) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.queueSave(user.uid, data), 500);
    });
  }

  public start(): void {
    this._started.set(true);
  }

  public openCollection(scope: string): boolean {
    const user = this.auth._user();
    if (!user || ['connecting', 'saving'].includes(this._status()) || this.groups._busy())
      return false;
    if (scope !== `personal:${user.uid}`) {
      const group = this.groups
        ._groups()
        .find((item) => `group:${item.id}` === scope && item.status !== 'closed');
      if (!group) return false;
      scope = `group:${user.uid}:${group.id}`;
    }
    if (scope === this.scope()) return true;
    if (!this.store.switchScope(scope)) return false;
    this.resetSession();
    this.lastScope = scope;
    this.loadGroupBaseline();
    this.syncNow();
    return true;
  }

  private scope(): string {
    return this.store._scope?.() ?? `personal:${this.auth._user()?.uid ?? ''}`;
  }

  private groupId(scope = this.scope()): string {
    return scope.slice(scope.lastIndexOf(':') + 1);
  }

  private loadGroupBaseline(): void {
    this.groupRevision = '';
    if (!this.scope().startsWith('group:')) return;
    try {
      const text = this.storage?.getItem(`pokecollector.baseline:${this.scope()}`);
      if (!text) return;
      const stored = JSON.parse(text) as { revision: string; data: CollectionData };
      const data = validateCloudData(stored.data, this.store._allSpecies());
      if (typeof stored.revision !== 'string') return;
      this.groupRevision = stored.revision;
      this.lastSaved = this.fingerprint(data);
      this.lastUid = this.auth._user()?.uid ?? '';
    } catch {
      this.groupRevision = '';
    }
  }

  private rememberGroupBaseline(data: CollectionData, revision: string): void {
    this.groupRevision = revision;
    try {
      this.storage?.setItem(
        `pokecollector.baseline:${this.scope()}`,
        JSON.stringify({ revision, data }),
      );
    } catch {
      this._settingError.set(
        'No se pudo guardar la referencia local del grupo. Conserva un respaldo antes de recargar.',
      );
    }
  }

  private resetSession(): void {
    this.generation += 1;
    this._readyUid.set('');
    this.attemptedUid = '';
    this.lastUid = '';
    this.lastSaved = '';
    this.observedGroupRevision = '';
    this._conflict.set(null);
    this._lastSyncedAt.set(null);
    this._status.set('local');
    this._error.set('');
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private pauseAutomaticSync(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!['connecting', 'saving', 'error'].includes(this._status())) this._status.set('paused');
  }

  public setAutoSync(enabled: boolean): void {
    if (this._autoSync() === enabled) return;
    if (!enabled) {
      if (!(this._conflict() && this._status() === 'saving')) this.generation += 1;
      this.attemptedUid = '';
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (!['saving', 'connecting'].includes(this._status())) this._status.set('paused');
      this._error.set('');
    } else {
      this.attemptedUid = '';
      this._readyUid.set('');
      if (!['saving', 'connecting'].includes(this._status())) this._status.set('local');
    }
    this._autoSync.set(enabled);
    this._settingError.set('');
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      this.storage.setItem(FirebaseCloudSync.autoSyncKey, String(enabled));
    } catch {
      this._settingError.set('La preferencia se aplicará solo hasta recargar la página.');
    }
  }

  public syncNow(): void {
    const uid = this.auth._user()?.uid;
    if (
      !uid ||
      !this._started() ||
      this.store._isLoading() ||
      this.store._storageBlocked() ||
      !this.store._allSpecies().length
    )
      return;
    if (this._status() === 'connecting' || this._status() === 'saving') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this._conflict.set(null);
    this._error.set('');
    void this.connect(uid);
  }

  private loadAutoSync(): boolean {
    try {
      return this.storage?.getItem(FirebaseCloudSync.autoSyncKey) !== 'false';
    } catch {
      return true;
    }
  }

  public retry(): void {
    const uid = this.auth._user()?.uid;
    if (!uid) return;
    this._conflict.set(null);
    if (!this._autoSync()) {
      this._status.set('paused');
      this.syncNow();
      return;
    }
    this.attemptedUid = '';
    this._readyUid.set('');
    this._error.set('');
    this._status.set('local');
    this._retryVersion.update((version) => version + 1);
  }

  public dismissError(): void {
    this._error.set('');
  }

  public async resolveConflicts(
    choices: Readonly<Record<string, 'local' | 'cloud'>>,
  ): Promise<void> {
    const review = this._conflict();
    if (!review || this.auth._user()?.uid !== review.uid || this._status() === 'saving') return;
    if (this.store._storageBlocked()) return;
    if (review.scope && review.scope !== this.scope()) return;
    const generation = ++this.generation;
    this._status.set('saving');
    this._error.set('');
    try {
      const merged = validateCloudData(
        resolveCollectionMerge(review.plan, choices),
        this.store._allSpecies(),
      );
      if (this.fingerprint(this.store._collection()) !== this.fingerprint(review.local))
        throw new Error('La colección local cambió. Vuelve a revisar los conflictos.');
      const shared = this.scope().startsWith('group:');
      const remote = shared
        ? await this.groupRepository.load(this.groupId(), this.store._allSpecies())
        : null;
      const cloud =
        remote?.data ??
        validateCloudData(await this.repository.load(review.uid), this.store._allSpecies());
      if (generation !== this.generation || this.auth._user()?.uid !== review.uid) return;
      if (
        this.fingerprint(this.store._collection()) !== this.fingerprint(review.local) ||
        this.fingerprint(cloud) !== this.fingerprint(review.cloud) ||
        (remote && remote.revision !== review.revision)
      )
        throw new Error('La colección local o la nube cambiaron. Vuelve a revisar los conflictos.');
      const savedRevision = remote
        ? await this.groupRepository.save(this.groupId(), review.uid, remote.revision, merged)
        : '';
      if (!remote) await this.repository.saveIfUnchanged(review.uid, cloud, merged);
      if (generation !== this.generation || this.auth._user()?.uid !== review.uid) return;
      if (remote) {
        this.finishGroupSave(review.uid, this.scope(), review.local, merged, savedRevision);
        this._conflict.set(null);
        this._status.set(this._autoSync() ? 'synced' : 'paused');
        return;
      }
      if (this.fingerprint(this.store._collection()) !== this.fingerprint(review.local)) {
        this.lastUid = '';
        this.lastSaved = '';
        throw new Error(
          'La nube se actualizó, pero la colección local cambió durante el guardado y se ha conservado. Vuelve a sincronizar.',
        );
      }
      if (!this.store.restore(JSON.stringify(createBackup(merged)))) {
        this.lastUid = '';
        this.lastSaved = '';
        throw new Error(
          'La nube se actualizó, pero no se pudo guardar la colección local. Vuelve a sincronizar.',
        );
      }
      this.lastSaved = this.fingerprint(merged);
      this.lastUid = review.uid;
      if (savedRevision) this.rememberGroupBaseline(merged, savedRevision);
      this._lastSyncedAt.set(new Date().toISOString());
      this._readyUid.set(review.uid);
      this._conflict.set(null);
      this._status.set(this._autoSync() ? 'synced' : 'paused');
    } catch (error) {
      if (generation !== this.generation || this.auth._user()?.uid !== review.uid) return;
      this._readyUid.set('');
      this._status.set('error');
      this._error.set(this.messageFor(error));
    } finally {
      if (this.auth._user()?.uid !== review.uid && this._status() === 'saving') {
        this._status.set(this._autoSync() ? 'local' : 'paused');
      }
    }
  }

  private async connect(uid: string): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const generation = ++this.generation;
    this.attemptedUid = uid;
    this._status.set('connecting');
    this._error.set('');
    try {
      const scope = this.scope();
      const remote = scope.startsWith('group:')
        ? await this.groupRepository.load(this.groupId(scope), this.store._allSpecies())
        : null;
      const cloudData =
        remote?.data ??
        validateCloudData(await this.repository.load(uid), this.store._allSpecies());
      if (generation !== this.generation || this.auth._user()?.uid !== uid) return;
      if (scope !== this.scope()) return;
      const currentLocalData = this.store._collection();
      const selected = this.chooseSyncData(uid, currentLocalData, cloudData, remote?.revision);
      const merged = validateCloudData(selected, this.store._allSpecies());
      const mergedBackup = JSON.stringify(createBackup(merged));
      if (remote) {
        this._status.set('saving');
        const revision =
          this.fingerprint(merged) === this.fingerprint(cloudData)
            ? remote.revision
            : await this.groupRepository.save(this.groupId(scope), uid, remote.revision, merged);
        if (
          generation !== this.generation ||
          this.auth._user()?.uid !== uid ||
          scope !== this.scope()
        )
          return;
        this.finishGroupSave(uid, scope, currentLocalData, merged, revision);
        this._status.set('synced');
        return;
      }
      if (
        JSON.stringify(currentLocalData) !== JSON.stringify(merged) &&
        !this.store.restore(mergedBackup)
      )
        throw new Error(
          'No se pudo combinar la colección local con la nube. La colección local se conserva.',
        );
      this._status.set('saving');
      await this.repository.save(uid, merged);
      if (generation !== this.generation || this.auth._user()?.uid !== uid) return;
      this.lastSaved = this.fingerprint(merged);
      this.lastUid = uid;
      this._lastSyncedAt.set(new Date().toISOString());
      this._readyUid.set(uid);
      this._status.set('synced');
    } catch (error) {
      if (generation !== this.generation) {
        if (this.auth._user()?.uid === uid && !this._autoSync() && this._status() === 'saving') {
          this._status.set('error');
          this._error.set(this.messageFor(error));
        }
        return;
      }
      this._readyUid.set('');
      this._status.set('error');
      this._error.set(this.messageFor(error));
    } finally {
      if (
        generation !== this.generation &&
        this.auth._user()?.uid === uid &&
        ['connecting', 'saving'].includes(this._status())
      ) {
        this._status.set(this._autoSync() ? 'local' : 'paused');
      }
    }
  }

  private finishGroupSave(
    uid: string,
    scope: string,
    original: CollectionData,
    saved: CollectionData,
    revision: string,
  ): void {
    const local = this.store._collection();
    const pending = planCollectionMerge(local, saved, original);
    if (pending.conflicts.length) {
      this._conflict.set({ uid, scope, local, cloud: saved, revision, plan: pending });
      this.lastSaved = this.fingerprint(saved);
      this.lastUid = uid;
      this.rememberGroupBaseline(saved, revision);
      throw new Error(
        'La nube se actualizó, pero tus nuevas ediciones requieren revisar diferencias con esa versión. La copia local se conserva.',
      );
    }
    const combined = validateCloudData(
      resolveCollectionMerge(pending, {}),
      this.store._allSpecies(),
    );
    if (
      this.fingerprint(local) !== this.fingerprint(combined) &&
      !this.store.restore(JSON.stringify(createBackup(combined)))
    )
      throw new Error('La nube se actualizó, pero no se pudo guardar la copia local del grupo.');
    this.lastSaved = this.fingerprint(saved);
    this.lastUid = uid;
    this.rememberGroupBaseline(saved, revision);
    this._readyUid.set(uid);
    this._lastSyncedAt.set(new Date().toISOString());
  }

  private chooseSyncData(
    uid: string,
    local: CollectionData,
    cloud: CollectionData,
    revision?: string,
  ): CollectionData {
    const baseline =
      this.lastUid === uid && this.lastSaved
        ? (JSON.parse(this.lastSaved) as CollectionData)
        : undefined;
    const plan = planCollectionMerge(local, cloud, baseline);
    if (plan.conflicts.length) {
      this._conflict.set({ uid, local, cloud, plan, scope: this.scope(), revision });
      throw new Error(
        'Hay cartas o álbumes con datos distintos en este navegador y en la nube. No se han combinado ni subido cambios; exporta un respaldo antes de resolver el conflicto.',
      );
    }
    return baseline ? resolveCollectionMerge(plan, {}) : mergeCollections(local, cloud);
  }

  private queueSave(uid: string, data: CollectionData): void {
    if (this.auth._user()?.uid !== uid || this._readyUid() !== uid) return;
    if (!this._autoSync() || ['connecting', 'saving'].includes(this._status())) return;
    if (this.scope().startsWith('group:')) {
      void this.connect(uid);
      return;
    }
    const snapshot = this.fingerprint(data);
    if (snapshot === this.lastSaved) return;
    this._status.set('saving');
    const generation = this.generation;
    this.saveQueue = this.saveQueue
      .then(async () => {
        if (this.auth._user()?.uid !== uid || !this._autoSync()) return;
        if (generation !== this.generation) return;
        await this.repository.save(uid, data);
        if (this.auth._user()?.uid !== uid) return;
        if (generation !== this.generation) return;
        this.lastSaved = snapshot;
        this.lastUid = uid;
        this._lastSyncedAt.set(new Date().toISOString());
        if (generation === this.generation && this._autoSync()) this._status.set('synced');
      })
      .catch((error: unknown) => {
        if (this.auth._user()?.uid !== uid || (generation !== this.generation && this._autoSync()))
          return;
        this._status.set('error');
        this._error.set(this.messageFor(error));
      })
      .finally(() => {
        if (this._status() !== 'saving') return;
        if (!this._autoSync()) this._status.set('paused');
        else if (generation !== this.generation) this._status.set('local');
      });
  }

  private fingerprint(data: CollectionData): string {
    return JSON.stringify({
      entries: [...data.entries].sort((first, second) => first.speciesId - second.speciesId),
      albums: data.albums
        .map((album) => ({
          ...album,
          speciesIds: [...album.speciesIds].sort((first, second) => first - second),
        }))
        .sort((first, second) => first.id.localeCompare(second.id)),
    });
  }

  private messageFor(error: unknown): string {
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : '';
    if (code.includes('permission-denied'))
      return `Firestore ha denegado el acceso. Tus cambios siguen guardándose localmente. UID para las reglas: ${this.auth._user()?.uid ?? 'desconocido'}`;
    if (error instanceof Error && error.message)
      return `La colección sigue en este navegador. No se pudo sincronizar: ${error.message}`;
    return 'La colección sigue en este navegador. No se pudo sincronizar con Firebase.';
  }
}
