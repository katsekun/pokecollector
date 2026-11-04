import { describe, expect, it } from 'vitest';
import { PokemonSpecies } from './collection';
import { findCardForm, nationalNumber } from './pokemon-forms';

const forms: PokemonSpecies[] = [
  { id: 52, nationalId: 52, name: 'Meowth', generation: 1, isDefault: true, aliases: ['Meowth'] },
  {
    id: 10209,
    nationalId: 52,
    name: 'Meowth de Alola',
    generation: 7,
    isDefault: false,
    aliases: ['Meowth de Alola', 'Alolan Meowth'],
    formNames: ['Alola', 'Alolan'],
  },
  {
    id: 10320,
    nationalId: 52,
    name: 'Meowth de Galar',
    generation: 8,
    isDefault: false,
    aliases: ['Meowth de Galar', 'Galarian Meowth'],
    formNames: ['Galar', 'Galarian'],
  },
];

describe('Pokédex form identity', () => {
  it('keeps national number separate from the form identifier', () => {
    expect(nationalNumber(forms[2])).toBe(52);
    expect(new Set(forms.map((form) => form.id)).size).toBe(3);
  });
  it('recognizes translated regional names and card suffixes', () => {
    expect(findCardForm('Meowth de Galar V', forms)?.id).toBe(10320);
    expect(findCardForm('Alolan Meowth-GX', forms)?.id).toBe(10209);
    expect(findCardForm('Meowth', forms)?.id).toBe(52);
  });
  it('does not assign Gigantamax or ambiguous names', () => {
    expect(findCardForm('Meowth Gigantamax', forms)).toBeUndefined();
    expect(findCardForm('Unknown Meowth', forms)).toBeUndefined();
    expect(
      findCardForm('Mega Charizard EX', [
        {
          id: 10134,
          nationalId: 6,
          name: 'Mega Charizard X',
          generation: 6,
          aliases: ['Mega Charizard'],
          isDefault: false,
        },
        {
          id: 10135,
          nationalId: 6,
          name: 'Mega Charizard Y',
          generation: 6,
          aliases: ['Mega Charizard'],
          isDefault: false,
        },
      ]),
    ).toBeUndefined();
  });
});
