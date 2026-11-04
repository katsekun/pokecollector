import { computed, inject, Injectable, signal } from '@angular/core';
import {
  Card,
  chooseCard,
  CollectionData,
  CollectionEntry,
  collectionProgress,
  CollectionStatus,
  createBackup,
  EMPTY_COLLECTION,
  parseBackup,
  PokemonSpecies,
  removeSelection,
} from './collection';
import { CardCatalogRepository, CollectionRepository } from './repositories';
import { nationalNumber } from './pokemon-forms';

@Injectable({ providedIn: 'root' })
export class CollectionStore {
  private readonly catalogRepository = inject(CardCatalogRepository);
  private readonly collectionRepository = inject(CollectionRepository);
  private readonly _data = signal<CollectionData>(EMPTY_COLLECTION);
  private readonly _species = signal<readonly PokemonSpecies[]>([]);
  private readonly _cards = signal<readonly Card[]>([]);
  private readonly _loading = signal(true);
  private readonly _loadError = signal('');
  private readonly _message = signal('');
  private readonly _writeBlocked = signal(false);

  public readonly _collection = this._data.asReadonly();
  public readonly _allSpecies = this._species.asReadonly();
  public readonly _catalogCards = this._cards.asReadonly();
  public readonly _isLoading = this._loading.asReadonly();
  public readonly _catalogError = this._loadError.asReadonly();
  public readonly _notice = this._message.asReadonly();
  public readonly _storageBlocked = this._writeBlocked.asReadonly();
  public readonly _entries = computed(() => this._data().entries);
  public readonly _albums = computed(() => this._data().albums);
  public readonly _entryMap = computed(
    () => new Map(this._entries().map((entry) => [entry.speciesId, entry])),
  );
  public readonly _progress = computed(() => collectionProgress(this._entries(), this._species()));
  public readonly _nationalCount = computed(
    () => new Set(this._species().map(nationalNumber)).size,
  );
  public readonly _wantedCount = computed(
    () => this._entries().filter((entry) => entry.status === 'wanted').length,
  );
  public readonly _generations = computed(() =>
    [...new Set(this._species().map((pokemon) => pokemon.generation))]
      .sort((first, second) => first - second)
      .map((id) => ({
        id,
        ...collectionProgress(
          this._entries(),
          this._species().filter((pokemon) => pokemon.generation === id),
        ),
      })),
  );
  public readonly _totals = computed(() => {
    const owned = this._entries().filter((entry) => entry.status === 'owned');
    return {
      paid: owned.reduce((total, entry) => total + (entry.paidCents ?? 0), 0),
      value: owned.reduce((total, entry) => total + (entry.valueCents ?? 0), 0),
      paidKnown: owned.filter((entry) => entry.paidCents !== null).length,
      valueKnown: owned.filter((entry) => entry.valueCents !== null).length,
    };
  });

  public async initialize(): Promise<void> {
    this._loading.set(true);
    this._loadError.set('');
    try {
      const catalog = await this.catalogRepository.load();
      this._species.set(catalog.species);
      this._cards.set(catalog.cards);
      try {
        this._data.set(this.collectionRepository.load(catalog.species));
        this._writeBlocked.set(false);
      } catch {
        this._writeBlocked.set(true);
        this._message.set(
          'No se ha podido leer tu colección guardada. Se conserva sin sobrescribir. Puedes restaurar un respaldo válido.',
        );
      }
    } catch {
      this._loadError.set(
        'No se ha podido cargar el catálogo. Comprueba la conexión con la aplicación e inténtalo de nuevo.',
      );
    } finally {
      this._loading.set(false);
    }
  }

  public entry(speciesId: number): CollectionEntry | undefined {
    return this._entryMap().get(speciesId);
  }

  public cardsFor(speciesId: number): readonly Card[] {
    const selected = this.entry(speciesId)?.card;
    const cards = this._cards().filter((card) => card.speciesId === speciesId);
    return selected && !cards.some((card) => card.id === selected.id)
      ? [selected, ...cards]
      : cards;
  }

