import { Injectable } from '@angular/core';
import { CollectionData, createBackup, parseBackup, PokemonSpecies } from './collection';
import { getFirebaseFirestore } from './firebase-runtime';

export interface GroupRevision {
  readonly count: number;
  readonly bytes: number;
  readonly checksum: string;
}

export interface GroupSnapshot {
  readonly revision: string;
  readonly data: CollectionData;
}

export async function encodeGroupCollection(
  data: CollectionData,
): Promise<{ manifest: GroupRevision; chunks: string[] }> {
  const text = JSON.stringify(createBackup(data));
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 5_000_000)
    throw new Error('La colección combinada supera 5 MB. Las colecciones originales se conservan.');
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + 16_000, text.length);
    const lastCode = text.codePointAt(end - 1) ?? 0;
    if (lastCode > 0xffff) end -= 1;
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return { manifest: { count: chunks.length, bytes: bytes.length, checksum }, chunks };
}

export async function decodeGroupCollection(
  manifest: GroupRevision,
  chunks: readonly string[],
  species: readonly PokemonSpecies[],
): Promise<CollectionData> {
  if (
    !Number.isInteger(manifest.count) ||
    manifest.count < 1 ||
    manifest.count > 313 ||
    manifest.bytes > 5_000_000 ||
    manifest.bytes < 1 ||
    chunks.length !== manifest.count ||
    chunks.some((chunk) => typeof chunk !== 'string' || chunk.length > 16_000)
  )
    throw new Error(
      'La versión del grupo está incompleta o no es válida. La copia local se conserva.',
    );
  const text = chunks.join('');
  const bytes = new TextEncoder().encode(text);
  const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (bytes.length !== manifest.bytes || checksum !== manifest.checksum)
    throw new Error('La integridad de la colección compartida no es válida.');
  const backup = parseBackup(text, species);
  return { entries: backup.entries, albums: backup.albums };
}

@Injectable({ providedIn: 'root' })
export class GroupCollectionRepository {
  public async load(groupId: string, species: readonly PokemonSpecies[]): Promise<GroupSnapshot> {
    const [{ doc, getDocFromServer }, firestore] = await Promise.all([
      import('firebase/firestore'),
      getFirebaseFirestore(),
    ]);
    const group = await getDocFromServer(doc(firestore, 'groups', groupId));
    const revision = group.data()?.['activeRevision'];
    if (typeof revision !== 'string' || !revision)
      throw new Error('El grupo todavía no tiene una colección publicada.');
    const metadata = await getDocFromServer(
      doc(firestore, 'groups', groupId, 'revisions', revision),
    );
    if (!metadata.exists() || metadata.data()['state'] !== 'published')
      throw new Error('La versión del grupo no está publicada.');
    const manifest = metadata.data() as GroupRevision;
    if (!Number.isInteger(manifest.count) || manifest.count < 1 || manifest.count > 313)
      throw new Error('Manifest del grupo no válido.');
    const chunks = await Promise.all(
      Array.from({ length: manifest.count }, async (_, index) => {
        const chunk = await getDocFromServer(
          doc(firestore, 'groups', groupId, 'revisions', revision, 'chunks', String(index)),
        );
        if (!chunk.exists() || typeof chunk.data()['payload'] !== 'string')
          throw new Error('Falta un bloque de la colección compartida.');
        return chunk.data()['payload'] as string;
      }),
    );
    return { revision, data: await decodeGroupCollection(manifest, chunks, species) };
  }

  public async save(
    groupId: string,
    uid: string,
    expectedRevision: string,
    data: CollectionData,
    contributed = false,
  ): Promise<string> {
    const encoded = await encodeGroupCollection(data);
    const [{ doc, setDoc, writeBatch, runTransaction }, firestore] = await Promise.all([
      import('firebase/firestore'),
      getFirebaseFirestore(),
    ]);
    const revisionId = crypto.randomUUID();
    const revision = doc(firestore, 'groups', groupId, 'revisions', revisionId);
    await setDoc(revision, {
      ...encoded.manifest,
      authorUid: uid,
      baseRevision: expectedRevision,
      state: 'staging',
    });
    const batch = writeBatch(firestore);
    encoded.chunks.forEach((payload, index) =>
      batch.set(
        doc(firestore, 'groups', groupId, 'revisions', revisionId, 'chunks', String(index)),
        { payload },
      ),
    );
    await batch.commit();
    await runTransaction(firestore, async (transaction) => {
      const reference = doc(firestore, 'groups', groupId);
      const snapshot = await transaction.get(reference);
      const group = snapshot.data();
      if (!group || group['status'] === 'closed' || group['activeRevision'] !== expectedRevision)
        throw new Error(
          'El grupo cambió o se cerró durante el guardado. Vuelve a revisar la comparación.',
        );
      transaction.update(revision, { state: 'published' });
      const changes: Record<string, unknown> = { activeRevision: revisionId };
      if (contributed)
        changes['contributedUids'] = [...new Set([...(group['contributedUids'] as string[]), uid])];
      transaction.update(reference, changes);
    });
    return revisionId;
  }
}
