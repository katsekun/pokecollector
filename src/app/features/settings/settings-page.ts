import { Component, inject, signal } from '@angular/core';
import { DatePipe, DOCUMENT } from '@angular/common';
import { FirebaseAuthService } from '../../core/firebase-auth';
import { FirebaseCloudSync, SyncConflictReview } from '../../core/firebase-cloud-sync';
import { resolveCollectionMerge } from '../../core/firebase-collection';
import { CollectionStore } from '../../core/collection-store';
import { Icon } from '../../shared/icon';
import { GroupSettings } from './group-settings';

@Component({
  selector: 'app-settings-page',
  imports: [DatePipe, Icon, GroupSettings],
  styleUrl: './settings-page.scss',
  template: `
    <div class="page-heading">
      <div>
        <h1>Configuración</h1>
      </div>
    </div>
    <section class="settings" aria-labelledby="sync-heading">
      <div class="settings__heading">
        <app-icon name="refresh" />
        <h2 id="sync-heading">Sincronización</h2>
      </div>
      <div class="settings__row">
        <label class="settings__toggle">
          <input
            type="checkbox"
            [checked]="sync._autoSync()"
            (change)="sync.setAutoSync($any($event.target).checked)"
          />
          Sincronización automática
        </label>
        @if (sync._settingError()) {
          <output class="settings__warning">{{ sync._settingError() }}</output>
        }
      </div>
      <div class="settings__row settings__row--action">
        <div class="settings__status" role="status">
          @if (!auth._user()) {
            <span>Sin sesión · Solo en este navegador</span>
          } @else if (store._storageBlocked()) {
            <span>Guardado local protegido</span>
          } @else {
            @switch (sync._status()) {
              @case ('connecting') {
                <span>Conectando con la nube…</span>
              }
              @case ('saving') {
                <span>Guardando en la nube…</span>
              }
              @case ('synced') {
                <span>Colección sincronizada</span>
              }
              @case ('error') {
                <span>Sincronización pendiente</span>
              }
              @case ('paused') {
                <span>Sincronización automática desactivada</span>
              }
              @default {
                <span>Sincronización pendiente</span>
              }
            }
          }
          @if (auth._user() && sync._lastSyncedAt(); as lastSyncedAt) {
            <small>Última sincronización: {{ lastSyncedAt | date: 'dd/MM/yyyy HH:mm' }}</small>
          }
        </div>
        <button
          type="button"
          class="button button--primary"
          [disabled]="
            !auth._user() ||
            store._isLoading() ||
            store._storageBlocked() ||
            sync._status() === 'connecting' ||
            sync._status() === 'saving'
          "
          (click)="sync.syncNow()"
        >
          <app-icon name="refresh" /> Sincronizar ahora
        </button>
      </div>
    </section>
    @if (sync._conflict(); as review) {
      <section class="settings" aria-labelledby="conflict-heading">
        <div class="settings__heading">
          <app-icon name="refresh" />
          <h2 id="conflict-heading">
            Diferencias con la nube ({{ review.plan.conflicts.length }})
          </h2>
        </div>
        <p class="settings__conflict-note">
          Elige qué versión conservar en cada caso. Antes de aplicar, puedes exportar un respaldo
          local abajo.
        </p>
        <p class="settings__conflict-note">
          Si eliges eliminar una carta, también se quitará de los álbumes que la incluyan.
        </p>
        @if (documentCount(review) > 450) {
          <p class="settings__warning">
            Esta comparación supera el límite de 450 documentos; no se puede aplicar
            automáticamente. Conserva un respaldo y evita modificar las copias simultáneamente.
          </p>
        }
        @for (conflict of review.plan.conflicts; track conflict.key) {
          <fieldset class="settings__conflict">
            <legend>{{ conflict.kind === 'entry' ? pokemonName(conflict.id) : 'Álbum' }}</legend>
            <div class="settings__versions">
              @for (side of sides; track side) {
                <label class="settings__version">
                  <span class="settings__version-heading">
                    <input
                      type="radio"
                      [name]="conflict.key"
                      [checked]="choice(review, conflict.key) === side"
                      [disabled]="sync._status() === 'saving'"
                      (change)="choose(review, conflict.key, side)"
                    />
                    <strong>{{ side === 'local' ? 'Este navegador' : 'Nube' }}</strong>
                  </span>
                  @if (conflict.kind === 'entry') {
                    @if (conflict[side]; as entry) {
                      <span
                        >{{ entry.card.name }} · {{ entry.card.set }} #{{ entry.card.number }} ·
                        {{ entry.card.language }}</span
                      >
                      <span
                        >{{ entry.card.rarity }} · {{ entry.card.illustration }} · ID:
                        {{ entry.card.id }}</span
                      >
                      <span
                        >Número nacional: {{ entry.card.nationalId ?? 'Sin indicar' }} ·
                        Confirmación de forma:
                        {{ entry.card.requiresFormConfirmation ? 'Sí' : 'No' }}</span
                      >
                      <span>Origen: {{ entry.card.source }}</span>
                      <span
                        >Imagen: {{ entry.card.image ?? 'Sin imagen' }} · Proveedor:
                        {{ entry.card.imageProvider ?? 'Sin indicar' }} · Idioma:
                        {{ entry.card.imageLanguage ?? 'Sin indicar' }}</span
                      >
                      <span
                        >{{ entry.status === 'owned' ? 'En colección' : 'En deseos' }} · Pagado:
                        {{ money(entry.paidCents) }} · Valor: {{ money(entry.valueCents) }}</span
                      >
                      @if (entry.valuedAt) {
                        <span>Valorado: {{ entry.valuedAt | date: 'dd/MM/yyyy HH:mm' }}</span>
                      }
                      @if (entry.needsFormReview) {
                        <span>Forma pendiente de revisión</span>
                      }
                    } @else {
                      <span>Carta eliminada</span>
                    }
                  } @else {
                    @if (conflict[side]; as album) {
                      <span>{{ album.name }}</span>
                      <span
                        >{{ album.speciesIds.length }} cartas:
                        {{ albumMembers(album.speciesIds) }}</span
                      >
                    } @else {
                      <span>Álbum eliminado</span>
                    }
                  }
                </label>
              }
            </div>
          </fieldset>
        }
        <div class="settings__row settings__backup-actions">
          <button
            type="button"
            class="button button--primary"
            [disabled]="
              !complete(review) ||
              documentCount(review) > 450 ||
              sync._status() === 'saving' ||
              store._storageBlocked()
            "
            (click)="apply(review)"
          >
            Aplicar decisiones
          </button>
          <button
            type="button"
            class="button button--outline"
            [disabled]="sync._status() === 'saving'"
            (click)="sync.syncNow()"
          >
            <app-icon name="refresh" /> Actualizar comparación
          </button>
        </div>
      </section>
    }
    <app-group-settings />
    <section class="settings" aria-labelledby="backup-heading">
      <div class="settings__heading">
        <app-icon name="download" />
        <h2 id="backup-heading">Respaldo de la colección</h2>
      </div>
      <div class="settings__row settings__backup-actions">
        <button
          type="button"
          class="button button--outline"
          (click)="fileInput.click()"
          [disabled]="store._isLoading() || !!store._catalogError()"
        >
          <app-icon name="upload" /> Importar
        </button>
        <button
          type="button"
          class="button button--outline"
          (click)="exportBackup()"
          [disabled]="store._isLoading() || store._storageBlocked()"
        >
          <app-icon name="download" /> Exportar
        </button>
        <input
          #fileInput
          type="file"
          accept=".json,application/json"
          hidden
          (change)="importBackup($event)"
        />
      </div>
      @if (_feedback()) {
        <output class="settings__feedback">{{ _feedback() }}</output>
      }
    </section>
  `,
})
export class SettingsPage {
  protected readonly sync = inject(FirebaseCloudSync);
  protected readonly auth = inject(FirebaseAuthService);
  protected readonly store = inject(CollectionStore);
  private readonly document = inject(DOCUMENT);
  protected readonly _feedback = signal('');
  protected readonly sides = ['local', 'cloud'] as const;
  private readonly _choices = signal<{
    review: SyncConflictReview;
    values: Record<string, 'local' | 'cloud'>;
  } | null>(null);

