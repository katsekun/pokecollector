import { Injectable } from '@angular/core';
import { type DocumentReference, type Transaction, type WriteBatch } from 'firebase/firestore';
import {
  Album,
  CollectionData,
  CollectionEntry,
  createBackup,
  EMPTY_COLLECTION,
  parseBackup,
  PokemonSpecies,
} from './collection';
import { getFirebaseFirestore } from './firebase-runtime';

@Injectable({ providedIn: 'root' })
export class FirebaseCollectionRepository {
  private readonly snapshots = new Map<string, CollectionData>();

  public async load(uid: string): Promise<CollectionData> {
    const [{ collection, getDocsFromServer }, firestore] = await Promise.all([
      import('firebase/firestore'),
      getFirebaseFirestore(),
    ]);
    const [entriesSnapshot, albumsSnapshot] = await Promise.all([
      getDocsFromServer(collection(firestore, 'users', uid, 'entries')),
      getDocsFromServer(collection(firestore, 'users', uid, 'albums')),
    ]);
    const entries = entriesSnapshot.docs.map((snapshot) => snapshot.data() as CollectionEntry);
    const albums = albumsSnapshot.docs.map((snapshot) => snapshot.data() as Album);
    const data = { entries, albums };
    this.snapshots.set(uid, data);
    return data;
  }

  public async save(uid: string, data: CollectionData): Promise<void> {
    const [{ doc, writeBatch }, firestore] = await Promise.all([
      import('firebase/firestore'),
      getFirebaseFirestore(),
    ]);
    const previous = this.snapshots.get(uid) ?? EMPTY_COLLECTION;
    const previousEntries = new Map(
      previous.entries.map((entry) => [String(entry.speciesId), entry]),
    );
    const nextEntries = new Map(data.entries.map((entry) => [String(entry.speciesId), entry]));
    const previousAlbums = new Map(
      previous.albums.map((album) => [this.albumDocumentId(album.id), album]),
    );
    const nextAlbums = new Map(data.albums.map((album) => [this.albumDocumentId(album.id), album]));
    const writes: ((batch: WriteBatch) => void)[] = [];

    for (const [id, entry] of nextEntries) {
      if (JSON.stringify(previousEntries.get(id)) === JSON.stringify(entry)) continue;
      writes.push((batch) => batch.set(doc(firestore, 'users', uid, 'entries', id), entry));
    }
    for (const id of previousEntries.keys()) {
      if (!nextEntries.has(id))
        writes.push((batch) => batch.delete(doc(firestore, 'users', uid, 'entries', id)));
    }
    for (const [id, album] of nextAlbums) {
      if (JSON.stringify(previousAlbums.get(id)) === JSON.stringify(album)) continue;
      writes.push((batch) => batch.set(doc(firestore, 'users', uid, 'albums', id), album));
    }
    for (const id of previousAlbums.keys()) {
      if (!nextAlbums.has(id))
        writes.push((batch) => batch.delete(doc(firestore, 'users', uid, 'albums', id)));
    }

    const commits: Promise<void>[] = [];
    for (let offset = 0; offset < writes.length; offset += 450) {
      const batch = writeBatch(firestore);
      for (const write of writes.slice(offset, offset + 450)) write(batch);
      commits.push(batch.commit());
    }
    await Promise.all(commits);
    this.snapshots.set(uid, data);
  }

