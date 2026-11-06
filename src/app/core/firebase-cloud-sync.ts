import { effect, inject, Injectable, signal } from '@angular/core';
import { CollectionData, createBackup } from './collection';
import { CollectionStore } from './collection-store';
import { FirebaseAuthService } from './firebase-auth';
import {
  FirebaseCollectionRepository,
  mergeCollections,
  validateCloudData,
} from './firebase-collection';

export type CloudSyncStatus = 'local' | 'connecting' | 'synced' | 'saving' | 'error';

@Injectable({ providedIn: 'root' })
export class FirebaseCloudSync {
  private readonly auth = inject(FirebaseAuthService);
  private readonly store = inject(CollectionStore);
  private readonly repository = inject(FirebaseCollectionRepository);
  private readonly _started = signal(false);
  private readonly _readyUid = signal('');
  private readonly _retryVersion = signal(0);
  private attemptedUid = '';
  private generation = 0;
  private lastSaved = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  public readonly _status = signal<CloudSyncStatus>('local');
  public readonly _error = signal('');

  public constructor() {
    effect(() => {
      if (!this._started()) return;
      this._retryVersion();
      const user = this.auth._user();
      const data = this.store._collection();
      if (!this.store._allSpecies().length || this.store._isLoading()) return;
      if (!user) {
        this.generation += 1;
        this._readyUid.set('');
        this.attemptedUid = '';
        this._status.set('local');
        this._error.set('');
        if (this.timer) clearTimeout(this.timer);
        return;
      }
      if (this._readyUid() !== user.uid) {
        if (this.attemptedUid !== user.uid) void this.connect(user.uid);
        return;
      }
      const snapshot = JSON.stringify(data);
      if (snapshot === this.lastSaved) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.queueSave(user.uid, data), 500);
    });
  }

  public start(): void {
    this._started.set(true);
  }

  public retry(): void {
    const uid = this.auth._user()?.uid;
    if (!uid) return;
    this.attemptedUid = '';
    this._readyUid.set('');
    this._error.set('');
    this._status.set('local');
    this._retryVersion.update((version) => version + 1);
  }

  public dismissError(): void {
    this._error.set('');
  }

  private async connect(uid: string): Promise<void> {
    const generation = ++this.generation;
    this.attemptedUid = uid;
    this._status.set('connecting');
    this._error.set('');
    try {
      const cloudData = validateCloudData(
        await this.repository.load(uid),
        this.store._allSpecies(),
      );
      if (generation !== this.generation || this.auth._user()?.uid !== uid) return;
      const currentLocalData = this.store._collection();
      if (
        (currentLocalData.entries.length || currentLocalData.albums.length) &&
        !window.confirm(
          `¿Fusionar tus ${currentLocalData.entries.length} cartas y ${currentLocalData.albums.length} álbumes locales con los ${cloudData.entries.length} elementos de la nube? En una misma forma se conservará la selección local y se combinarán los álbumes. La copia local no se borrará.`,
        )
      ) {
        this._status.set('local');
        this._error.set(
          'Sincronización pausada. Tu colección sigue solo en este navegador; pulsa «Reintentar nube» cuando quieras fusionarla.',
        );
        return;
      }
      const merged = validateCloudData(
        mergeCollections(currentLocalData, cloudData),
        this.store._allSpecies(),
      );
      const mergedBackup = JSON.stringify(createBackup(merged));
      if (
        JSON.stringify(currentLocalData) !== JSON.stringify(merged) &&
        !this.store.restore(mergedBackup)
      )
        throw new Error(
          'No se pudo combinar la colección local con la nube. La colección local se conserva.',
        );
      await this.repository.save(uid, merged);
      if (generation !== this.generation || this.auth._user()?.uid !== uid) return;
      this.lastSaved = JSON.stringify(merged);
      this._readyUid.set(uid);
      this._status.set('synced');
    } catch (error) {
      if (generation !== this.generation) return;
      this._readyUid.set('');
      this._status.set('error');
      this._error.set(this.messageFor(error));
    }
  }

  private queueSave(uid: string, data: CollectionData): void {
    if (this.auth._user()?.uid !== uid || this._readyUid() !== uid) return;
    const snapshot = JSON.stringify(data);
    if (snapshot === this.lastSaved) return;
    this._status.set('saving');
    this.saveQueue = this.saveQueue
      .then(async () => {
        if (this.auth._user()?.uid !== uid) return;
        await this.repository.save(uid, data);
        this.lastSaved = snapshot;
        if (JSON.stringify(this.store._collection()) === snapshot) this._status.set('synced');
      })
      .catch((error: unknown) => {
        this._status.set('error');
        this._error.set(this.messageFor(error));
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
