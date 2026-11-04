import { mkdir, writeFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

const root = new URL('../public/', import.meta.url);
const pokeRevision = 'e5b79b2e15d7c50735a945936afd4cd1cfd94eae';
const pokeBase = `https://raw.githubusercontent.com/PokeAPI/pokeapi/${pokeRevision}/`;

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response;
}

async function readCsv(file) {
  return parse(await (await download(`${pokeBase}data/v2/csv/${file}.csv`)).text(), {
    columns: true,
    skip_empty_lines: true,
  });
}

await mkdir(new URL('data/', root), { recursive: true });
await mkdir(new URL('licenses/', root), { recursive: true });
const [rows, names, nationalNumbers, pokemonRows, formRows, formNames, versionGroups] =
  await Promise.all([
    readCsv('pokemon_species'),
    readCsv('pokemon_species_names'),
    readCsv('pokemon_dex_numbers'),
    readCsv('pokemon'),
    readCsv('pokemon_forms'),
    readCsv('pokemon_form_names'),
    readCsv('version_groups'),
  ]);
const nationalIds = new Set(
  nationalNumbers.filter((row) => row.pokedex_id === '1').map((row) => Number(row.species_id)),
);
const englishNames = new Map(
  names
    .filter((row) => row.local_language_id === '9')
    .map((row) => [Number(row.pokemon_species_id), row.name]),
);
const spanishNames = new Map(
  names
    .filter((row) => row.local_language_id === '7')
    .map((row) => [Number(row.pokemon_species_id), row.name]),
);
const pokemonById = new Map(pokemonRows.map((row) => [row.id, row]));
const generationByVersion = new Map(
  versionGroups.map((row) => [row.id, Number(row.generation_id)]),
);
const includedForms = formRows.filter((form) => !/(^|-)gmax($|-)/.test(form.identifier));
const species = rows
  .filter((row) => nationalIds.has(Number(row.id)))
  .flatMap((row) => {
    const nationalId = Number(row.id);
    const forms = includedForms.filter(
      (form) => pokemonById.get(form.pokemon_id)?.species_id === row.id,
    );
    const canonical =
      forms.find(
        (form) => form.is_default === '1' && pokemonById.get(form.pokemon_id)?.is_default === '1',
      ) ?? forms[0];
    if (!canonical) throw new Error(`Missing default form for ${row.identifier}`);
    const speciesNames = names.filter((name) => name.pokemon_species_id === row.id);
    const baseName = spanishNames.get(nationalId) ?? englishNames.get(nationalId) ?? row.identifier;
    return forms.map((form) => {
      const localized = formNames.filter((name) => name.pokemon_form_id === form.id);
      const spanish = localized.find((name) => name.local_language_id === '7');
      const english = localized.find((name) => name.local_language_id === '9');
      const isDefault = form.id === canonical.id;
      const label =
        spanish?.form_name ||
        english?.form_name ||
        form.form_identifier.replaceAll('-', ' ') ||
        'Forma normal';
      const aliases = new Set(localized.map((name) => name.pokemon_name).filter(Boolean));
      if (isDefault) speciesNames.forEach((name) => aliases.add(name.name));
      localized.forEach((name) => {
        const base = speciesNames.find(
          (item) => item.local_language_id === name.local_language_id,
        )?.name;
        if (base && name.form_name) {
          aliases.add(`${base} ${name.form_name}`);
          aliases.add(`${name.form_name} ${base}`);
        }
      });
      const fullName = label.toLowerCase().includes(baseName.toLowerCase())
        ? label
        : `${baseName} (${label})`;
      const gender = { 'mega-male': 'Macho', 'mega-female': 'Hembra' }[form.form_identifier];
      const formName = spanish?.pokemon_name || fullName;
      const genderLabel = gender ? ` (${gender})` : '';
      const displayName = isDefault ? baseName : formName + genderLabel;
      aliases.add(displayName);
      return {
        id: isDefault ? nationalId : 100_000 + Number(form.id),
        nationalId,
        name: displayName,
        generation: isDefault
          ? Number(row.generation_id)
          : (generationByVersion.get(form.introduced_in_version_group_id) ??
            Number(row.generation_id)),
        form: form.form_identifier || 'default',
        formName: label,
        isDefault,
        aliases: [...aliases],
        formNames: [...new Set(localized.map((name) => name.form_name).filter(Boolean))],
      };
    });
  })
  .sort(
    (first, second) =>
      first.nationalId - second.nationalId ||
      Number(second.isDefault) - Number(first.isDefault) ||
      first.id - second.id,
  );

const englishFormNames = new Map(
  formNames
    .filter((row) => row.local_language_id === '9')
    .map((row) => [Number(row.pokemon_form_id), row.pokemon_name]),
);
const nameGroups = new Map();
for (const pokemon of species) {
  const key = `${pokemon.nationalId}:${pokemon.name}`;
  nameGroups.set(key, [...(nameGroups.get(key) ?? []), pokemon]);
}
const entries = species.map((pokemon) => {
  const group = nameGroups.get(`${pokemon.nationalId}:${pokemon.name}`);
  if (group.length === 1) return pokemon;
  const fullName = englishFormNames.get(pokemon.id - 100_000) || pokemon.name;
  const repeated = group.some(
    (other) =>
      other.id !== pokemon.id &&
      (englishFormNames.get(other.id - 100_000) || other.name) === fullName,
  );
  const name = repeated ? `${fullName} (${pokemon.form.replaceAll('-', ' ')})` : fullName;
  return { ...pokemon, name, aliases: [...new Set([...pokemon.aliases, name])] };
});

if (
  new Set(entries.map((pokemon) => pokemon.nationalId)).size !== 1025 ||
  new Set(entries.map((pokemon) => pokemon.id)).size !== entries.length ||
  new Set(entries.map((pokemon) => `${pokemon.nationalId}:${pokemon.name}`)).size !== entries.length
) {
  throw new Error('National Pokédex is incomplete or contains duplicate species.');
}
await writeFile(new URL('data/pokemon-species.json', root), JSON.stringify(entries));
await writeFile(
  new URL('data/provenance.json', root),
  JSON.stringify(
    {
      preparedAt: new Date().toISOString(),
      pokeRevision,
      speciesCount: entries.length,
      nationalSpeciesCount: nationalIds.size,
      excludedForms: ['gmax'],
      speciesSource: `https://github.com/PokeAPI/pokeapi/tree/${pokeRevision}/data/v2/csv`,
      cardsSource: 'https://tcgdex.dev/',
      note: 'All PokeAPI forms except Gigantamax. Internal form IDs are distinct from national numbers. No card samples bundled.',
    },
    null,
    2,
  ),
);
await writeFile(
  new URL('licenses/pokeapi.txt', root),
  await (await download(`${pokeBase}LICENSE.md`)).text(),
);
console.log(
  `Prepared ${entries.length} entries across ${nationalIds.size} national species; Gigantamax excluded. No user collection was changed.`,
);