  protected choose(review: SyncConflictReview, key: string, side: 'local' | 'cloud'): void {
    const values = this._choices()?.review === review ? this._choices()?.values : {};
    this._choices.set({ review, values: { ...values, [key]: side } });
  }

  protected choice(review: SyncConflictReview, key: string): 'local' | 'cloud' | undefined {
    return this._choices()?.review === review ? this._choices()?.values[key] : undefined;
  }

  protected complete(review: SyncConflictReview): boolean {
    return review.plan.conflicts.every((conflict) => this.choice(review, conflict.key));
  }

  protected documentCount(review: SyncConflictReview): number {
    if (review.scope?.startsWith('group:')) return 0;
    const choices = this._choices();
    if (choices?.review !== review || !this.complete(review)) return 0;
    const merged = resolveCollectionMerge(review.plan, choices.values);
    const entries = new Set(
      [...review.cloud.entries, ...merged.entries].map((entry) => entry.speciesId),
    );
    const albums = new Set([...review.cloud.albums, ...merged.albums].map((album) => album.id));
    return entries.size + albums.size;
  }

  protected apply(review: SyncConflictReview): void {
    const choices = this._choices();
    if (choices?.review === review && this.complete(review))
      void this.sync.resolveConflicts(choices.values);
  }

  protected pokemonName(id: number): string {
    const pokemon = this.store._allSpecies().find((item) => item.id === id);
    return `${pokemon?.name ?? 'Pokémon'} #${pokemon?.nationalId ?? id}`;
  }

  protected albumMembers(ids: readonly number[]): string {
    return ids.length ? ids.map((id) => this.pokemonName(id)).join(', ') : 'Sin cartas';
  }

  protected money(cents: number | null): string {
    return cents === null ? 'Sin indicar' : `${(cents / 100).toFixed(2).replace('.', ',')} €`;
  }

  protected exportBackup(): void {
    const url = URL.createObjectURL(
      new Blob([this.store.exportJson()], { type: 'application/json' }),
    );
    const anchor = this.document.createElement('a');
    anchor.href = url;
    anchor.download = `pokecollector-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this._feedback.set('Respaldo exportado.');
  }

  protected async importBackup(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('El archivo supera el límite de 5 MB.');
      const text = await file.text();
      const backup = this.store.inspectBackup(text);
      if (
        !window.confirm(
          `¿Restaurar ${backup.entries.length} cartas y ${backup.albums.length} álbumes? Se sustituirá toda la colección actual. Exporta primero un respaldo si quieres conservarla.`,
        )
      )
        return;
      if (this.store.restore(text)) this._feedback.set('Colección restaurada.');
    } catch (error) {
      let message = 'No se pudo leer el archivo.';
      if (error instanceof SyntaxError) message = 'El archivo no contiene un JSON válido.';
      else if (error instanceof Error) message = error.message;
      this._feedback.set(message);
    }
  }
}
