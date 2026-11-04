import { Component, computed, input, signal } from '@angular/core';
import { Card } from '../core/collection';

const CARD_BACK_IMAGE = '/cards/pokemon-card-back.jpg';

@Component({
  selector: 'app-card-art',
  template: `
    @if (_source(); as source) {
      @if (!_failed().includes(source)) {
        <img
          [src]="source"
          [alt]="
            _showingBack()
              ? 'Reverso de carta Pokémon; imagen no disponible de ' + (_card()?.name ?? _name())
              : (_card()?.name ?? _name())
          "
          [title]="_showingBack() ? 'Imagen no disponible' : ''"
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
  public readonly _card = input<Card | null>(null, { alias: 'card' });
  public readonly _name = input('', { alias: 'name' });
  public readonly _speciesId = input(0, { alias: 'speciesId' });
  public readonly _eager = input(false, { alias: 'eager' });
  protected readonly _failed = signal<string[]>([]);
  protected readonly _source = computed(() => {
    const card = this._card();
    if (!card) return '';
    return card.image && !this._failed().includes(card.image) ? card.image : CARD_BACK_IMAGE;
  });
  protected readonly _showingBack = computed(() => this._source() === CARD_BACK_IMAGE);

  protected fail(source: string): void {
    this._failed.update((failed) => [...failed, source]);
  }
}
