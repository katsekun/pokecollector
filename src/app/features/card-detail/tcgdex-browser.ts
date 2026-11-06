import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ILLUSTRATION_RANK } from '../../core/catalog-query';
import { Card, ILLUSTRATION_LABELS, PokemonSpecies } from '../../core/collection';
import { TcgdexCatalog, TcgdexLanguage, TCGDEX_LANGUAGES } from '../../core/tcgdex-catalog';
import { CardArt } from '../../shared/card-art';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-tcgdex-browser',
  imports: [FormsModule, CardArt, Icon],
  template: `
    <details class="tcgdex" #browserDetails open>
      <summary>
        <app-icon name="search" /><span>Catálogo TCGdex</span><app-icon name="down" />
      </summary>
      <div class="tcgdex__controls">
        <label
          >Idioma de las cartas<select
            [ngModel]="_language()"
            (ngModelChange)="changeLanguage($event)"
          >
            @for (language of languages; track language.id) {
              <option [value]="language.id">{{ language.name }}</option>
            }
          </select></label
        >
        <button
          type="button"
          class="button button--primary"
          [disabled]="_loading()"
          (click)="load(true)"
        >
          <app-icon name="search" />{{ _loading() ? 'Buscando…' : 'Buscar en TCGdex' }}
        </button>
        <a
          href="https://tcgdex.dev"
          target="_blank"
          rel="noopener noreferrer"
          class="tcgdex__source"
          >TCGdex <app-icon name="arrow"
        /></a>
      </div>
      <label class="tcgdex__verification"
        ><input
          type="checkbox"
          [ngModel]="_allowTcgplayer()"
          (ngModelChange)="_allowTcgplayer.set($event)"
          title="Proveedor externo; permisos de uso de imágenes pendientes de confirmación"
        />
        Usar imágenes de TCGplayer</label
      >
      @if (_error()) {
        <div class="notice notice--error" role="alert">
          <span>{{ _error() }}</span
          ><button type="button" class="button button--outline" (click)="load(_retryReplace())">
            Reintentar
          </button>
        </div>
      }
      @if (_loading()) {
        <output class="tcgdex__status" aria-live="polite">Buscando cartas…</output>
      }
      @if (_unverified().length) {
        <label class="tcgdex__verification"
          ><input
            type="checkbox"
            [ngModel]="_showUnverified()"
            (ngModelChange)="_showUnverified.set($event)"
          />
          Mostrar {{ _unverified().length }} cartas sin forma verificada</label
        >
      }
      @if (_searched() && !_loading() && !_error() && !_cards().length) {
        <p class="tcgdex__status">No hay cartas con forma verificada en esta página.</p>
      }
      @if (_sorted().length) {
        <div
          class="tcgdex__results"
          [attr.aria-busy]="_loading()"
          aria-label="Resultados de TCGdex"
        >
          @for (card of _sorted(); track card.id) {
            <button
              type="button"
              class="tcgdex__card"
              [class.tcgdex__card--active]="_selectedCardId() === card.id"
              [attr.aria-pressed]="_selectedCardId() === card.id"
              (click)="cardPreview.emit(card); browserDetails.open = false"
            >
              <span class="tcgdex__image"
                ><app-card-art
                  [card]="card"
                  [name]="card.name"
                  [speciesId]="card.nationalId ?? card.speciesId"
              /></span>
              <span class="tcgdex__metadata"
                ><strong>{{ card.name }}</strong
                ><small
                  >{{ card.set }} · {{ card.number }} · {{ card.language.toUpperCase() }}</small
                >
                @if (card.imageProvider === 'tcgplayer') {
                  <small>Imagen de referencia · TCGplayer</small>
                } @else if (card.imageLanguage && card.imageLanguage !== card.language) {
                  <small
                    >Imagen de referencia · {{ card.imageLanguage.toUpperCase() }} · TCGdex</small
                  >
                }
                <span>{{
                  card.requiresFormConfirmation
                    ? 'Forma sin verificar'
                    : card.illustration === 'standard'
                      ? card.rarity
                      : labels[card.illustration]
                }}</span></span
              >
              <app-icon name="arrow" />
            </button>
          }
        </div>
      }
      @if (_searched()) {
        <div class="tcgdex__footer">
          <span>{{ _cards().length }} cartas cargadas</span>
          @if (_hasMore()) {
            <button
              type="button"
              class="button button--outline"
              [disabled]="_loading()"
              (click)="load(false)"
            >
              <app-icon name="plus" /> Cargar más
            </button>
          }
        </div>
      }
      @if (_omitted()) {
        <p class="tcgdex__status">
          {{ _omitted() }} resultados sin correspondencia con este Pokémon o su forma no incluidos.
        </p>
      }
    </details>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: 1.75rem;
    }
    .tcgdex {
      border-block: 1px solid var(--line);
    }
    .tcgdex summary {
      display: flex;
      gap: 0.6rem;
      align-items: center;
      padding: 1rem 0;
      cursor: pointer;
      list-style: none;
      font-size: 0.85rem;
    }
    .tcgdex summary::-webkit-details-marker {
      display: none;
    }
    .tcgdex summary > app-icon:last-child {
      margin-left: auto;
    }
    .tcgdex__controls {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 0.75rem;
      padding: 0.5rem 0 1rem;
    }
    .tcgdex__controls label {
      min-width: 10rem;
      max-width: 100%;
    }
    .tcgdex__source {
      margin-left: auto;
      align-self: center;
      display: flex;
      gap: 0.3rem;
      align-items: center;
      color: var(--muted);
      font-size: 0.7rem;
    }
    .tcgdex__source app-icon {
      width: 0.8rem;
      height: 0.8rem;
    }
    .tcgdex__status {
      display: block;
      color: var(--muted);
      font-size: 0.75rem;
      padding-bottom: 1rem;
    }
    .tcgdex__verification {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 0.5rem;
      padding-bottom: 1rem;
      font-size: 0.75rem;
    }
    .tcgdex__results {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
      gap: 0.5rem;
      max-height: 23rem;
      overflow-y: auto;
      padding: 0.2rem;
    }
    .tcgdex__card {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      border: 1px solid var(--line);
      border-radius: 0.375rem;
      background: var(--surface);
      padding: 0.65rem;
      text-align: left;
      min-width: 0;
    }
    .tcgdex__card:hover,
    .tcgdex__card--active {
      border-color: var(--primary);
      background: var(--surface-alt);
    }
    .tcgdex__image {
      width: 2.8rem;
      flex-shrink: 0;
    }
    .tcgdex__metadata {
      display: grid;
      gap: 0.2rem;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .tcgdex__metadata strong {
      font-size: 0.8rem;
      font-weight: 500;
    }
    .tcgdex__metadata small {
      font-size: 0.65rem;
      color: var(--muted);
    }
    .tcgdex__metadata > span {
      font-size: 0.6rem;
      color: var(--primary);
    }
    .tcgdex__card > app-icon {
      margin-left: auto;
      width: 0.9rem;
      height: 0.9rem;
    }
    .tcgdex__footer {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 0;
      font-size: 0.7rem;
      color: var(--muted);
    }
    @media (max-width: 480px) {
      .tcgdex__controls label {
        flex: 1;
        min-width: 8rem;
      }
      .tcgdex__source {
        display: none;
      }
      .tcgdex__controls > button {
        padding-inline: 0.65rem;
      }
    }
  `,
})
export class TcgdexBrowser {
  private readonly catalog = inject(TcgdexCatalog);
  private readonly destroyRef = inject(DestroyRef);
  private requestId = 0;
  public readonly _speciesId = input.required<number>({ alias: 'speciesId' });
  public readonly _selectedCardId = input('', { alias: 'selectedCardId' });
  public readonly _pokemon = input<PokemonSpecies | null>(null, { alias: 'pokemon' });
  public readonly _forms = input<readonly PokemonSpecies[]>([], { alias: 'forms' });
  public readonly cardPreview = output<Card>();
  public readonly firstCard = output<Card>();
  protected readonly languages = TCGDEX_LANGUAGES;
  protected readonly labels = ILLUSTRATION_LABELS;
  protected readonly _allowTcgplayer = this.catalog._allowTcgplayer;
  protected readonly _language = signal<TcgdexLanguage>('es');
  protected readonly _loading = signal(false);
  protected readonly _searched = signal(false);
  protected readonly _error = signal('');
  protected readonly _cards = signal<readonly Card[]>([]);
  protected readonly _unverified = signal<readonly Card[]>([]);
  protected readonly _showUnverified = signal(false);
  protected readonly _page = signal(0);
  protected readonly _hasMore = signal(false);
  protected readonly _omitted = signal(0);
  protected readonly _retryReplace = signal(true);
  protected readonly _sorted = computed(() =>
    [...this._cards(), ...(this._showUnverified() ? this._unverified() : [])].sort(
      (first, second) =>
        Number(first.image === null) - Number(second.image === null) ||
        ILLUSTRATION_RANK[first.illustration] - ILLUSTRATION_RANK[second.illustration] ||
        first.id.localeCompare(second.id),
    ),
  );

