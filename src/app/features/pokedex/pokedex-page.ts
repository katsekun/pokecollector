import { Component, computed, inject, Injectable, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  CatalogFilters,
  DEFAULT_FILTERS,
  formatEuros,
  preferredCard,
  queryCatalog,
  REGIONS,
} from '../../core/catalog-query';
import { Card, ILLUSTRATION_LABELS, PokemonSpecies } from '../../core/collection';
import { CollectionStore } from '../../core/collection-store';
import { CardArt } from '../../shared/card-art';
import { Icon } from '../../shared/icon';
import { nationalNumber } from '../../core/pokemon-forms';

@Injectable({ providedIn: 'root' })
export class PokedexViewState {
  public readonly _filters = signal<CatalogFilters>(DEFAULT_FILTERS);
  public readonly _page = signal(1);
}

@Component({
  selector: 'app-pokedex-page',
  imports: [FormsModule, RouterLink, CardArt, Icon],
  templateUrl: './pokedex-page.html',
  styleUrl: './pokedex-page.scss',
})
export class PokedexPage {
  protected readonly store = inject(CollectionStore);
  protected readonly view = inject(PokedexViewState);
  private readonly route = inject(ActivatedRoute);
  protected readonly isWishlist = this.route.snapshot.data['view'] === 'wishlist';
  protected readonly regions = REGIONS;
  protected readonly illustrationLabels = ILLUSTRATION_LABELS;
  protected readonly euros = formatEuros;
  protected readonly nationalNumber = nationalNumber;
  protected readonly pageSize = 24;
  protected readonly _advanced = signal(false);
  protected readonly _results = computed(() =>
    queryCatalog(this.store._allSpecies(), this.store._catalogCards(), this.store._entries(), {
      ...this.view._filters(),
      ...(this.isWishlist ? { status: 'wanted' as const } : {}),
    }),
  );
  protected readonly _pages = computed(() =>
    Math.max(1, Math.ceil(this._results().length / this.pageSize)),
  );
  protected readonly _currentPage = computed(() => Math.min(this.view._page(), this._pages()));
  protected readonly _visible = computed(() =>
    this._results().slice(
      (this._currentPage() - 1) * this.pageSize,
      this._currentPage() * this.pageSize,
    ),
  );
  protected readonly _languages = computed(() =>
    [
      ...new Set(
        [...this.store._catalogCards(), ...this.store._entries().map((entry) => entry.card)].map(
          (card) => card.language,
        ),
      ),
    ].sort((first, second) => first.localeCompare(second, 'es')),
  );
  protected readonly _sets = computed(() =>
    [
      ...new Set(
        [...this.store._catalogCards(), ...this.store._entries().map((entry) => entry.card)].map(
          (card) => card.set,
        ),
      ),
    ].sort((first, second) => first.localeCompare(second, 'es')),
  );
  protected readonly _previews = computed(
    () =>
      new Map(
        this.store._allSpecies().map((pokemon) => [
          pokemon.id,
          preferredCard(
            this.store._catalogCards().filter((card) => card.speciesId === pokemon.id),
            this.store.entry(pokemon.id),
          ),
        ]),
      ),
  );
  protected readonly _activeFilterCount = computed(() => {
    const filters = this.view._filters();
    return [
      !!filters.query,
      !!filters.generation,
      filters.status !== 'all' && !this.isWishlist,
      !!filters.illustration,
      !!filters.language,
      !!filters.set,
      filters.availableOnly,
      filters.formType !== 'all',
    ].filter(Boolean).length;
  });

  protected preview(pokemon: PokemonSpecies): Card | null {
    return this._previews().get(pokemon.id) ?? null;
  }

  protected setFilter<Key extends keyof CatalogFilters>(
    key: Key,
    value: CatalogFilters[Key],
  ): void {
    this.view._filters.update((filters) => ({ ...filters, [key]: value }));
    this.view._page.set(1);
  }

  protected hasStatusFilter(status: 'wanted' | 'owned'): boolean {
    const current = this.view._filters().status;
    return current === status || current === 'selected';
  }

  protected setStatusCheckbox(status: 'wanted' | 'owned', checked: boolean): void {
    const wanted = status === 'wanted' ? checked : this.hasStatusFilter('wanted');
    const owned = status === 'owned' ? checked : this.hasStatusFilter('owned');
    let next: CatalogFilters['status'] = 'all';
    if (wanted && owned) next = 'selected';
    else if (wanted) next = 'wanted';
    else if (owned) next = 'owned';
    this.setFilter('status', next);
  }

  protected resetFilters(): void {
    this.view._filters.set(DEFAULT_FILTERS);
    this.view._page.set(1);
  }

  protected changePage(page: number): void {
    this.view._page.set(Math.min(this._pages(), Math.max(1, page)));
    document.getElementById('catalog-heading')?.scrollIntoView({ block: 'start' });
  }
}
