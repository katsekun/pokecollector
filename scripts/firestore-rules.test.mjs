import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST)
  throw new Error('Run with npm run test:rules; production testing is forbidden.');
const owner = 'owner';
const friend = 'friend';
let environment;
const database = (uid, email = `${uid}@gmail.com`, verified = true) =>
  environment.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const original = {
  ownerUid: owner,
  ownerEmail: 'owner@gmail.com',
  invitedEmail: 'friend@gmail.com',
  memberUids: [owner],
  contributedUids: [owner],
  status: 'pending',
  activeRevision: 'first',
};
const invitation = {
  groupId: 'pair',
  senderUid: owner,
  senderEmail: 'owner@gmail.com',
  recipientEmail: 'friend@gmail.com',
  state: 'pending',
};
const manifest = {
  authorUid: owner,
  baseRevision: '',
  state: 'published',
  count: 1,
  bytes: 100,
  checksum: 'a'.repeat(64),
};

before(async () => {
  const rules = (await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')).replace(
    "'TgkbqxWePHSWYHZijMXoLSl66j83'",
    "'owner', 'friend', 'third'",
  );
  environment = await initializeTestEnvironment({
    projectId: 'demo-pokecollector',
    firestore: { rules },
  });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, 'groups/pair'), original);
    await setDoc(doc(firestore, 'userGroupState/owner'), { groupId: 'pair' });
    await setDoc(doc(firestore, 'groupInvitations/pair'), invitation);
    await setDoc(doc(firestore, 'groups/pair/revisions/first'), manifest);
    await setDoc(doc(firestore, 'groups/pair/revisions/first/chunks/0'), { payload: 'original' });
  });
});
after(async () => {
  await environment?.cleanup();
});

