import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { array, enum as enumeration, object, string } from 'zod';
import { FirebaseAuthService } from './firebase-auth';
import { getFirebaseFirestore } from './firebase-runtime';
import { CollectionData } from './collection';
import { GroupCollectionRepository } from './group-collection';

export const groupSchema = object({
  ownerUid: string().min(1),
  ownerEmail: string().email(),
  invitedEmail: string().email(),
  memberUids: array(string().min(1)).min(1).max(2),
  contributedUids: array(string().min(1)).max(2),
  status: enumeration(['pending', 'active', 'closed']),
  activeRevision: string(),
});
export interface Group {
  readonly id: string;
  readonly ownerUid: string;
  readonly ownerEmail: string;
  readonly invitedEmail: string;
  readonly memberUids: string[];
  readonly contributedUids: string[];
  readonly status: 'pending' | 'active' | 'closed';
  readonly activeRevision: string;
}

export interface GroupInvitation {
  readonly id: string;
  readonly groupId: string;
  readonly senderUid: string;
  readonly senderEmail: string;
  readonly recipientEmail: string;
  readonly state: 'pending' | 'claimed' | 'closed';
}

export function invitationEmail(value: string, ownEmail: string): string {
  const email = value.trim();
  if (!string().email().safeParse(email).success)
    throw new Error('Introduce el correo Google exacto de la otra persona.');
  if (email.toLowerCase() === ownEmail.toLowerCase())
    throw new Error('No puedes agruparte contigo mismo.');
  return email;
}

@Injectable({ providedIn: 'root' })
export class Groups {
  private readonly auth = inject(FirebaseAuthService);
  private readonly collections = inject(GroupCollectionRepository);
  private readonly _started = signal(false);
  private subscriptions: (() => void)[] = [];
  private generation = 0;
  public readonly _groups = signal<readonly Group[]>([]);
  public readonly _invitations = signal<readonly GroupInvitation[]>([]);
  public readonly _busy = signal(false);
  public readonly _error = signal('');
  public readonly _loaded = signal(false);
  public readonly _current = computed(
    () => this._groups().find((group) => group.status !== 'closed') ?? null,
  );
  public readonly _archives = computed(() =>
    this._groups().filter((group) => group.status === 'closed'),
  );

  public constructor() {
    effect((cleanup) => {
      const user = this.auth._user();
      if (!this._started()) return;
      const generation = ++this.generation;
      this.stop();
      this._groups.set([]);
      this._invitations.set([]);
      this._loaded.set(false);
      this._error.set('');
      if (user?.email && user.emailVerified) void this.listen(user.uid, user.email, generation);
      else if (user)
        this._error.set('La cuenta debe tener un correo Google verificado para usar grupos.');
      cleanup(() => {
        this.generation += 1;
        this.stop();
      });
    });
  }

  public start(): void {
    this._started.set(true);
  }

  public async create(emailValue: string, data: CollectionData): Promise<void> {
    await this.operation(async () => {
      const user = this.identity();
      const email = invitationEmail(emailValue, user.email);
      const [{ doc, runTransaction }, firestore] = await Promise.all([
        import('firebase/firestore'),
        getFirebaseFirestore(),
      ]);
      const id = crypto.randomUUID();
      const stateRef = doc(firestore, 'userGroupState', user.uid);
      const groupRef = doc(firestore, 'groups', id);
      await runTransaction(firestore, async (transaction) => {
        const state = await transaction.get(stateRef);
        const previousId = state.data()?.['groupId'];
        if (typeof previousId === 'string' && previousId) {
          const previous = await transaction.get(doc(firestore, 'groups', previousId));
          if (previous.exists() && previous.data()['status'] !== 'closed')
            throw new Error('Ya tienes una agrupación activa.');
        }
        transaction.set(groupRef, {
          ownerUid: user.uid,
          ownerEmail: user.email,
          invitedEmail: email,
          memberUids: [user.uid],
          contributedUids: [],
          status: 'pending',
          activeRevision: '',
        });
        transaction.set(stateRef, { groupId: id });
      });
      try {
        await this.collections.save(id, user.uid, '', data, true);
        if (this.auth._user()?.uid !== user.uid) return;
        await runTransaction(firestore, async (transaction) => {
          const current = await transaction.get(groupRef);
          if (current.data()?.['status'] !== 'pending' || !current.data()?.['activeRevision'])
            throw new Error('La agrupación cambió antes de enviar la invitación.');
          transaction.set(doc(firestore, 'groupInvitations', id), {
            groupId: id,
            senderUid: user.uid,
            senderEmail: user.email,
            recipientEmail: email,
            state: 'pending',
          });
        });
      } catch (error) {
        if (this.auth._user()?.uid === user.uid)
          await this.closeTransaction(id).catch(() => undefined);
        throw error;
      }
    });
  }

  public async refresh(): Promise<void> {
    this._error.set('');
    for (const invitation of this._invitations()) {
      if (invitation.state === 'pending') await this.claim(invitation);
    }
  }

