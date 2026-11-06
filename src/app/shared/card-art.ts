import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Card } from '../core/collection';
import { TcgdexCatalog } from '../core/tcgdex-catalog';

const CARD_PLACEHOLDER_IMAGE = '/cards/card-placeholder.png';

@Component({
  selector: 'app-card-art',
  template: `
    @if (_source(); as source) {
      @if (!_failed().includes(source)) {
        <img
          [src]="source"
          [alt]="
            _showingPlaceholder()
              ? 'Imagen no disponible de ' + (_card()?.name ?? _name())
              : (_card()?.name ?? _name()) +
                (_referenceDescription() ? ' · ' + _referenceDescription() : '')
          "
          [title]="_showingPlaceholder() ? 'Imagen no disponible' : _referenceDescription()"
          [loading]="_eager() ? 'eager' : 'lazy'"
          decoding="async"
          (error)="fail(source)"
          width="734"
          height="1024"
        />
      } @else {
        <span class="card-art__fallback"
          ><span class="card-art__number">#{{ _speciesId().toString().padStart(4, '0') }}</span
          ><strong>{{ _name() }}</strong
          ><small>Imagen no disponible</small></span
        >
      }
    } @else {
      <span class="card-art__fallback"
        ><span class="card-art__number">#{{ _speciesId().toString().padStart(4, '0') }}</span
        ><strong>{{ _name() }}</strong
        ><small>Sin carta elegida</small></span
      >
    }
  `,
  styles: `
    :host {
      display: block;
      aspect-ratio: 734 / 1024;
      width: 100%;
      overflow: hidden;
      border-radius: 0.375rem;
    }
    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .card-art__fallback {
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      background:
        repeating-linear-gradient(
          45deg,
          transparent,
          transparent 10px,
          var(--line) 10px,
          var(--line) 11px
        ),
        var(--surface-alt);
      padding: 1rem;
      text-align: center;
    }
    .card-art__number {
      font: 500 1.75rem var(--display-font);
      color: var(--muted);
    }
    strong {
      font-size: 0.95rem;
      overflow-wrap: anywhere;
    }
    small {
      font-size: 0.7rem;
      color: var(--muted);
    }
  `,
})
export class CardArt {
  private readonly catalog = inject(TcgdexCatalog);
  private readonly destroyRef = inject(DestroyRef);
  private requestId = 0;
  private readonly _recovered = signal<{ original: Card; card: Card } | null>(null);
  public readonly _card = input<Card | null>(null, { alias: 'card' });
  public readonly _name = input('', { alias: 'name' });
  public readonly _speciesId = input(0, { alias: 'speciesId' });
  public readonly _eager = input(false, { alias: 'eager' });
  protected readonly _failed = signal<string[]>([]);
  protected readonly _displayCard = computed(() => {
    const card = this._card();
    const recovered = this._recovered();
    return recovered?.original === card ? recovered.card : card;
  });
  protected readonly _source = computed(() => {
    const card = this._displayCard();
    if (!card) return '';
    const marketplaceImage =
      card.image && new URL(card.image).hostname === 'tcgplayer-cdn.tcgplayer.com';
    return card.image &&
      (!marketplaceImage || this.catalog._allowTcgplayer()) &&
      !this._failed().includes(card.image)
      ? card.image
      : CARD_PLACEHOLDER_IMAGE;
  });
  protected readonly _showingPlaceholder = computed(
    () => this._source() === CARD_PLACEHOLDER_IMAGE,
  );
  protected readonly _referenceDescription = computed(() => {
    const card = this._displayCard();
    if (!card || this._showingPlaceholder()) return '';
    if (
      card.imageProvider === 'tcgplayer' ||
      (card.image && new URL(card.image).hostname === 'tcgplayer-cdn.tcgplayer.com')
    )
      return 'Imagen de referencia de TCGplayer; el idioma puede variar';
    return card.imageLanguage && card.imageLanguage !== card.language
      ? `Imagen de referencia en ${card.imageLanguage.toUpperCase()} de TCGdex`
      : '';
  });

  public constructor() {
    effect(() => {
      const card = this._card();
      this.catalog._allowTcgplayer();
      untracked(() => {
        this.requestId += 1;
        this._recovered.set(null);
        if (card && (card.image === null || this._failed().includes(card.image)))
          void this.recover(card);
      });
    });
    this.destroyRef.onDestroy(() => {
      this.requestId += 1;
    });
  }

  private async recover(card: Card): Promise<void> {
    const requestId = ++this.requestId;
    const allowTcgplayer = this.catalog._allowTcgplayer();
    const recovered = await this.catalog
      .recoverImage(card, this._failed())
      .catch(() => ({ ...card, image: null }));
    if (
      requestId === this.requestId &&
      this._card() === card &&
      this.catalog._allowTcgplayer() === allowTcgplayer
    )
      this._recovered.set({ original: card, card: recovered });
  }

  protected fail(source: string): void {
    this._failed.update((failed) => (failed.includes(source) ? failed : [...failed, source]));
    const card = this._card();
    if (card && source !== CARD_PLACEHOLDER_IMAGE) void this.recover(card);
  }
}
