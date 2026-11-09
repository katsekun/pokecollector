import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { FirebaseAuthService } from '../../core/firebase-auth';
import { Groups, Group } from '../../core/groups';
import { CollectionStore } from '../../core/collection-store';
import { FirebaseCloudSync } from '../../core/firebase-cloud-sync';
import { GroupCollectionRepository } from '../../core/group-collection';
import { Album, CollectionData, CollectionEntry, createBackup } from '../../core/collection';
import {
  CollectionConflict,
  CollectionMergePlan,
  planCollectionMerge,
  resolveCollectionMerge,
  validateCloudData,
} from '../../core/firebase-collection';
import { Icon } from '../../shared/icon';

interface IncorporationReview {
  readonly purpose: 'contribute' | 'copy' | 'legacy';
  readonly uid: string;
  readonly groupId: string;
  readonly revision: string;
  readonly local: CollectionData;
  readonly source: CollectionData;
  readonly plan: CollectionMergePlan;
}

@Component({
  selector: 'app-group-settings',
  imports: [Icon],
  styleUrl: './settings-page.scss',
  template: `
    <section class="settings" aria-labelledby="group-heading">
      <div class="settings__heading">
        <app-icon name="album" />
        <h2 id="group-heading">Grupo compartido</h2>
      </div>
      @if (!auth._user()) {
        <p class="settings__conflict-note">Sin sesión</p>
      } @else {
        <div class="settings__row settings__backup-actions">
          <button
            type="button"
            class="button button--outline"
            [disabled]="_locked()"
            (click)="openPersonal()"
          >
            Mi colección personal
          </button>
          <button
            type="button"
            class="button button--outline"
            [disabled]="_locked()"
            (click)="prepareLegacy()"
          >
            Recuperar copia anterior del navegador
          </button>
        </div>
        @if (groups._error()) {
          <p class="settings__warning" role="alert">{{ groups._error() }}</p>
        }
        @if (groups._current(); as group) {
          <div class="settings__row">
            <strong>{{ group.ownerEmail }} + {{ group.invitedEmail }}</strong>
            <p class="settings__conflict-note">
              {{
                group.status === 'pending'
                  ? 'Pendiente de vincular la segunda cuenta'
                  : 'Dos personas vinculadas'
              }}
            </p>
            <div class="settings__backup-actions">
              <button
                type="button"
                class="button button--outline"
                [disabled]="_locked() || !group.activeRevision"
                (click)="sync.openCollection('group:' + group.id)"
              >
                Abrir colección del grupo
              </button>
              @if (!group.contributedUids.includes(auth._user()!.uid)) {
                <button
                  type="button"
                  class="button button--primary"
                  [disabled]="_locked()"
                  (click)="prepare(group, 'contribute')"
                >
                  Revisar aportación personal
                </button>
              }
              <button
                type="button"
                class="button button--outline"
                [disabled]="_locked() || !group.activeRevision"
                (click)="exportGroup(group)"
              >
                <app-icon name="download" /> Exportar grupo
              </button>
              <button
                type="button"
                class="button button--outline"
                [disabled]="_locked()"
                (click)="_closing.set(group.id)"
              >
                {{ group.status === 'pending' ? 'Cancelar agrupación' : 'Disolver agrupación' }}
              </button>
            </div>
            @if (_closing() === group.id) {
              <div class="settings__row" role="group" aria-label="Confirmar disolución">
                <p>
                  La agrupación se cerrará para ambos. Las colecciones personales no cambian y la
                  última versión compartida queda archivada.
                </p>
                <div class="settings__backup-actions">
                  <button
                    type="button"
                    class="button button--primary"
                    [disabled]="_locked()"
                    (click)="close(group)"
                  >
                    Confirmar disolución
                  </button>
                  <button type="button" class="button button--outline" (click)="_closing.set('')">
                    Volver
                  </button>
                </div>
              </div>
            }
          </div>
        } @else if (groups._loaded()) {
          <div class="settings__row">
            <label for="group-email">Correo Google de la otra persona</label>
            <input
              id="group-email"
              class="settings__email"
              type="email"
              autocomplete="off"
              [value]="_email()"
              (input)="_email.set($any($event.target).value)"
              [disabled]="_locked()"
            />
            <label class="settings__toggle"
              ><input
                type="checkbox"
                [checked]="_shareConfirmed()"
                (change)="_shareConfirmed.set($any($event.target).checked)"
              />Compartir una copia de mis cartas, deseados, álbumes y precios</label
            >
            <div class="settings__backup-actions">
              <button
                type="button"
                class="button button--primary"
                [disabled]="_locked() || !_email().trim() || !_shareConfirmed()"
                (click)="create()"
              >
                Crear agrupación
              </button>
            </div>
          </div>
        } @else if (!groups._error()) {
          <p role="status">Consultando agrupaciones…</p>
        }
        @if (groups._invitations().some(pendingInvitation)) {
          <button
            type="button"
            class="button button--outline"
            [disabled]="_locked()"
            (click)="groups.refresh()"
          >
            <app-icon name="refresh" /> Revisar vinculaciones pendientes
          </button>
        }
        @for (archive of groups._archives(); track archive.id) {
          @if (archive.activeRevision) {
            <div class="settings__row">
              <strong
                >Archivo cerrado: {{ archive.ownerEmail }} + {{ archive.invitedEmail }}</strong
              >
              <div class="settings__backup-actions">
                <button
                  type="button"
                  class="button button--outline"
                  [disabled]="_locked()"
                  (click)="exportGroup(archive)"
                >
                  <app-icon name="download" /> Exportar archivo
                </button>
                <button
                  type="button"
                  class="button button--outline"
                  [disabled]="_locked()"
                  (click)="prepare(archive, 'copy')"
                >
                  Revisar copia a mi personal
                </button>
                <button
                  type="button"
                  class="button button--outline"
                  [disabled]="_locked()"
                  (click)="exportDraft(archive)"
                >
                  <app-icon name="download" /> Exportar borrador local
                </button>
              </div>
            </div>
          }
        }
        @if (_review(); as review) {
          <div class="settings__row">
            <h3>
              {{
                review.purpose === 'contribute'
                  ? 'Aportar mi colección al grupo'
                  : 'Combinar con mi colección personal'
              }}
            </h3>
            <p class="settings__conflict-note">
              Tu personal no se sustituye. Revisa las diferencias; elegir una carta eliminada
              también la quita de los álbumes. Exporta un respaldo personal antes de continuar.
            </p>
            <p>
              {{ review.local.entries.length }} cartas personales ·
              {{ review.source.entries.length }} cartas en la otra copia ·
              {{ review.plan.conflicts.length }} diferencias
            </p>
            @for (conflict of review.plan.conflicts; track conflict.key) {
              <fieldset class="settings__conflict">
                <legend>{{ title(conflict) }}</legend>
                <div class="settings__versions">
                  @for (side of sides; track side) {
                    <label class="settings__version">
                      <span class="settings__version-heading"
                        ><input
                          type="radio"
                          [name]="'group-' + conflict.key"
                          [checked]="_choices()[conflict.key] === side"
                          [disabled]="_locked()"
                          (change)="choose(conflict.key, side)"
                        /><strong>{{
                          side === 'local'
                            ? 'Mi personal'
                            : review.purpose === 'legacy'
                              ? 'Copia anterior'
                              : 'Grupo'
                        }}</strong></span
                      >
                      <span>{{ describe(conflict[side]) }}</span>
                    </label>
                  }
                </div>
              </fieldset>
            }
            <div class="settings__backup-actions">
              <button
                type="button"
                class="button button--outline"
                [disabled]="_locked()"
                (click)="exportPersonal()"
              >
                <app-icon name="download" /> Respaldo personal
              </button>
              <button
                type="button"
                class="button button--primary"
                [disabled]="_locked() || !complete(review)"
                (click)="apply(review)"
              >
                {{
                  review.purpose === 'contribute'
                    ? 'Confirmar aportación'
                    : 'Confirmar combinación personal'
                }}
              </button>
              <button
                type="button"
                class="button button--outline"
                [disabled]="_locked()"
                (click)="cancelReview()"
              >
                Cancelar
              </button>
            </div>
          </div>
        }
        @if (_feedback()) {
          <output class="settings__feedback" role="status">{{ _feedback() }}</output>
        }
      }
    </section>
  `,
})
export class GroupSettings implements OnInit {
  protected readonly auth = inject(FirebaseAuthService);
  protected readonly groups = inject(Groups);
  protected readonly sync = inject(FirebaseCloudSync);
  private readonly store = inject(CollectionStore);
  private readonly repository = inject(GroupCollectionRepository);
  private readonly document = inject(DOCUMENT);
  protected readonly _email = signal('');
  protected readonly _shareConfirmed = signal(false);
  protected readonly _closing = signal('');
  protected readonly _busy = signal(false);
  protected readonly _feedback = signal('');
  protected readonly _review = signal<IncorporationReview | null>(null);
  protected readonly _choices = signal<Record<string, 'local' | 'cloud'>>({});
  protected readonly _locked = computed(
    () =>
      this._busy() ||
      this.groups._busy() ||
      ['saving', 'connecting'].includes(this.sync._status()) ||
      this.store._storageBlocked(),
  );
  protected readonly sides = ['local', 'cloud'] as const;
  protected readonly pendingInvitation = (invitation: { state: string }): boolean =>
    invitation.state === 'pending';

