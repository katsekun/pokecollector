import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TcgdexCatalog, TcgdexPage } from '../../core/tcgdex-catalog';
import { Card } from '../../core/collection';
import { TcgdexBrowser } from './tcgdex-browser';
import { CardArt } from '../../shared/card-art';

describe('Automatic TCGdex loading', () => {
  const _allowTcgplayer = signal(true);
  const search =
    vi.fn<(speciesId: number, language: string, page: number) => Promise<TcgdexPage>>();
  const recoverImage = vi.fn<(card: Card, failedImages: readonly string[]) => Promise<Card>>();
  const recoveryCard: Card = {
    id: 'tcgdex:es:reference-1',
    speciesId: 1,
    name: 'Bulbasaur',
    language: 'es',
    set: 'Promos',
    number: '1',
    rarity: 'Promo',
    illustration: 'standard',
    image: null,
    source: 'https://api.tcgdex.net/v2/es/cards/reference-1',
  };
  beforeEach(() => {
    _allowTcgplayer.set(true);
    search.mockReset().mockResolvedValue({ cards: [], hasMore: false, omitted: 0 });
    recoverImage.mockReset().mockImplementation(async (card) => card);
    TestBed.configureTestingModule({
      imports: [TcgdexBrowser],
      providers: [{ provide: TcgdexCatalog, useValue: { search, recoverImage, _allowTcgplayer } }],
    });
  });

  it('does not replace a newly selected card with a late recovered image', async () => {
    let finishRecovery!: (card: Card) => void;
    recoverImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRecovery = resolve;
        }),
    );
    const fixture = TestBed.createComponent(CardArt);
    fixture.componentRef.setInput('card', recoveryCard);
    await fixture.whenStable();
    const next = {
      ...recoveryCard,
      id: 'next',
      image: 'https://assets.tcgdex.net/es/sv/sv01/2/high.webp',
    };
    fixture.componentRef.setInput('card', next);
    await fixture.whenStable();
    finishRecovery({ ...recoveryCard, image: 'https://assets.tcgdex.net/en/sv/sv01/1/high.webp' });
    await Promise.resolve();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe(next.image);
  });
  it('ignores a late marketplace recovery after the provider is disabled', async () => {
    let finishRecovery!: (card: Card) => void;
    _allowTcgplayer.set(true);
    recoverImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRecovery = resolve;
        }),
    );
    const fixture = TestBed.createComponent(CardArt);
    fixture.componentRef.setInput('card', recoveryCard);
    await fixture.whenStable();
    _allowTcgplayer.set(false);
    await fixture.whenStable();
    finishRecovery({
      ...recoveryCard,
      image: 'https://tcgplayer-cdn.tcgplayer.com/product/684461_in_1000x1000.jpg',
      imageProvider: 'tcgplayer',
    });
    await Promise.resolve();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe(
      '/cards/card-placeholder.png',
    );
  });
  it('handles optional recovery failures without unhandled rejections', async () => {
    recoverImage.mockRejectedValueOnce(new Error('Optional provider unavailable'));
    const fixture = TestBed.createComponent(CardArt);
    fixture.componentRef.setInput('card', recoveryCard);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('img').getAttribute('src')).toBe(
      '/cards/card-placeholder.png',
    );
  });
  it('stops recovery when the local placeholder also fails', async () => {
    const fixture = TestBed.createComponent(CardArt);
    fixture.componentRef.setInput('card', {
      ...recoveryCard,
      image: 'https://assets.tcgdex.net/es/sv/sv01/1/high.webp',
    });
    await fixture.whenStable();
    fixture.nativeElement.querySelector('img').dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(recoverImage).toHaveBeenCalledTimes(1);
    fixture.nativeElement.querySelector('img').dispatchEvent(new Event('error'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Imagen no disponible');
    expect(recoverImage).toHaveBeenCalledTimes(1);
  });

  it('reloads when the optional TCGplayer provider is enabled or disabled', async () => {
    const fixture = TestBed.createComponent(TcgdexBrowser);
    fixture.componentRef.setInput('speciesId', 1);
    await fixture.whenStable();
    const checkbox = fixture.nativeElement.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    checkbox.click();
    await fixture.whenStable();
    expect(_allowTcgplayer()).toBe(false);
    expect(search).toHaveBeenCalledTimes(2);
    checkbox.click();
    await fixture.whenStable();
    expect(_allowTcgplayer()).toBe(true);
    expect(search).toHaveBeenCalledTimes(3);
  });

  it('loads the first page when a Pokémon is opened and again when its language changes', async () => {
    const fixture = TestBed.createComponent(TcgdexBrowser);
    fixture.componentRef.setInput('speciesId', 1);
    await fixture.whenStable();
    expect(search).toHaveBeenCalledExactlyOnceWith(1, 'es', 1);
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = 'en';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(search).toHaveBeenLastCalledWith(1, 'en', 1);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('shows image-less cards last without hiding them and previews a card with artwork', async () => {
    const base: Card = {
      id: 'without-art',
      speciesId: 1,
      name: 'Without artwork',
      language: 'es',
      set: 'Promos',
      number: '1',
      rarity: 'Promo',
      illustration: 'special-illustration-rare',
      image: null,
      source: 'https://api.tcgdex.net/v2/es/cards/without-art',
    };
    const standard = {
      ...base,
      id: 'with-standard',
      name: 'With standard artwork',
      image: 'https://assets.tcgdex.net/es/sv/sv01/1/high.webp',
      illustration: 'standard' as const,
    };
    const fullArt = {
      ...base,
      id: 'with-full-art',
      name: 'With full artwork',
      image: 'https://assets.tcgdex.net/es/sv/sv01/2/high.webp',
      illustration: 'full-art' as const,
    };
    const withoutStandard = {
      ...base,
      id: 'without-standard',
      name: 'Without standard artwork',
      illustration: 'standard' as const,
    };
    search.mockResolvedValue({
      cards: [base, withoutStandard, standard, fullArt],
      hasMore: false,
      omitted: 1,
    });
    const fixture = TestBed.createComponent(TcgdexBrowser);
    const firstCard = vi.fn();
    const preview = vi.fn();
    fixture.componentInstance.firstCard.subscribe(firstCard);
    fixture.componentInstance.cardPreview.subscribe(preview);
    fixture.componentRef.setInput('speciesId', 1);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(
      Array.from(element.querySelectorAll('.tcgdex__card strong'), (name) => name.textContent),
    ).toEqual([fullArt.name, standard.name, base.name, withoutStandard.name]);
    expect(
      element.querySelectorAll('.tcgdex__card img[src="/cards/card-placeholder.png"]'),
    ).toHaveLength(2);
    expect(firstCard).toHaveBeenCalledWith(fullArt);
    expect(element.textContent).not.toContain('sin imagen');
    expect(element.textContent).toContain('resultados sin correspondencia con este Pokémon');
    expect(element.textContent).not.toContain('digitales');
    (element.querySelectorAll('.tcgdex__card')[2] as HTMLButtonElement).click();
    expect(preview).toHaveBeenCalledWith(base);
  });

  it('still previews and shows a card when none have artwork', async () => {
    const card: Card = {
      id: 'without-art',
      speciesId: 1,
      name: 'Bulbasaur',
      language: 'es',
      set: 'Promos',
      number: '1',
      rarity: 'Promo',
      illustration: 'standard',
      image: null,
      source: 'https://api.tcgdex.net/v2/es/cards/without-art',
    };
    search.mockResolvedValue({ cards: [card], hasMore: false, omitted: 0 });
    const fixture = TestBed.createComponent(TcgdexBrowser);
    const firstCard = vi.fn();
    fixture.componentInstance.firstCard.subscribe(firstCard);
    fixture.componentRef.setInput('speciesId', 1);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.tcgdex__card')).toHaveLength(1);
    expect(firstCard).toHaveBeenCalledWith(card);
  });

  it('loads a new species and ignores a late failure from the previous one', async () => {
    let rejectPrevious!: (reason: Error) => void;
    search.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectPrevious = reject;
        }),
    );
    const fixture = TestBed.createComponent(TcgdexBrowser);
    fixture.componentRef.setInput('speciesId', 1);
    fixture.detectChanges();
    expect(search).toHaveBeenCalledWith(1, 'es', 1);
    fixture.componentRef.setInput('speciesId', 25);
    await fixture.whenStable();
    expect(search).toHaveBeenLastCalledWith(25, 'es', 1);
    rejectPrevious(new Error('Old request'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });
});
