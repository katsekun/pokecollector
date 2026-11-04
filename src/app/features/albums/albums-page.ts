import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Album } from '../../core/collection';
import { CollectionStore } from '../../core/collection-store';
import { CardArt } from '../../shared/card-art';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-albums-page',
  imports: [FormsModule, RouterLink, CardArt, Icon],
  template: `
    <div class="page-heading">
      <div>
        <span class="page-heading__eyebrow"><app-icon name="album" /> MI BIBLIOTECA</span>
        <h1>Mis álbumes</h1>
        <p class="page-heading__subtitle">
          {{ store._albums().length }} álbumes · {{ store._entries().length }} cartas elegidas
        </p>
      </div>
      <button type="button" class="button button--primary" (click)="_creating.set(!_creating())">
        <app-icon name="plus" /> Nuevo álbum
      </button>
    </div>
    @if (_creating()) {
      <form class="album-form" (ngSubmit)="create()">
        <label
          >Nombre del álbum<input
            type="text"
            name="name"
            placeholder="Mis ilustraciones favoritas"
            maxlength="60"
            required
            [ngModel]="_newName()"
            (ngModelChange)="_newName.set($event)" /></label
        ><button type="submit" class="button button--primary">Crear álbum</button
        ><button
          type="button"
          class="icon-button"
          (click)="_creating.set(false)"
          title="Cancelar"
          aria-label="Cancelar creación"
        >
          <app-icon name="close" />
        </button>
      </form>
    }
    @if (store._albums().length) {
      <div class="albums-grid">
        @for (album of store._albums(); track album.id) {
          <article class="album" [class.album--active]="_activeAlbum()?.id === album.id">
            <button
              type="button"
              class="album__cover"
              [attr.aria-label]="'Abrir álbum ' + album.name"
              [attr.aria-pressed]="_activeAlbum()?.id === album.id"
              (click)="_activeId.set(album.id)"
            >
              @if (album.speciesIds.length) {
                <span class="album__cover-images">
                  @for (speciesId of album.speciesIds.slice(0, 3); track speciesId) {
                    <app-card-art
                      [card]="store.entry(speciesId)?.card ?? null"
                      [name]="store.entry(speciesId)?.card?.name ?? ''"
                      [speciesId]="store.entry(speciesId)?.card?.nationalId ?? speciesId"
                    />
                  }
                </span>
              } @else {
                <app-icon name="album" />
              }
            </button>
            <div class="album__footer">
              @if (_editingId() === album.id) {
                <form class="album__rename" (ngSubmit)="rename(album.id)">
                  <label class="sr-only" [for]="'album-' + album.id">Nombre del álbum</label
                  ><input
                    [id]="'album-' + album.id"
                    type="text"
                    name="rename"
                    maxlength="60"
                    required
                    [ngModel]="_editName()"
                    (ngModelChange)="_editName.set($event)"
                  /><button
                    class="icon-button"
                    type="submit"
                    title="Guardar nombre"
                    aria-label="Guardar nombre"
                  >
                    <app-icon name="check" /></button
                  ><button
                    class="icon-button"
                    type="button"
                    (click)="_editingId.set('')"
                    title="Cancelar cambio"
                    aria-label="Cancelar cambio"
                  >
                    <app-icon name="close" />
                  </button>
                </form>
              } @else {
                <button type="button" class="album__name" (click)="_activeId.set(album.id)">
                  <h2>{{ album.name }}</h2>
                  <span>{{ album.speciesIds.length }} cartas</span></button
                ><button
                  type="button"
                  class="icon-button"
                  (click)="startRename(album)"
                  [attr.aria-label]="'Renombrar ' + album.name"
                  title="Renombrar álbum"
                >
                  <app-icon name="edit" /></button
                ><button
                  type="button"
                  class="icon-button"
                  (click)="removeAlbum(album)"
                  [attr.aria-label]="'Eliminar álbum ' + album.name"
                  title="Eliminar álbum"
                >
                  <app-icon name="trash" />
                </button>
              }
            </div>
          </article>
        }
      </div>
      @if (_activeAlbum(); as album) {
        <section class="album-content" aria-labelledby="album-heading">
          <div class="album-content__heading">
            <h2 id="album-heading">
              {{ album.name }} <span>{{ album.speciesIds.length }}</span>
            </h2>
          </div>
          <details class="album-members">
            <summary>
              <app-icon name="plus" /> Añadir o quitar cartas <app-icon name="down" />
            </summary>
            <div class="album-members__body">
              @if (store._entries().length) {
                <label
                  ><span class="sr-only">Buscar cartas para el álbum</span
                  ><input
                    type="search"
                    placeholder="Buscar entre mis cartas elegidas…"
                    [ngModel]="_memberQuery()"
                    (ngModelChange)="_memberQuery.set($event)"
                /></label>
                <div class="album-members__list">
                  @for (entry of _availableEntries(); track entry.speciesId) {
                    <label
                      ><input
                        type="checkbox"
                        [checked]="album.speciesIds.includes(entry.speciesId)"
                        (change)="store.toggleAlbumMember(album.id, entry.speciesId)"
                      /><span
                        >{{ entry.card.name
                        }}<small
                          >{{ entry.card.set }} ·
                          {{ entry.status === 'owned' ? 'En colección' : 'En deseos' }}</small
                        ></span
                      ></label
                    >
                  } @empty {
                    <p>No hay cartas que coincidan.</p>
                  }
                </div>
              } @else {
                <p>Todavía no has elegido ninguna carta.</p>
                <a routerLink="/" class="button button--outline"
                  >Ver Pokédex <app-icon name="arrow"
                /></a>
              }
            </div>
          </details>
          @if (album.speciesIds.length) {
            <div class="album-content__grid">
              @for (speciesId of album.speciesIds; track speciesId) {
                @let entry = store.entry(speciesId);
                @if (entry) {
                  <a
                    class="album-content__card"
                    [routerLink]="['/pokemon', speciesId]"
                    [queryParams]="{ from: 'albumes' }"
                    ><app-card-art
                      [card]="entry.card"
                      [name]="entry.card.name"
                      [speciesId]="entry.card.nationalId ?? speciesId"
                    />
                    <h3>{{ entry.card.name }}</h3>
                    <span
                      class="badge"
                      [class.badge--owned]="entry.status === 'owned'"
                      [class.badge--wanted]="entry.status === 'wanted'"
                      >{{ entry.status === 'owned' ? 'En colección' : 'En deseos' }}</span
                    ></a
                  >
                }
              }
            </div>
          } @else {
            <div class="empty-state">
              <app-icon name="book" />
              <h3>Este álbum todavía no tiene cartas</h3>
            </div>
          }
        </section>
      }
    } @else if (!_creating()) {
      <div class="empty-state">
        <app-icon name="album" />
        <h2>Tu primer álbum empieza aquí</h2>
        <button class="button button--outline" type="button" (click)="_creating.set(true)">
          <app-icon name="plus" /> Crear álbum
        </button>
      </div>
    }
  `,
  styleUrl: './albums-page.scss',
})
export class AlbumsPage {
  protected readonly store = inject(CollectionStore);
  protected readonly _creating = signal(false);
  protected readonly _newName = signal('');
  protected readonly _editingId = signal('');
  protected readonly _editName = signal('');
  protected readonly _activeId = signal('');
  protected readonly _memberQuery = signal('');
  protected readonly _activeAlbum = computed(
    () =>
      this.store._albums().find((album) => album.id === this._activeId()) ??
      this.store._albums()[0],
  );
  protected readonly _availableEntries = computed(() => {
    const query = this._memberQuery().trim().toLocaleLowerCase('es');
    return this.store
      ._entries()
      .filter((entry) => entry.card.name.toLocaleLowerCase('es').includes(query));
  });

  protected create(): void {
    if (this.store.saveAlbum(this._newName())) {
      this._activeId.set(this.store._albums().at(-1)?.id ?? '');
      this._newName.set('');
      this._creating.set(false);
    }
  }

  protected startRename(album: Album): void {
    this._editingId.set(album.id);
    this._editName.set(album.name);
  }

  protected rename(id: string): void {
    if (this.store.saveAlbum(this._editName(), id)) this._editingId.set('');
  }

  protected removeAlbum(album: Album): void {
    if (window.confirm(`¿Eliminar el álbum «${album.name}»? Tus cartas seguirán en la colección.`))
      this.store.deleteAlbum(album.id);
  }
}