  public constructor() {
    effect(() => {
      this.auth._user();
      untracked(() => {
        this.cancelReview();
        this._closing.set('');
        this._shareConfirmed.set(false);
        this._email.set('');
        this._feedback.set('');
      });
    });
  }

  public ngOnInit(): void {
    this.groups.start();
  }

  protected openPersonal(): void {
    const uid = this.auth._user()?.uid;
    if (uid) {
      this.cancelReview();
      this.sync.openCollection(`personal:${uid}`);
    }
  }

  protected async create(): Promise<void> {
    await this.run(async () => {
      const uid = this.identity();
      if (!this._shareConfirmed()) return;
      await this.groups.create(this._email(), this.personal(uid));
      if (!this.groups._error()) {
        this._email.set('');
        this._shareConfirmed.set(false);
        this._feedback.set(
          'Copia compartida creada. La otra cuenta verá la agrupación al abrir Configuración.',
        );
      }
    });
  }

  protected async close(group: Group): Promise<void> {
    await this.run(async () => {
      await this.groups.close(group.id);
      if (!this.groups._error()) {
        this.cancelReview();
        this._closing.set('');
        this._feedback.set('Agrupación cerrada. Las colecciones personales se conservan.');
      }
    });
  }

  protected async prepare(group: Group, purpose: 'contribute' | 'copy'): Promise<void> {
    await this.run(async () => {
      const uid = this.identity();
      if (purpose === 'contribute' && group.contributedUids.includes(uid))
        throw new Error('Tu colección ya fue aportada.');
      const local = this.personal(uid);
      const snapshot = await this.repository.load(group.id, this.store._allSpecies());
      if (this.auth._user()?.uid !== uid) return;
      this._choices.set({});
      this._review.set({
        purpose,
        uid,
        groupId: group.id,
        revision: snapshot.revision,
        local,
        source: snapshot.data,
        plan: planCollectionMerge(local, snapshot.data),
      });
    });
  }

