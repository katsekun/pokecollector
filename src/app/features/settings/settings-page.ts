import { Component, inject, signal } from '@angular/core';
import { DatePipe, DOCUMENT } from '@angular/common';
import { FirebaseAuthService } from '../../core/firebase-auth';
import { FirebaseCloudSync } from '../../core/firebase-cloud-sync';
import { CollectionStore } from '../../core/collection-store';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-settings-page',
  imports: [DatePipe, Icon],
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
