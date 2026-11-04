import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { REGIONS } from '../../core/catalog-query';
import { Card, CollectionStatus, ILLUSTRATION_LABELS, parseEuroInput } from '../../core/collection';
import { CollectionStore } from '../../core/collection-store';
import { CardArt } from '../../shared/card-art';
import { Icon } from '../../shared/icon';
import { TcgdexBrowser } from './tcgdex-browser';
import { nationalNumber } from '../../core/pokemon-forms';

@Component({
  selector: 'app-card-detail-page',
  imports: [DatePipe, FormsModule, RouterLink, CardArt, Icon, TcgdexBrowser],
  templateUrl: './card-detail-page.html',
  styleUrl: './card-detail-page.scss',
})
export class CardDetailPage {
  protected readonly store = inject(CollectionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly _params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly returnPaths: Record<string, string> = { deseos: '/deseos', albumes: '/albumes' };
  protected readonly returnPath =
    this.returnPaths[this.route.snapshot.queryParamMap.get('from') ?? ''] ?? '/';
  protected readonly _pokemon = computed(() =>
    this.store._allSpecies().find((pokemon) => pokemon.id === Number(this._params().get('id'))),
  );
  protected readonly _entry = computed(() => this.store.entry(this._pokemon()?.id ?? 0));
  protected readonly nationalNumber = nationalNumber;
  protected readonly _siblings = computed(() => {
    const pokemon = this._pokemon();
    return pokemon
      ? this.store._allSpecies().filter((form) => nationalNumber(form) === nationalNumber(pokemon))
      : [];
  });
  protected readonly _remotePreview = signal<Card | null>(null);
  protected readonly _preview = computed(() => {
    const remote = this._remotePreview();
    if (remote?.speciesId === this._pokemon()?.id) return remote;
    return this._entry()?.card ?? null;
  });
  protected readonly _isSelected = computed(
    () => !!this._entry() && this._entry()?.card.id === this._preview()?.id,
  );
  protected readonly _paid = signal('');
  protected readonly _value = signal('');
  protected readonly _feedback = signal('');
  protected readonly illustrationLabels = ILLUSTRATION_LABELS;
  protected readonly regions = REGIONS;

  public constructor() {
    effect(() => {
      const entry = this._entry();
      this._paid.set(entry?.paidCents == null ? '' : (entry.paidCents / 100).toFixed(2));
      this._value.set(entry?.valueCents == null ? '' : (entry.valueCents / 100).toFixed(2));
    });
  }

  protected showInitialCard(card: Card): void {
    if (!this._entry()) this._remotePreview.set(card);
  }

  protected choose(status?: CollectionStatus): void {
    const card = this._preview();
    if (!card) return;
    if (
      (card.requiresFormConfirmation || this._entry()?.needsFormReview) &&
      !window.confirm(
        `TCGdex no identifica esta forma con seguridad. ¿Confirmas que la carta corresponde a ${this._pokemon()?.name}?`,
      )
    )
      return;
    const current = this._entry();
    if (
      current &&
      current.card.id !== card.id &&
      !window.confirm(
        '¿Sustituir tu carta elegida? La anterior, su estado y sus importes dejarán de formar parte de la colección.',
      )
    )
      return;
    if (this.store.selectCard({ ...card, requiresFormConfirmation: false }, status)) {
      const message = status
        ? { owned: 'Carta añadida a tu colección.', wanted: 'Carta añadida a tus deseos.' }[status]
        : 'Carta favorita elegida.';
      this._feedback.set(message);
    }
  }

  protected remove(): void {
    const pokemon = this._pokemon();
    if (
      !pokemon ||
      !window.confirm('¿Eliminar esta selección y sus importes? También se quitará de tus álbumes.')
    )
      return;
    if (this.store.remove(pokemon.id)) this._feedback.set('Selección eliminada.');
  }

  protected savePrices(): void {
    const entry = this._entry();
    if (!entry) return;
    try {
      const paidCents = parseEuroInput(this._paid());
      const valueCents = parseEuroInput(this._value());
      let valuedAt: string | null = null;
      if (valueCents !== null)
        valuedAt = valueCents === entry.valueCents ? entry.valuedAt : new Date().toISOString();
      if (this.store.updateEntry(entry.speciesId, { paidCents, valueCents, valuedAt }))
        this._feedback.set('Importes guardados.');
    } catch (error) {
      this._feedback.set(error instanceof Error ? error.message : 'Revisa los importes.');
    }
  }
}