  protected async prepareLegacy(): Promise<void> {
    await this.run(() => {
      const uid = this.identity();
      const local = this.personal(uid);
      const legacy = this.store.readScope('guest');
      this._choices.set({});
      this._review.set({
        purpose: 'legacy',
        uid,
        groupId: '',
        revision: '',
        local,
        source: legacy,
        plan: planCollectionMerge(local, legacy),
      });
      return Promise.resolve();
    });
  }

  protected async apply(review: IncorporationReview): Promise<void> {
    await this.run(async () => {
      const uid = this.identity();
      if (review.uid !== uid || !this.complete(review)) return;
      const current = this.personal(uid);
      if (JSON.stringify(current) !== JSON.stringify(review.local))
        throw new Error('Tu colección personal cambió. Vuelve a preparar la comparación.');
      const data = validateCloudData(
        resolveCollectionMerge(review.plan, this._choices()),
        this.store._allSpecies(),
      );
      if (review.purpose === 'contribute') {
        await this.repository.save(review.groupId, uid, review.revision, data, true);
        if (this.auth._user()?.uid !== uid) return;
        this._feedback.set('Aportación publicada. Tu colección personal no ha cambiado.');
      } else {
        await this.restorePersonal(review, data);
        this._feedback.set(
          'Combinación guardada en tu personal. Revisa el estado de sincronización.',
        );
      }
      this.cancelReview();
    });
  }