  public selectCard(card: Card, status?: CollectionStatus): boolean {
    const pending = this._entries().find(
      (entry) =>
        entry.needsFormReview && entry.card.id === card.id && entry.speciesId !== card.speciesId,
    );
    const data = pending
      ? {
          entries: [
            ...this._entries().filter(
              (entry) =>
                entry.speciesId !== pending.speciesId && entry.speciesId !== card.speciesId,
            ),
            { ...pending, speciesId: card.speciesId, card, needsFormReview: false },
          ],
          albums: this._albums().map((album) => ({
            ...album,
            speciesIds: [
              ...new Set(
                album.speciesIds.map((id) => (id === pending.speciesId ? card.speciesId : id)),
              ),
            ],
          })),
        }
      : chooseCard(this._data(), card);
    return this.commit(
      status
        ? {
            ...data,
            entries: data.entries.map((entry) =>
              entry.speciesId === card.speciesId ? { ...entry, status } : entry,
            ),
          }
        : data,
    );
  }

  public updateEntry(
    speciesId: number,
    patch: Partial<Pick<CollectionEntry, 'status' | 'paidCents' | 'valueCents' | 'valuedAt'>>,
  ): boolean {
    return this.commit({
      ...this._data(),
      entries: this._entries().map((entry) =>
        entry.speciesId === speciesId ? { ...entry, ...patch } : entry,
      ),
    });
  }

  public setStatus(speciesId: number, status: CollectionStatus): boolean {
    return this.updateEntry(speciesId, { status });
  }

  public remove(speciesId: number): boolean {
    return this.commit(removeSelection(this._data(), speciesId));
  }

  public saveAlbum(name: string, id?: string): boolean {
    const normalized = name.trim();
    if (!normalized || normalized.length > 60) {
      this._message.set('El nombre del álbum debe tener entre 1 y 60 caracteres.');
      return false;
    }
    const albums = id
      ? this._albums().map((album) => (album.id === id ? { ...album, name: normalized } : album))
      : [...this._albums(), { id: crypto.randomUUID(), name: normalized, speciesIds: [] }];
    return this.commit({ ...this._data(), albums });
  }

  public deleteAlbum(id: string): boolean {
    return this.commit({
      ...this._data(),
      albums: this._albums().filter((album) => album.id !== id),
    });
  }

  public toggleAlbumMember(albumId: string, speciesId: number): boolean {
    if (!this.entry(speciesId)) return false;
    return this.commit({
      ...this._data(),
      albums: this._albums().map((album) =>
        album.id === albumId
          ? {
              ...album,
              speciesIds: album.speciesIds.includes(speciesId)
                ? album.speciesIds.filter((member) => member !== speciesId)
                : [...album.speciesIds, speciesId],
            }
          : album,
      ),
    });
  }

  public exportJson(): string {
    return JSON.stringify(createBackup(this._data()), null, 2);
  }

  public inspectBackup(text: string) {
    return parseBackup(text, this._species());
  }

  public restore(text: string): boolean {
    try {
      const backup = this.inspectBackup(text);
      return this.commit({ entries: backup.entries, albums: backup.albums }, true);
    } catch (error) {
      this._message.set(
        error instanceof Error ? error.message : 'No se pudo restaurar el respaldo.',
      );
      return false;
    }
  }

  public dismissNotice(): void {
    this._message.set('');
  }

  private commit(data: CollectionData, recovery = false): boolean {
    if (this._writeBlocked() && !recovery) {
      this._message.set(
        'El guardado está protegido. Restaura un respaldo válido para recuperar tu colección.',
      );
      return false;
    }
    try {
      const validated = parseBackup(JSON.stringify(createBackup(data)), this._species());
      this.collectionRepository.save(validated);
      this._data.set({ entries: validated.entries, albums: validated.albums });
      this._writeBlocked.set(false);
      this._message.set('');
      return true;
    } catch {
      this._message.set(
        'No se pudo guardar. No se han aplicado los cambios. Revisa el espacio o los permisos del navegador.',
      );
      return false;
    }
  }
}