  public async saveIfUnchanged(
    uid: string,
    expected: CollectionData,
    data: CollectionData,
  ): Promise<void> {
    const [{ doc, runTransaction }, firestore] = await Promise.all([
      import('firebase/firestore'),
      getFirebaseFirestore(),
    ]);
    const previousEntries = new Map(
      expected.entries.map((entry) => [String(entry.speciesId), entry]),
    );
    const nextEntries = new Map(data.entries.map((entry) => [String(entry.speciesId), entry]));
    const previousAlbums = new Map(
      expected.albums.map((album) => [this.albumDocumentId(album.id), album]),
    );
    const nextAlbums = new Map(data.albums.map((album) => [this.albumDocumentId(album.id), album]));
    const changes: {
      path: 'entries' | 'albums';
      id: string;
      previous: CollectionEntry | Album | null;
      next: CollectionEntry | Album | null;
    }[] = [];
    for (const id of new Set([...previousEntries.keys(), ...nextEntries.keys()])) {
      const previous = previousEntries.get(id) ?? null;
      const next = nextEntries.get(id) ?? null;
      changes.push({ path: 'entries', id, previous, next });
    }
    for (const id of new Set([...previousAlbums.keys(), ...nextAlbums.keys()])) {
      const previous = previousAlbums.get(id) ?? null;
      const next = nextAlbums.get(id) ?? null;
      changes.push({ path: 'albums', id, previous, next });
    }
    if (changes.length > 450)
      throw new Error(
        'La comparación supera el límite de 450 documentos; no se ha cambiado la nube.',
      );
    if (changes.length) {
      await runTransaction(firestore, (transaction) =>
        checkAndWriteChanges(transaction, changes, (change) =>
          doc(firestore, 'users', uid, change.path, change.id),
        ),
      );
    }
    this.snapshots.set(uid, data);
  }

  private albumDocumentId(id: string): string {
    return encodeURIComponent(id);
  }
}

export async function checkAndWriteChanges(
  transaction: Transaction,
  changes: readonly {
    path: 'entries' | 'albums';
    id: string;
    previous: CollectionEntry | Album | null;
    next: CollectionEntry | Album | null;
  }[],
  reference: (change: (typeof changes)[number]) => DocumentReference,
): Promise<void> {
  const snapshots = await Promise.all(changes.map((change) => transaction.get(reference(change))));
  for (const [index, snapshot] of snapshots.entries()) {
    const current = snapshot.exists() ? (snapshot.data() as CollectionEntry | Album) : null;
    if (comparable(current) !== comparable(changes[index].previous))
      throw new Error('La nube cambió durante la resolución. Revisa de nuevo los conflictos.');
  }
  for (const change of changes) {
    if (comparable(change.previous) === comparable(change.next)) continue;
    if (change.next) transaction.set(reference(change), change.next);
    else transaction.delete(reference(change));
  }
}

export function mergeCollections(local: CollectionData, cloud: CollectionData): CollectionData {
  const entries = new Map(cloud.entries.map((entry) => [entry.speciesId, entry]));
  for (const entry of local.entries) entries.set(entry.speciesId, entry);

  const albums = new Map(cloud.albums.map((album) => [album.id, album]));
  for (const album of local.albums) {
    const existing = albums.get(album.id);
    albums.set(
      album.id,
      existing
        ? {
            ...existing,
            ...album,
            speciesIds: [...new Set([...existing.speciesIds, ...album.speciesIds])],
          }
        : album,
    );
  }
  const entryIds = new Set(entries.keys());
  return {
    entries: [...entries.values()],
    albums: [...albums.values()].map((album) => ({
      ...album,
      speciesIds: album.speciesIds.filter((speciesId) => entryIds.has(speciesId)),
    })),
  };
}

export type CollectionConflict =
  | {
      readonly key: string;
      readonly kind: 'entry';
      readonly id: number;
      readonly local: CollectionEntry | null;
      readonly cloud: CollectionEntry | null;
    }
  | {
      readonly key: string;
      readonly kind: 'album';
      readonly id: string;
      readonly local: Album | null;
      readonly cloud: Album | null;
    };

export interface CollectionMergePlan {
  readonly data: CollectionData;
  readonly conflicts: readonly CollectionConflict[];
}

function comparable(value: CollectionEntry | Album | null): string {
  if (!value) return 'null';
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .filter(([, entry]) => entry !== undefined)
          .sort(([first], [second]) => first.localeCompare(second))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    return item;
  };
  const normalized =
    'speciesIds' in value
      ? { ...value, speciesIds: [...value.speciesIds].sort((first, second) => first - second) }
      : value;
  return JSON.stringify(normalize(normalized));
}

