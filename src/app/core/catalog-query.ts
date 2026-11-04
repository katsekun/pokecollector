import { Card, CollectionEntry, PokemonSpecies } from './collection';
import { nationalNumber } from './pokemon-forms';

export interface CatalogFilters {
  readonly query: string;
  readonly generation: number;
  readonly status: 'all' | 'owned' | 'wanted' | 'missing';
  readonly illustration: string;
  readonly language: string;
  readonly set: string;
  readonly availableOnly: boolean;
  readonly sort: 'number' | 'name' | 'art';
  readonly formType: 'all' | 'default' | 'regional' | 'mega' | 'other';
}

export const DEFAULT_FILTERS: CatalogFilters = {
  query: '',
  generation: 0,
  status: 'all',
  illustration: '',
  language: '',
  set: '',
  availableOnly: false,
  sort: 'number',
  formType: 'all',
};

export const ILLUSTRATION_RANK: Record<Card['illustration'], number> = {
  'special-illustration-rare': 0,
  'illustration-rare': 1,
  'full-art': 2,
  standard: 3,
};

function matchesFormType(pokemon: PokemonSpecies, formType: CatalogFilters['formType']): boolean {
  const form = pokemon.form ?? 'default';
  const regional = /alola|galar|hisui|paldea/.test(form);
  const mega = form.includes('mega');
  switch (formType) {
    case 'default':
      return pokemon.isDefault !== false;
    case 'regional':
      return regional;
    case 'mega':
      return mega;
    case 'other':
      return pokemon.isDefault === false && !regional && !mega;
    default:
      return true;
  }
}

export function preferredCard(cards: readonly Card[], entry?: CollectionEntry): Card | null {
  return (
    entry?.card ??
    [...cards].sort(
      (first, second) =>
        ILLUSTRATION_RANK[first.illustration] - ILLUSTRATION_RANK[second.illustration],
    )[0] ??
    null
  );
}

export function queryCatalog(
  species: readonly PokemonSpecies[],
  cards: readonly Card[],
  entries: readonly CollectionEntry[],
  filters: CatalogFilters,
): readonly PokemonSpecies[] {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es');
  const search = normalize(filters.query.trim().replace(/^#/, ''));
  const entryMap = new Map(entries.map((entry) => [entry.speciesId, entry]));
  const matchingCards = (pokemon: PokemonSpecies) => {
    const entry = entryMap.get(pokemon.id);
    return entry ? [entry.card] : cards.filter((card) => card.speciesId === pokemon.id);
  };
  const result = species.filter((pokemon) => {
    const entry = entryMap.get(pokemon.id);
    if (
      search &&
      !normalize(pokemon.name).includes(search) &&
      !nationalNumber(pokemon).toString().padStart(4, '0').includes(search)
    )
      return false;
    if (filters.generation && pokemon.generation !== filters.generation) return false;
    if (!matchesFormType(pokemon, filters.formType)) return false;
    if (filters.status === 'missing' && entry?.status === 'owned') return false;
    if (
      (filters.status === 'owned' || filters.status === 'wanted') &&
      entry?.status !== filters.status
    )
      return false;
    const available = matchingCards(pokemon);
    if (filters.availableOnly && !available.length) return false;
    if (filters.illustration || filters.language || filters.set) {
      return available.some(
        (card) =>
          (!filters.illustration ||
            (filters.illustration === 'special'
              ? card.illustration !== 'standard'
              : card.illustration === filters.illustration)) &&
          (!filters.language || card.language === filters.language) &&
          (!filters.set || card.set === filters.set),
      );
    }
    return true;
  });
  return result.sort((first, second) => {
    if (filters.sort === 'name') return first.name.localeCompare(second.name, 'es');
    if (filters.sort === 'art') {
      const firstCard = preferredCard(matchingCards(first));
      const secondCard = preferredCard(matchingCards(second));
      const difference =
        (firstCard ? ILLUSTRATION_RANK[firstCard.illustration] : 4) -
        (secondCard ? ILLUSTRATION_RANK[secondCard.illustration] : 4);
      if (difference) return difference;
    }
    return (
      nationalNumber(first) - nationalNumber(second) ||
      Number(second.isDefault ?? true) - Number(first.isDefault ?? true) ||
      first.id - second.id
    );
  });
}

export function formatEuros(cents: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

export const REGIONS = [
  'Nacional',
  'Kanto',
  'Johto',
  'Hoenn',
  'Sinnoh',
  'Teselia',
  'Kalos',
  'Alola',
  'Galar',
  'Paldea',
];