  public async close(groupId: string): Promise<void> {
    await this.operation(() => this.closeTransaction(groupId));
  }

  private async closeTransaction(groupId: string): Promise<void> {
    const user = this.identity();
    const [{ doc, runTransaction }, firestore] = await Promise.all([
      import('firebase/firestore'),
      getFirebaseFirestore(),
    ]);
    await runTransaction(firestore, async (transaction) => {
      const reference = doc(firestore, 'groups', groupId);
      const invitationRef = doc(firestore, 'groupInvitations', groupId);
      const snapshot = await transaction.get(reference);
      const invitation = await transaction.get(invitationRef);
      if (!snapshot.exists() || !snapshot.data()['memberUids'].includes(user.uid))
        throw new Error('No perteneces a esta agrupación.');
      if (snapshot.data()['status'] === 'closed') return;
      transaction.update(reference, { status: 'closed' });
      if (invitation.exists()) transaction.update(invitationRef, { state: 'closed' });
    });
  }

  private async claim(invitation: GroupInvitation): Promise<void> {
    await this.operation(async () => {
      const user = this.identity();
      if (invitation.recipientEmail !== user.email)
        throw new Error('El correo de la invitación no coincide con tu cuenta Google.');
      const [{ doc, runTransaction }, firestore] = await Promise.all([
        import('firebase/firestore'),
        getFirebaseFirestore(),
      ]);
      await runTransaction(firestore, async (transaction) => {
        const inviteRef = doc(firestore, 'groupInvitations', invitation.id);
        const groupRef = doc(firestore, 'groups', invitation.groupId);
        const stateRef = doc(firestore, 'userGroupState', user.uid);
        const [invite, snapshot, state] = await Promise.all([
          transaction.get(inviteRef),
          transaction.get(groupRef),
          transaction.get(stateRef),
        ]);
        if (invite.data()?.['state'] !== 'pending') return;
        const group = groupSchema.parse(snapshot.data());
        if (group.status !== 'pending' || !group.activeRevision || group.memberUids.length !== 1)
          throw new Error('La agrupación ya no está disponible.');
        const previousId = state.data()?.['groupId'];
        if (typeof previousId === 'string' && previousId) {
          const previous = await transaction.get(doc(firestore, 'groups', previousId));
          if (previous.exists() && previous.data()['status'] !== 'closed')
            throw new Error('Ya tienes otra agrupación activa. Disuélvela antes de vincular esta.');
        }
        transaction.update(groupRef, {
          memberUids: [...group.memberUids, user.uid],
          status: 'active',
        });
        transaction.set(stateRef, { groupId: invitation.groupId });
        transaction.update(inviteRef, { state: 'claimed' });
      });
    });
  }

  private async listen(uid: string, email: string, generation: number): Promise<void> {
    try {
      const [{ collection, query, where, onSnapshot }, firestore] = await Promise.all([
        import('firebase/firestore'),
        getFirebaseFirestore(),
      ]);
      if (generation !== this.generation) return;
      const fail = (error: Error) => {
        if (generation === this.generation)
          this._error.set(
            `Grupos no disponibles. Comprueba la whitelist y las reglas publicadas. ${error.message}`,
          );
      };
      this.subscriptions.push(
        onSnapshot(
          query(collection(firestore, 'groups'), where('memberUids', 'array-contains', uid)),
          (snapshot) => {
            if (generation !== this.generation) return;
            try {
              this._groups.set(
                snapshot.docs.map((document) => ({
                  id: document.id,
                  ...groupSchema.parse(document.data()),
                })),
              );
              this._loaded.set(true);
            } catch {
              this._error.set('Los metadatos del grupo no son válidos.');
            }
          },
          fail,
        ),
      );
      this.subscriptions.push(
        onSnapshot(
          query(collection(firestore, 'groupInvitations'), where('recipientEmail', '==', email)),
          (snapshot) => {
            if (generation !== this.generation) return;
            this._invitations.set(
              snapshot.docs.map(
                (document) => ({ id: document.id, ...document.data() }) as GroupInvitation,
              ),
            );
            void this.refresh();
          },
          fail,
        ),
      );
    } catch (error) {
      if (generation === this.generation)
        this._error.set(
          error instanceof Error ? error.message : 'No se pudo conectar con los grupos.',
        );
    }
  }

  private identity(): { uid: string; email: string } {
    const user = this.auth._user();
    if (!user?.email || !user.emailVerified)
      throw new Error('Inicia sesión con un correo Google verificado.');
    return { uid: user.uid, email: user.email };
  }

  private async operation(action: () => Promise<void>): Promise<void> {
    if (this._busy()) return;
    this._busy.set(true);
    this._error.set('');
    try {
      await action();
    } catch (error) {
      this._error.set(
        error instanceof Error ? error.message : 'No se pudo completar la operación del grupo.',
      );
    } finally {
      this._busy.set(false);
    }
  }

  private stop(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
  }
}
