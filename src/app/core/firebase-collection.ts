import { Injectable } from '@angular/core';
import { type WriteBatch } from 'firebase/firestore';
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

  private albumDocumentId(id: string): string {
    return encodeURIComponent(id);
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

export function validateCloudData(
  data: CollectionData,
  species: readonly PokemonSpecies[],
): CollectionData {
  const backup = createBackup(data);
  const parsed = parseBackup(JSON.stringify(backup), species);
  return { entries: parsed.entries, albums: parsed.albums };
}
