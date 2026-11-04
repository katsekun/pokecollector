import { DOCUMENT } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CollectionStore } from './core/collection-store';
import { Icon } from './shared/icon';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  selector: 'app-root',
  styleUrl: './app.scss',
  template: `
    <a class="skip-link" href="#main">Saltar al contenido</a>
    <aside class="sidebar">
      <a routerLink="/" class="sidebar__brand" aria-label="Pokecollector, inicio">
        <span class="brand-mark" aria-hidden="true"></span
        ><span
          >poke<span class="sidebar__brand-light">collector</span
          ><small>MI COLECCIÓN TCG</small></span
        >
      </a>
      <span class="sidebar__section">BIBLIOTECA</span>
      <nav class="sidebar__nav" aria-label="Navegación principal">
        <a
          routerLink="/"
          routerLinkActive="sidebar__link--active"
          [routerLinkActiveOptions]="{ exact: true }"
          class="sidebar__link"
          ><app-icon name="grid" /><span>Pokédex</span
          ><small>{{ store._allSpecies().length || '—' }}</small></a
        >
        <a routerLink="/deseos" routerLinkActive="sidebar__link--active" class="sidebar__link"
          ><app-icon name="heart" /><span>Lista de deseos</span
          ><small>{{ store._wantedCount() }}</small></a
        >
        <a routerLink="/albumes" routerLinkActive="sidebar__link--active" class="sidebar__link"
          ><app-icon name="album" /><span>Mis álbumes</span
          ><small>{{ store._albums().length }}</small></a
        >
      </nav>
      <div class="sidebar__progress">
        <span>TU POKÉDEX COMPLETA</span
        ><strong
          >{{ store._progress().owned }} <small>/ {{ store._progress().total }}</small></strong
        ><progress
          [value]="store._progress().owned"
          [max]="store._progress().total || 1"
          aria-label="Progreso total de la Pokédex"
        ></progress
        ><small>Formas en tu colección</small>
      </div>
      <div class="sidebar__bottom">
        <span class="sidebar__avatar">PC</span
        ><span>Mi colección personal<small>Guardado en este navegador</small></span>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <span class="topbar__label"
          ><app-icon name="book" /> Pokecollector <span>/</span> Mi biblioteca</span
        >
        <div class="topbar__actions">
          <button
            type="button"
            class="icon-button"
            (click)="toggleTheme()"
            [title]="_dark() ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'"
            [attr.aria-label]="_dark() ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'"
          >
            <app-icon [name]="_dark() ? 'sun' : 'moon'" />
          </button>
          <span class="topbar__divider"></span>
          <button
            type="button"
            class="button button--quiet"
            (click)="fileInput.click()"
            [disabled]="store._isLoading() || !!store._catalogError()"
          >
            <app-icon name="upload" /><span>Importar</span>
          </button>
          <button
            type="button"
            class="button button--outline"
            (click)="exportBackup()"
            [disabled]="store._isLoading() || store._storageBlocked()"
          >
            <app-icon name="download" /><span>Exportar</span>
          </button>
          <input
            #fileInput
            type="file"
            accept=".json,application/json"
            hidden
            (change)="importBackup($event)"
          />
        </div>
      </header>
      <main id="main" class="workspace__main" tabindex="-1">
        @if (store._notice()) {
          <div class="notice notice--error" role="alert">
            <span>{{ store._notice() }}</span
            ><button
              type="button"
              class="icon-button"
              (click)="store.dismissNotice()"
              aria-label="Cerrar aviso"
            >
              <app-icon name="close" />
            </button>
          </div>
        }
        @if (_feedback()) {
          <div class="notice" role="status">
            <span>{{ _feedback() }}</span
            ><button
              type="button"
              class="icon-button"
              (click)="_feedback.set('')"
              aria-label="Cerrar mensaje"
            >
              <app-icon name="close" />
            </button>
          </div>
        }
        @if (store._isLoading()) {
          <div class="empty-state" role="status">
            <span class="brand-mark brand-mark--loading" aria-hidden="true"></span>
            <h1>Abriendo tu colección</h1>
          </div>
        } @else if (store._catalogError()) {
          <div class="empty-state" role="alert">
            <h1>El catálogo no está disponible</h1>
            <p>{{ store._catalogError() }}</p>
            <button class="button button--primary" (click)="store.initialize()">Reintentar</button>
          </div>
        } @else {
          <router-outlet />
        }
      </main>
      <footer class="workspace__footer">
        <span>Pokecollector · Colección personal</span
        ><span>Catálogo TCGdex · Colección en este navegador · No afiliado a Pokémon</span>
      </footer>
    </div>
  `,
})
export class App implements OnInit {
  protected readonly store = inject(CollectionStore);
  private readonly document = inject(DOCUMENT);
  protected readonly _dark = signal(false);
  protected readonly _feedback = signal('');

  public constructor() {
    let theme: string | null;
    try {
      theme = localStorage.getItem('pokecollector.theme');
    } catch {
      theme = null;
    }
    const dark =
      theme === 'dark' ||
      (theme !== 'light' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    this._dark.set(dark);
    this.document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
  }

  public ngOnInit(): void {
    void this.store.initialize();
  }

  protected toggleTheme(): void {
    this._dark.update((dark) => !dark);
    const theme = this._dark() ? 'dark' : 'light';
    this.document.documentElement.dataset['theme'] = theme;
    try {
      localStorage.setItem('pokecollector.theme', theme);
    } catch {
      this._feedback.set('El tema se aplicará solo en esta sesión.');
    }
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