  private async restorePersonal(review: IncorporationReview, data: CollectionData): Promise<void> {
    if (
      review.purpose === 'legacy' &&
      JSON.stringify(this.store.readScope('guest')) !== JSON.stringify(review.source)
    )
      throw new Error('La copia anterior cambió. Vuelve a preparar la comparación.');
    if (review.purpose === 'copy') {
      const source = await this.repository.load(review.groupId, this.store._allSpecies());
      if (source.revision !== review.revision)
        throw new Error('El archivo cambió. Vuelve a preparar la comparación.');
      if (JSON.stringify(this.personal(review.uid)) !== JSON.stringify(review.local))
        throw new Error('Tu personal cambió durante la lectura. Vuelve a preparar la comparación.');
    }
    if (
      this.auth._user()?.uid !== review.uid ||
      !this.sync.openCollection(`personal:${review.uid}`)
    )
      throw new Error('No se pudo abrir tu colección personal.');
    if (!this.store.restore(JSON.stringify(createBackup(data))))
      throw new Error('No se pudo guardar la combinación personal.');
  }

  protected choose(key: string, side: 'local' | 'cloud'): void {
    this._choices.update((choices) => ({ ...choices, [key]: side }));
  }
  protected complete(review: IncorporationReview): boolean {
    return review.plan.conflicts.every((conflict) => !!this._choices()[conflict.key]);
  }
  protected cancelReview(): void {
    this._review.set(null);
    this._choices.set({});
  }
  protected title(conflict: CollectionConflict): string {
    return conflict.kind === 'album'
      ? 'Álbum'
      : (this.store._allSpecies().find((species) => species.id === conflict.id)?.name ??
          `Pokémon ${conflict.id}`);
  }
  protected describe(value: CollectionEntry | Album | null): string {
    if (!value) return 'Eliminado';
    if ('speciesIds' in value)
      return `${value.name} · Cartas: ${value.speciesIds.join(', ') || 'Sin cartas'}`;
    return `${value.card.name} · ${value.card.set} #${value.card.number} · ${value.card.language} · ${value.status === 'owned' ? 'En colección' : 'Deseada'} · Pagado: ${this.money(value.paidCents)} · Valor: ${this.money(value.valueCents)} · Fecha: ${value.valuedAt ?? 'Sin indicar'} · ${value.card.id} · ${value.card.rarity} · ${value.card.illustration} · Forma pendiente: ${value.needsFormReview ? 'Sí' : 'No'} · Origen: ${value.card.source} · Imagen: ${value.card.image ?? 'Sin imagen'}`;
  }
  private money(cents: number | null): string {
    return cents === null ? 'Sin indicar' : `${(cents / 100).toFixed(2)} EUR`;
  }
  private identity(): string {
    const user = this.auth._user();
    if (!user?.emailVerified) throw new Error('Inicia sesión con una cuenta Google verificada.');
    return user.uid;
  }
  private personal(uid: string): CollectionData {
    return this.store._scope() === `personal:${uid}`
      ? this.store._collection()
      : this.store.readScope(`personal:${uid}`);
  }
  protected exportPersonal(): void {
    try {
      this.download(this.personal(this.identity()), 'personal');
    } catch (error) {
      this._feedback.set(error instanceof Error ? error.message : 'No se pudo exportar.');
    }
  }
  protected async exportGroup(group: Group): Promise<void> {
    await this.run(async () => {
      const uid = this.identity();
      const snapshot = await this.repository.load(group.id, this.store._allSpecies());
      if (this.auth._user()?.uid === uid) this.download(snapshot.data, `grupo-${group.id}`);
    });
  }
  protected exportDraft(group: Group): void {
    try {
      this.download(
        this.store.readScope(`group:${this.identity()}:${group.id}`),
        `borrador-${group.id}`,
      );
    } catch (error) {
      this._feedback.set(
        error instanceof Error ? error.message : 'No se pudo exportar el borrador.',
      );
    }
  }
  private download(data: CollectionData, label: string): void {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(createBackup(data), null, 2)], { type: 'application/json' }),
    );
    const anchor = this.document.createElement('a');
    anchor.href = url;
    anchor.download = `pokecollector-${label}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this._feedback.set('Respaldo exportado.');
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this._locked()) return;
    this._busy.set(true);
    this._feedback.set('');
    try {
      await action();
    } catch (error) {
      this._feedback.set(
        error instanceof Error ? error.message : 'No se pudo completar la operación.',
      );
    } finally {
      this._busy.set(false);
    }
  }
}
