import type { PokemonSpecies } from './collection';

export function nationalNumber(pokemon: PokemonSpecies): number {
  return pokemon.nationalId ?? pokemon.id;
}

export function normalizePokemonName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\blv\.?\s*x\b/g, '')
    .replace(/\b(ex|gx|v|vmax|vstar|break|radiant|shining|shiny|delta)\b/g, '')
    .replace(/\b(form|forme|forma|de|del|of|type|tipo|mode|modo|style|estilo)\b/g, '')
    .replace(/[^\p{L}\p{N}♀♂!?%]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function findCardForm(
  name: string,
  forms: readonly PokemonSpecies[],
): PokemonSpecies | undefined {
  if (/\bvmax\b/i.test(name)) return undefined;
  const normalized = normalizePokemonName(name);
  if (/\b(gigantamax|gigamax|gmax)\b/.test(normalized)) return undefined;
  const exact = forms.filter((form) =>
    (form.aliases ?? [form.name]).some((alias) => normalizePokemonName(alias) === normalized),
  );
  if (exact.length === 1) {
    const form = exact[0];
    if (forms.length > 1 && form.isDefault && form.form && form.form !== 'default') {
      const described = (form.formNames ?? []).some((alias) =>
        normalized.includes(normalizePokemonName(alias)),
      );
      if (!described) return undefined;
    }
    return form;
  }
  if (exact.length > 1) return undefined;
  const descriptors = forms.filter(
    (form) =>
      form.isDefault === false &&
      (form.formNames ?? []).some((alias) => {
        const descriptor = normalizePokemonName(alias);
        return descriptor.length > 1 && normalized.includes(descriptor);
      }),
  );
  if (descriptors.length === 1) return descriptors[0];
  return undefined;
}