export function planCollectionMerge(
  local: CollectionData,
  cloud: CollectionData,
  baseline?: CollectionData,
): CollectionMergePlan {
  const entries: CollectionEntry[] = [];
  const albums: Album[] = [];
  const conflicts: CollectionConflict[] = [];
  const localEntries = new Map(local.entries.map((entry) => [entry.speciesId, entry]));
  const cloudEntries = new Map(cloud.entries.map((entry) => [entry.speciesId, entry]));
  const baseEntries = new Map(baseline?.entries.map((entry) => [entry.speciesId, entry]) ?? []);
  const entryIds = new Set([...localEntries.keys(), ...cloudEntries.keys(), ...baseEntries.keys()]);
  for (const id of entryIds) {
    const localEntry = localEntries.get(id) ?? null;
    const cloudEntry = cloudEntries.get(id) ?? null;
    const baseEntry = baseEntries.get(id) ?? null;
    const equal = comparable(localEntry) === comparable(cloudEntry);
    const localChanged = comparable(localEntry) !== comparable(baseEntry);
    const cloudChanged = comparable(cloudEntry) !== comparable(baseEntry);
    if (!equal && (baseline ? localChanged && cloudChanged : !!localEntry && !!cloudEntry)) {
      conflicts.push({
        key: `entry:${id}`,
        kind: 'entry',
        id,
        local: localEntry,
        cloud: cloudEntry,
      });
    } else {
      const selected = baseline
        ? localChanged
          ? localEntry
          : cloudEntry
        : (localEntry ?? cloudEntry);
      if (selected) entries.push(selected);
    }
  }
  const localAlbums = new Map(local.albums.map((album) => [album.id, album]));
  const cloudAlbums = new Map(cloud.albums.map((album) => [album.id, album]));
  const baseAlbums = new Map(baseline?.albums.map((album) => [album.id, album]) ?? []);
  const albumIds = new Set([...localAlbums.keys(), ...cloudAlbums.keys(), ...baseAlbums.keys()]);
  for (const id of albumIds) {
    const localAlbum = localAlbums.get(id) ?? null;
    const cloudAlbum = cloudAlbums.get(id) ?? null;
    const baseAlbum = baseAlbums.get(id) ?? null;
    const equal = comparable(localAlbum) === comparable(cloudAlbum);
    const localChanged = comparable(localAlbum) !== comparable(baseAlbum);
    const cloudChanged = comparable(cloudAlbum) !== comparable(baseAlbum);
    if (
      !equal &&
      (baseline
        ? localChanged && cloudChanged
        : !!localAlbum && !!cloudAlbum && localAlbum.name !== cloudAlbum.name)
    ) {
      conflicts.push({
        key: `album:${id}`,
        kind: 'album',
        id,
        local: localAlbum,
        cloud: cloudAlbum,
      });
    } else if (!baseline && localAlbum && cloudAlbum) {
      albums.push({
        ...localAlbum,
        speciesIds: [...new Set([...cloudAlbum.speciesIds, ...localAlbum.speciesIds])],
      });
    } else {
      const selected = baseline
        ? localChanged
          ? localAlbum
          : cloudAlbum
        : (localAlbum ?? cloudAlbum);
      if (selected) albums.push(selected);
    }
  }
  return { data: { entries, albums }, conflicts };
}

export function resolveCollectionMerge(
  plan: CollectionMergePlan,
  choices: Readonly<Record<string, 'local' | 'cloud'>>,
): CollectionData {
  const entries = [...plan.data.entries];
  const albums = [...plan.data.albums];
  for (const conflict of plan.conflicts) {
    const choice = choices[conflict.key];
    if (choice !== 'local' && choice !== 'cloud')
      throw new Error('Elige una versión para cada conflicto.');
    if (conflict.kind === 'entry') {
      const selected = conflict[choice];
      if (selected) entries.push(selected);
    } else {
      const selected = conflict[choice];
      if (selected) albums.push(selected);
    }
  }
  const available = new Set(entries.map((entry) => entry.speciesId));
  return {
    entries,
    albums: albums.map((album) => ({
      ...album,
      speciesIds: album.speciesIds.filter((id) => available.has(id)),
    })),
  };
}

export function validateCloudData(
  data: CollectionData,
  species: readonly PokemonSpecies[],
): CollectionData {
  const backup = createBackup(data);
  const parsed = parseBackup(JSON.stringify(backup), species);
  return { entries: parsed.entries, albums: parsed.albums };
}
