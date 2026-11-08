import { describe, expect, it } from 'vitest';
import { Card, CollectionEntry } from './collection';
import { DEFAULT_FILTERS, preferredCard, queryCatalog } from './catalog-query';

const species = [
  { id: 1, name: 'Bulbasaur', generation: 1 },
  { id: 25, name: 'Pikachu', generation: 1 },
  { id: 152, name: 'Chikorita', generation: 2 },
];
const card: Card = {
  id: 'a',
  speciesId: 1,
  name: 'Bulbasaur',
  language: 'en',
  set: '151',
  number: '166',
  rarity: 'Illustration Rare',
  illustration: 'illustration-rare',
  image: 'https://example.com/image',
  source: 'https://example.com/data',
};
const entry: CollectionEntry = {
  speciesId: 1,
  card,
  status: 'wanted',
  paidCents: null,
  valueCents: null,
  valuedAt: null,
};

describe('Pokédex filtering', () => {
  it('includes species without sample cards in the full Pokédex', () => {
    expect(queryCatalog(species, [card], [], DEFAULT_FILTERS)).toHaveLength(3);
    expect(
      queryCatalog(species, [card], [], { ...DEFAULT_FILTERS, availableOnly: true }),
    ).toHaveLength(1);
  });
  it('searches names and padded national numbers', () => {
    expect(queryCatalog(species, [], [], { ...DEFAULT_FILTERS, query: '#0025' })).toEqual([
      species[1],
    ]);
    expect(
      queryCatalog(species, [], [], { ...DEFAULT_FILTERS, query: 'CHIKO', generation: 2 }),
    ).toEqual([species[2]]);
  });
  it('treats a wish as missing but not owned', () => {
    expect(
      queryCatalog(species, [card], [entry], { ...DEFAULT_FILTERS, status: 'wanted' }),
    ).toEqual([species[0]]);
    expect(queryCatalog(species, [card], [entry], { ...DEFAULT_FILTERS, status: 'owned' })).toEqual(
      [],
    );
    expect(
      queryCatalog(species, [card], [entry], { ...DEFAULT_FILTERS, status: 'missing' }),
    ).toHaveLength(3);
  });
  it('filters wanted and owned entries individually or together without including catalog-only cards', () => {
    const owned = { ...entry, speciesId: 25, card: { ...card, id: 'pikachu', speciesId: 25, name: 'Pikachu' }, status: 'owned' as const };
    const catalogOnly = { ...card, id: 'chikorita', speciesId: 152, name: 'Chikorita' };
    expect(queryCatalog(species, [catalogOnly], [entry, owned], { ...DEFAULT_FILTERS, status: 'wanted' })).toEqual([species[0]]);
    expect(queryCatalog(species, [catalogOnly], [entry, owned], { ...DEFAULT_FILTERS, status: 'owned' })).toEqual([species[1]]);
    expect(queryCatalog(species, [catalogOnly], [entry, owned], { ...DEFAULT_FILTERS, status: 'selected' })).toEqual([species[0], species[1]]);
    expect(queryCatalog(species, [catalogOnly], [entry, owned], DEFAULT_FILTERS)).toEqual(species);
  });
  it('matches illustration, language and set on the same card', () => {
    const other = { ...card, id: 'b', language: 'ja', illustration: 'standard' as const };
    expect(
      queryCatalog(species, [card, other], [], {
        ...DEFAULT_FILTERS,
        language: 'ja',
        illustration: 'illustration-rare',
      }),
    ).toEqual([]);
  });
  it('prefers chosen card over a more illustrated sample', () => {
    const standard = { ...card, id: 'b', illustration: 'standard' as const };
    expect(preferredCard([standard, card])?.id).toBe('a');
    expect(preferredCard([standard, card], { ...entry, card: standard })?.id).toBe('b');
  });

  it('searches and sorts forms by national number and filters regional, mega and other forms', () => {
    const forms = [
      {
        id: 110320,
        nationalId: 52,
        name: 'Meowth de Galar',
        generation: 8,
        form: 'galar',
        isDefault: false,
      },
      {
        id: 110134,
        nationalId: 6,
        name: 'Mega Charizard X',
        generation: 6,
        form: 'mega-x',
        isDefault: false,
      },
      { id: 52, nationalId: 52, name: 'Meowth', generation: 1, form: 'default', isDefault: true },
      {
        id: 110058,
        nationalId: 479,
        name: 'Rotom Calor',
        generation: 4,
        form: 'heat',
        isDefault: false,
      },
    ];
    expect(
      queryCatalog(forms, [], [], { ...DEFAULT_FILTERS, query: '#0052' }).map((form) => form.id),
    ).toEqual([52, 110320]);
    expect(queryCatalog(forms, [], [], { ...DEFAULT_FILTERS, formType: 'regional' })).toEqual([
      forms[0],
    ]);
    expect(queryCatalog(forms, [], [], { ...DEFAULT_FILTERS, formType: 'mega' })).toEqual([
      forms[1],
    ]);
    expect(queryCatalog(forms, [], [], { ...DEFAULT_FILTERS, formType: 'other' })).toEqual([
      forms[3],
    ]);
    expect(queryCatalog(forms, [], [], { ...DEFAULT_FILTERS, formType: 'default' })).toEqual([
      forms[2],
    ]);
  });
});