  public constructor() {
    effect(() => {
      this._speciesId();
      this._pokemon();
      this._forms();
      this._language();
      this._allowTcgplayer();
      untracked(() => {
        this.reset();
        void this.load(true);
      });
    });
    this.destroyRef.onDestroy(() => {
      this.requestId += 1;
    });
  }

  protected changeLanguage(language: TcgdexLanguage): void {
    this._language.set(language);
  }

  protected async load(replace: boolean): Promise<void> {
    const requestId = ++this.requestId;
    const page = replace ? 1 : this._page() + 1;
    this._retryReplace.set(replace);
    this._loading.set(true);
    this._searched.set(true);
    this._error.set('');
    try {
      const pokemon = this._pokemon();
      const result = pokemon
        ? await this.catalog.searchForm(pokemon, this._forms(), this._language(), page)
        : {
            ...(await this.catalog.search(this._speciesId(), this._language(), page)),
            unverified: [],
          };
      if (requestId !== this.requestId) return;
      const cards = replace ? result.cards : [...this._cards(), ...result.cards];
      this._cards.set([...new Map(cards.map((card) => [card.id, card])).values()]);
      const unverified = replace
        ? result.unverified
        : [...this._unverified(), ...result.unverified];
      this._unverified.set([...new Map(unverified.map((card) => [card.id, card])).values()]);
      this._omitted.set((replace ? 0 : this._omitted()) + result.omitted);
      this._page.set(page);
      this._hasMore.set(result.hasMore);
      const firstCard = [...this._cards()].sort(
        (first, second) =>
          Number(first.image === null) - Number(second.image === null) ||
          ILLUSTRATION_RANK[first.illustration] - ILLUSTRATION_RANK[second.illustration] ||
          first.id.localeCompare(second.id),
      )[0];
      if (replace && firstCard) this.firstCard.emit(firstCard);
    } catch {
      if (requestId === this.requestId)
        this._error.set('No se pudo consultar TCGdex. Tus cartas guardadas siguen disponibles.');
    } finally {
      if (requestId === this.requestId) this._loading.set(false);
    }
  }

  private reset(): void {
    this.requestId += 1;
    this._loading.set(false);
    this._searched.set(false);
    this._cards.set([]);
    this._unverified.set([]);
    this._showUnverified.set(false);
    this._page.set(0);
    this._error.set('');
    this._hasMore.set(false);
    this._omitted.set(0);
  }
}