test('private collections deny guests, non-whitelist accounts and other users', async () => {
  await assertSucceeds(setDoc(doc(database(owner), 'users/owner/entries/1'), { test: true }));
  await assertFails(getDoc(doc(database(friend), 'users/owner/entries/1')));
  await assertFails(getDoc(doc(database('unknown'), 'users/owner/entries/1')));
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'groups/pair')));
});
test('recipient can query only invitations to their verified exact email', async () => {
  await assertSucceeds(
    getDocs(
      query(
        collection(database(friend), 'groupInvitations'),
        where('recipientEmail', '==', 'friend@gmail.com'),
      ),
    ),
  );
  await assertFails(getDocs(collection(database(friend), 'groupInvitations')));
  await assertFails(
    getDoc(doc(database(friend, 'friend@gmail.com', false), 'groupInvitations/pair')),
  );
  await assertFails(getDoc(doc(database('third'), 'groupInvitations/pair')));
  await assertFails(getDoc(doc(database(friend), 'groups/pair/revisions/first/chunks/0')));
});
test('verified recipient claims atomically without reading private personal collections', async () => {
  const firestore = database(friend);
  const batch = writeBatch(firestore);
  batch.update(doc(firestore, 'groups/pair'), { memberUids: [owner, friend], status: 'active' });
  batch.set(doc(firestore, 'userGroupState/friend'), { groupId: 'pair' });
  batch.update(doc(firestore, 'groupInvitations/pair'), { state: 'claimed' });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(firestore, 'groups/pair/revisions/first/chunks/0')));
  await assertSucceeds(
    getDocs(query(collection(firestore, 'groups'), where('memberUids', 'array-contains', friend))),
  );
  await assertFails(getDoc(doc(firestore, 'users/owner/entries/1')));
});
test('cannot self-join, overwrite another reservation, change emails or add a third member', async () => {
  await assertFails(
    updateDoc(doc(database('third'), 'groups/pair'), {
      memberUids: [owner, 'third'],
      status: 'active',
    }),
  );
  await assertFails(setDoc(doc(database(friend), 'userGroupState/owner'), { groupId: 'pair' }));
  await assertFails(
    updateDoc(doc(database(owner), 'groups/pair'), { invitedEmail: 'third@gmail.com' }),
  );
  await assertFails(
    updateDoc(doc(database(owner), 'groups/pair'), { memberUids: [owner, friend, 'third'] }),
  );
});
test('create requires a reciprocal reservation and no other active group', async () => {
  const firestore = database(friend);
  const group = {
    ...original,
    ownerUid: friend,
    ownerEmail: 'friend@gmail.com',
    invitedEmail: 'third@gmail.com',
    memberUids: [friend],
    contributedUids: [],
    activeRevision: '',
  };
  await assertFails(setDoc(doc(firestore, 'groups/new'), group));
  const batch = writeBatch(firestore);
  batch.set(doc(firestore, 'groups/new'), group);
  batch.set(doc(firestore, 'userGroupState/friend'), { groupId: 'new' });
  await assertSucceeds(batch.commit());
  const second = writeBatch(firestore);
  second.set(doc(firestore, 'groups/another'), group);
  second.set(doc(firestore, 'userGroupState/friend'), { groupId: 'another' });
  await assertFails(second.commit());
});
test('revision publication requires staging author and matching base with an atomic pointer change', async () => {
  const firestore = database(owner);
  const revision = doc(firestore, 'groups/pair/revisions/next');
  await assertSucceeds(setDoc(revision, { ...manifest, state: 'staging', baseRevision: 'first' }));
  await assertSucceeds(
    setDoc(doc(firestore, 'groups/pair/revisions/next/chunks/0'), { payload: 'next' }),
  );
  await assertFails(updateDoc(revision, { state: 'published' }));
  await assertFails(updateDoc(doc(firestore, 'groups/pair'), { activeRevision: 'next' }));
  const publish = writeBatch(firestore);
  publish.update(revision, { state: 'published' });
  publish.update(doc(firestore, 'groups/pair'), { activeRevision: 'next' });
  await assertSucceeds(publish.commit());
  await assertFails(
    setDoc(doc(firestore, 'groups/pair/revisions/next/chunks/0'), { payload: 'mutated' }),
  );
  await assertFails(
    setDoc(doc(firestore, 'groups/pair/revisions/next/chunks/1'), { payload: 'late' }),
  );
  await assertFails(updateDoc(revision, { checksum: 'b'.repeat(64) }));
  await assertFails(updateDoc(doc(firestore, 'groups/pair'), { activeRevision: 'first' }));
});
test('closed groups remain readable by former members but cannot be edited or reopened', async () => {
  const firestore = database(owner);
  await assertSucceeds(updateDoc(doc(firestore, 'groups/pair'), { status: 'closed' }));
  await assertSucceeds(getDoc(doc(firestore, 'groups/pair/revisions/first/chunks/0')));
  await assertFails(updateDoc(doc(firestore, 'groups/pair'), { status: 'pending' }));
  await assertFails(
    setDoc(doc(firestore, 'groups/pair/revisions/late'), {
      ...manifest,
      state: 'staging',
      baseRevision: 'first',
    }),
  );
  await assertFails(getDoc(doc(database('third'), 'groups/pair/revisions/first/chunks/0')));
});
test('two competing publications cannot overwrite the newer revision', async () => {
  const firestore = database(owner);
  for (const id of ['next-a', 'next-b']) {
    await setDoc(doc(firestore, `groups/pair/revisions/${id}`), {
      ...manifest,
      state: 'staging',
      baseRevision: 'first',
    });
    await setDoc(doc(firestore, `groups/pair/revisions/${id}/chunks/0`), { payload: id });
  }
  const publish = (id) =>
    runTransaction(firestore, async (transaction) => {
      const reference = doc(firestore, 'groups/pair');
      const group = await transaction.get(reference);
      if (group.data().activeRevision !== 'first') throw new Error('Stale revision');
      transaction.update(doc(firestore, `groups/pair/revisions/${id}`), { state: 'published' });
      transaction.update(reference, { activeRevision: id });
    });
  const results = await Promise.allSettled([publish('next-a'), publish('next-b')]);
  if (results.filter((result) => result.status === 'fulfilled').length !== 1)
    throw new Error('Exactly one publication must succeed');
  const current = (await getDoc(doc(firestore, 'groups/pair'))).data().activeRevision;
  if (!['next-a', 'next-b'].includes(current)) throw new Error('Committed revision missing');
});
test('closing the group rejects an already-staged revision publication', async () => {
  const firestore = database(owner);
  const revision = doc(firestore, 'groups/pair/revisions/staged');
  await setDoc(revision, { ...manifest, state: 'staging', baseRevision: 'first' });
  await updateDoc(doc(firestore, 'groups/pair'), { status: 'closed' });
  const batch = writeBatch(firestore);
  batch.update(revision, { state: 'published' });
  batch.update(doc(firestore, 'groups/pair'), { activeRevision: 'staged' });
  await assertFails(batch.commit());
});
test('all blocks of a five MB revision fit in one permitted batch', async () => {
  const firestore = database(owner);
  await setDoc(doc(firestore, 'groups/pair/revisions/large'), {
    ...manifest,
    state: 'staging',
    baseRevision: 'first',
    count: 313,
    bytes: 5_000_000,
  });
  const batch = writeBatch(firestore);
  for (let index = 0; index < 313; index++) {
    batch.set(doc(firestore, `groups/pair/revisions/large/chunks/${index}`), {
      payload: 'x'.repeat(index === 312 ? 8000 : 16000),
    });
  }
  await assertSucceeds(batch.commit());
  await assertFails(
    setDoc(doc(firestore, 'groups/pair/revisions/large/chunks/313'), {
      payload: 'outside manifest',
    }),
  );
});
