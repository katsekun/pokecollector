import { expect, test, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { speciesSchema } from '../src/app/core/collection';

let pageErrors: string[];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const image = await readFile('e2e/card-fixture.png');
  await page.route('https://assets.tcgdex.net/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: image }),
  );
  await page.route('https://api.tcgdex.net/v2/**', async (route) => {
    const url = new URL(route.request().url());
    const language = url.pathname.split('/')[2];
    if (url.pathname.endsWith('/cards')) {
      const speciesId = Number(url.searchParams.get('dexId')?.replace('eq:', ''));
      await route.fulfill({
        json: [1, 2].map((number) => ({ id: `fixture-${speciesId}-${number}` })),
      });
    } else {
      const id = url.pathname.split('/').at(-1)!;
      const speciesId = Number(id.split('-')[1]);
      const names: Record<number, string> = { 1: 'Bulbasaur', 25: 'Pikachu', 1025: 'Pecharunt' };
      await route.fulfill({
        json: {
          id,
          name: names[speciesId] ?? `Pokémon ${speciesId}`,
          localId: id.split('-').at(-1),
          dexId: [speciesId],
          rarity: 'Rara Ilustración',
          image: `https://assets.tcgdex.net/${language}/sv/sv01/${speciesId}`,
          set: { id: 'sv01', name: 'Scarlet & Violet' },
        },
      });
    }
  });
});
test.afterEach(() => expect(pageErrors).toEqual([]));

test('complete national snapshot without a local card catalogue', async ({ request, page }) => {
  const species = await (await request.get('/data/pokemon-species.json')).json();
  expect(species).toHaveLength(1545);
  expect(new Set(species.map((pokemon: { nationalId: number }) => pokemon.nationalId)).size).toBe(
    1025,
  );
  expect(species.some((pokemon: { form: string }) => pokemon.form.includes('gmax'))).toBe(false);
  expect(
    species.filter((pokemon: { nationalId: number }) => pokemon.nationalId === 52),
  ).toHaveLength(3);
  expect(new Set(species.map((pokemon: { id: number }) => pokemon.id)).size).toBe(species.length);
  expect(new Set(species.map((pokemon: { generation: number }) => pokemon.generation)).size).toBe(
    9,
  );
  for (const pokemon of species) expect(speciesSchema.safeParse(pokemon).success).toBe(true);
  const sampleRequests: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().includes('cards.sample') ||
      new URL(request.url()).pathname.startsWith('/cards/')
    )
      sampleRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('.specimen')).toHaveCount(24);
  expect(sampleRequests).toEqual([]);
});

test('Cardmarket reference follows the selected card without changing manual valuation', async ({
  page,
}, testInfo) => {
  await page.route('https://api.tcgdex.net/v2/*/cards/fixture-1-*', (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').at(-1)!;
    const number = id.split('-').at(-1)!;
    return route.fulfill({
      json: {
        id,
        name: 'Bulbasaur',
        localId: number,
        dexId: [1],
        rarity: 'Promo',
        image: 'https://assets.tcgdex.net/es/sv/sv01/1',
        set: { id: 'sv01', name: 'Scarlet & Violet' },
        pricing:
          number === '1'
            ? {
                cardmarket: {
                  unit: 'EUR',
                  updated: '2026-11-07T23:50:15.044Z',
                  trend: 63.71,
                  avg: 67.42,
                  avg1: 74,
                  avg7: 69.78,
                  avg30: 66.71,
                },
              }
            : null,
      },
    });
  });
  await page.goto('/pokemon/1');
  const market = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Referencia Cardmarket' }) });
  const search = market.getByRole('link', { name: 'Buscar en Cardmarket' });
  const searchUrl = new URL((await search.getAttribute('href'))!);
  expect(searchUrl.origin).toBe('https://www.cardmarket.com');
  expect(searchUrl.pathname).toBe('/es/Pokemon/Products/Search');
  expect(searchUrl.searchParams.get('searchString')).toBe('Bulbasaur 1');
  await expect(search).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(market).toContainText('63,71');
  await expect(market).toContainText('67,42');
  await expect(market).toContainText('69,78');
  await expect(market).toContainText('Idioma no especificado');
  await expect(market).toContainText('acabado no verificado');
  await page.getByRole('button', { name: 'La tengo', exact: true }).click();
  await page.getByLabel('Valoración manual (€)', { exact: true }).fill('12,34');
  await page.getByRole('button', { name: 'Guardar importes', exact: true }).click();
  await page.reload();
  await expect(market).toContainText('63,71');
  await expect(page.getByLabel('Valoración manual (€)', { exact: true })).toHaveValue('12.34');
  await page.screenshot({ path: testInfo.outputPath('cardmarket.png'), fullPage: true });
  await page.locator('.tcgdex__card').filter({ hasText: '· 2 · ES' }).click();
  await expect(market).toContainText('Sin precio disponible para esta carta.');
  await expect(market).not.toContainText('63,71');
  await expect(page.getByLabel('Valoración manual (€)', { exact: true })).toHaveValue('12.34');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('saved card market prices recover from a temporary provider failure', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pokecollector.collection.v1',
      JSON.stringify({
        schemaVersion: 2,
        exportedAt: '2026-11-08T00:00:00.000Z',
        currency: 'EUR',
        entries: [
          {
            speciesId: 1,
            status: 'owned',
            paidCents: 500,
            valueCents: 1234,
            valuedAt: '2026-11-08T00:00:00.000Z',
            card: {
              id: 'tcgdex:es:saved-1',
              speciesId: 1,
              name: 'Bulbasaur',
              language: 'es',
              set: 'Promo',
              number: '1',
              rarity: 'Promo',
              illustration: 'standard',
              image: null,
              source: 'https://api.tcgdex.net/v2/es/cards/saved-1',
            },
          },
        ],
        albums: [],
      }),
    );
  });
  let attempts = 0;
  await page.route('https://api.tcgdex.net/v2/es/cards/saved-1', (route) => {
    attempts += 1;
    if (attempts === 1) return route.fulfill({ status: 503 });
    return route.fulfill({
      json: {
        id: 'saved-1',
        name: 'Bulbasaur',
        localId: '1',
        dexId: [1],
        rarity: 'Promo',
        image: 'https://assets.tcgdex.net/es/sv/sv01/1',
        set: { id: 'sv01', name: 'Promo' },
        pricing: { cardmarket: { unit: 'EUR', trend: 3.45 } },
      },
    });
  });
  await page.goto('/pokemon/1');
  const market = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Referencia Cardmarket' }) });
  await expect(market).toContainText('No se pudieron consultar los precios.');
  await market.getByRole('button', { name: 'Reintentar precios', exact: true }).click();
  await expect(market).toContainText('3,45');
  await expect(page.getByLabel('Valoración manual (€)', { exact: true })).toHaveValue('12.34');
});

test('reference artwork prioritizes TCGdex languages and enables TCGplayer by default', async ({
  page,
}, testInfo) => {
  const image = await readFile('e2e/card-fixture.png');
  const marketplaceRequests: string[] = [];
  await page.route('https://tcgplayer-cdn.tcgplayer.com/**', (route) => {
    marketplaceRequests.push(route.request().url());
    return route.fulfill({ contentType: 'image/png', body: image });
  });
  await page.route('https://api.tcgdex.net/v2/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/cards'))
      return route.fulfill({ json: [1, 2, 3].map((number) => ({ id: `reference-${number}` })) });
    const id = url.pathname.split('/').at(-1)!;
    const number = id.split('-').at(-1)!;
    const language = url.pathname.split('/')[2];
    return route.fulfill({
      json: {
        id,
        name: 'Bulbasaur',
        localId: number,
        dexId: [1],
        rarity: 'Promo',
        set: { id: 'mep', name: 'Promos' },
        image: number === '1' && language === 'en' ? 'https://assets.tcgdex.net/en/me/mep/1' : null,
        variants_detailed: number === '2' ? [{ thirdParty: { tcgplayer: 684461 } }] : [],
      },
    });
  });
  await page.goto('/pokemon/1');
  const provider = page.getByLabel('Usar imágenes de TCGplayer', { exact: true });
  await expect(provider).toBeChecked();
  await expect(page.locator('.tcgdex__card')).toHaveCount(3);
  await expect(page.getByText('Imagen de referencia · EN · TCGdex', { exact: true })).toBeVisible();
  const marketplace = page.locator('.tcgdex__card').filter({ hasText: '· 2 · ES' });
  await expect(
    marketplace.getByText('Imagen de referencia · TCGplayer', { exact: true }),
  ).toBeVisible();
  await marketplace.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      marketplace.locator('img').evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  expect(marketplaceRequests.length).toBeGreaterThan(0);
  await expect(
    page.locator('.tcgdex__card').filter({ hasText: '· 3 · ES' }).locator('img'),
  ).toHaveAttribute('src', '/cards/card-placeholder.png');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('reference-images.png'), fullPage: true });
  await marketplace.click();
  await expect(page.locator('.detail__image-button img')).toHaveAttribute(
    'src',
    'https://tcgplayer-cdn.tcgplayer.com/product/684461_in_1000x1000.jpg',
  );
  await page.getByRole('button', { name: 'La tengo', exact: true }).click();
  await page.locator('.tcgdex > summary').click();
  await provider.uncheck();
  await expect(page.locator('.detail__image-button img')).toHaveAttribute(
    'src',
    '/cards/card-placeholder.png',
  );
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries[0].card,
    ),
  ).toMatchObject({
    id: 'tcgdex:es:reference-2',
    language: 'es',
    imageProvider: 'tcgplayer',
  });
});

test('broken artwork retries reference images before using the optional marketplace', async ({
  page,
}) => {
  const image = await readFile('e2e/card-fixture.png');
  const marketplaceRequests: string[] = [];
  await page.route('https://api.tcgdex.net/v2/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/cards'))
      return route.fulfill({ json: [{ id: 'broken-1' }, { id: 'broken-2' }] });
    const id = url.pathname.split('/').at(-1)!;
    const language = url.pathname.split('/')[2];
    return route.fulfill({
      json: {
        id,
        name: 'Bulbasaur',
        dexId: [1],
        localId: id.endsWith('1') ? '1' : '2',
        rarity: 'Promo',
        set: { id: 'sv01', name: 'Scarlet & Violet' },
        image: `https://assets.tcgdex.net/${language}/sv/sv01/${id}`,
        variants_detailed: [{ thirdParty: { tcgplayer: 684461 } }],
      },
    });
  });
  await page.route('https://assets.tcgdex.net/**', (route) =>
    route.request().url().includes('/fr/sv/sv01/broken-1/')
      ? route.fulfill({ contentType: 'image/png', body: image })
      : route.abort(),
  );
  await page.route('https://tcgplayer-cdn.tcgplayer.com/**', (route) => {
    marketplaceRequests.push(route.request().url());
    return route.fulfill({ contentType: 'image/png', body: image });
  });
  await page.goto('/pokemon/1');
  const french = page.locator('.tcgdex__card').filter({ hasText: '· 1 · ES' });
  const marketplace = page.locator('.tcgdex__card').filter({ hasText: '· 2 · ES' });
  await expect(french.locator('img')).toHaveAttribute(
    'src',
    'https://assets.tcgdex.net/fr/sv/sv01/broken-1/high.webp',
  );
  await expect(page.getByLabel('Usar imágenes de TCGplayer', { exact: true })).toBeChecked();
  await expect(marketplace.locator('img')).toHaveAttribute(
    'src',
    'https://tcgplayer-cdn.tcgplayer.com/product/684461_in_1000x1000.jpg',
  );
  await expect
    .poll(() =>
      marketplace.locator('img').evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await marketplace.click();
  await expect(page.locator('.detail__image-button img')).toHaveAttribute(
    'src',
    'https://tcgplayer-cdn.tcgplayer.com/product/684461_in_1000x1000.jpg',
  );
});

test('missing and failed artwork uses a neutral placeholder and selections survive reload', async ({
  page,
}, testInfo) => {
  await page.route('https://api.tcgdex.net/v2/*/cards/fixture-1-*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    return route.fulfill({
      json: {
        id,
        name: 'Bulbasaur',
        localId: id.split('-').at(-1),
        dexId: [1],
        rarity: 'Promo',
        image: id.endsWith('-2') ? 'https://assets.tcgdex.net/es/sv/sv01/missing' : undefined,
        set: { id: 'sv01', name: 'Scarlet & Violet' },
      },
    });
  });
  await page.route('https://assets.tcgdex.net/**', (route) => route.abort());
  await page.goto('/pokemon/1');
  const placeholders = page.locator('.tcgdex__card img[src="/cards/card-placeholder.png"]');
  await expect(placeholders).toHaveCount(2);
  await expect
    .poll(() =>
      placeholders.evaluateAll((images) =>
        images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
  await expect(placeholders.first()).toHaveAttribute('alt', /Imagen no disponible de Bulbasaur/);
  await expect(page.locator('.tcgdex__card').first()).toContainText('· 2 · ES');
  await expect(page.locator('.tcgdex__card').last()).toContainText('· 1 · ES');
  await page.locator('.tcgdex__card').filter({ hasText: '· 1 · ES' }).click();
  await page.getByRole('button', { name: 'La tengo', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ya la tengo', exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries[0].card,
    ),
  ).toMatchObject({ id: 'tcgdex:es:fixture-1-1', image: null });
  await expect(placeholders).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('card-placeholder.png'), fullPage: true });
  const marketplaceRequests: string[] = [];
  await page.route('https://tcgplayer-cdn.tcgplayer.com/**', (route) => {
    marketplaceRequests.push(route.request().url());
    return route.abort();
  });
  await page.evaluate(() => {
    const collection = JSON.parse(localStorage.getItem('pokecollector.collection.v1')!);
    collection.entries[0].card.image =
      'https://tcgplayer-cdn.tcgplayer.com/product/684461_in_1000x1000.jpg';
    localStorage.setItem('pokecollector.collection.v1', JSON.stringify(collection));
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ya la tengo', exact: true })).toBeVisible();
  await expect(page.locator('.detail__image-button img')).toHaveAttribute(
    'src',
    '/cards/card-placeholder.png',
  );
  expect(marketplaceRequests.length).toBeGreaterThan(0);
  await page.route('**/cards/card-placeholder.png', (route) => route.abort());
  await page.reload();
  await expect(page.locator('.tcgdex__card .card-art__fallback')).toHaveCount(2);
  await expect(page.locator('.tcgdex__card img')).toHaveCount(0);
});

test('light and dark Pokédex renders and loads TCGdex only when a Pokémon is opened', async ({
  page,
}, testInfo) => {
  const remoteDataRequests: string[] = [];
  page.on('request', (request) => {
    if (
      ['fetch', 'xhr'].includes(request.resourceType()) &&
      new URL(request.url()).hostname !== '127.0.0.1'
    )
      remoteDataRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Mi Pokédex', exact: true })).toBeVisible();
  await expect(page.locator('.specimen')).toHaveCount(24);
  await expect(page.locator('.specimen img')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const firstCardBounds = await page.locator('.specimen__image').first().boundingBox();
  expect(firstCardBounds!.y).toBeLessThan(page.viewportSize()!.height - 100);
  await page.screenshot({ path: testInfo.outputPath('pokedex-light.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Cambiar a tema oscuro', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('pokedex-dark.png'), animations: 'disabled' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('searchbox', { name: 'Buscar Pokémon' }).fill('Pikachu');
  await expect.poll(() => page.locator('.specimen').count()).toBeGreaterThan(1);
  expect(remoteDataRequests).toEqual([]);
  await page.getByRole('link', { name: 'Ver cartas de Pikachu', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pikachu', level: 1, exact: true })).toBeVisible();
  await expect(page.locator('.tcgdex__card')).toHaveCount(2);
  expect(remoteDataRequests.some((url) => url.startsWith('https://api.tcgdex.net/'))).toBe(true);
  await page.getByRole('link', { name: 'Volver a la Pokédex', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Buscar Pokémon' })).toHaveValue('Pikachu');
});

test('selection, prices, reload, zoom and confirmed replacement', async ({ page }, testInfo) => {
  await page.goto('/pokemon/1');
  await page.getByRole('button', { name: 'La tengo', exact: true }).click();
  await expect(page.getByText('Carta añadida a tu colección.', { exact: true })).toBeVisible();
  await page.getByLabel('Precio pagado (€)', { exact: true }).fill('12,34');
  await page.getByLabel('Valoración manual (€)', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Guardar importes', exact: true }).click();
  await expect(page.getByText('Importes guardados.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ya la tengo', exact: true })).toBeVisible();
  await expect(page.getByLabel('Precio pagado (€)', { exact: true })).toHaveValue('12.34');
  await expect(page.getByLabel('Valoración manual (€)', { exact: true })).toHaveValue('0.00');
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries.length,
    ),
  ).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('card-detail.png'), fullPage: true });
  await page.getByRole('button', { name: 'Ampliar imagen de la carta', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const originalId = await page.evaluate(
    () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries[0].card.id,
  );
  await page.locator('.tcgdex__card:not(.tcgdex__card--active)').first().click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Elegir favorita', exact: true }).click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries[0].card.id,
    ),
  ).toBe(originalId);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Elegir favorita', exact: true }).click();
  await expect(page.getByText('Carta favorita elegida.', { exact: true })).toBeVisible();
  const replaced = await page.evaluate(
    () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries[0],
  );
  expect(replaced.card.id).not.toBe(originalId);
  expect(replaced.status).toBe('wanted');
  expect(replaced.paidCents).toBeNull();
  await expect(page.getByLabel('Precio pagado (€)', { exact: true })).toHaveValue('');
});

test('albums can be created, edited and removed without deleting cards', async ({ page }) => {
  await page.goto('/pokemon/1');
  await page.getByRole('button', { name: 'La tengo', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('link', { name: /Mis álbumes/ })
    .click();
  await page.getByRole('button', { name: 'Nuevo álbum', exact: true }).click();
  await page.getByLabel('Nombre del álbum', { exact: true }).fill('Kanto');
  await page.getByRole('button', { name: 'Crear álbum', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Añadir o quitar cartas' }).click();
  await page.getByRole('checkbox', { name: /Bulbasaur/ }).check();
  await expect(page.locator('.album-content__card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Renombrar Kanto', exact: true }).click();
  await page.getByLabel('Nombre del álbum', { exact: true }).fill('Mis full arts');
  await page.getByRole('button', { name: 'Guardar nombre', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Abrir álbum Mis full arts', exact: true }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: /Bulbasaur/ }).uncheck();
  await expect(page.locator('.album-content__card')).toHaveCount(0);
  await page.getByRole('checkbox', { name: /Bulbasaur/ }).check();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Eliminar álbum Mis full arts', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Tu primer álbum empieza aquí', exact: true }),
  ).toBeVisible();
  const data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pokecollector.collection.v1')!),
  );
  expect(data.entries).toHaveLength(1);
  expect(data.albums).toHaveLength(0);
});

test('JSON backup is validated, downloaded and restored without silent replacement', async ({
  page,
}) => {
  await page.goto('/pokemon/1');
  await page.getByRole('button', { name: 'La tengo', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const download = await downloadPromise;
  const backup = await readFile((await download.path())!, 'utf8');
  expect(JSON.parse(backup).entries).toHaveLength(1);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  });
  await expect(
    page.getByText('El archivo no contiene un JSON válido.', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries.length,
    ),
  ).toBe(1);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Eliminar selección', exact: true }).click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries.length,
    ),
  ).toBe(0);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('input[type="file"]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backup),
  });
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries.length,
    ),
  ).toBe(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('input[type="file"]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backup),
  });
  await expect(page.getByText('Colección restaurada.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ya la tengo', exact: true })).toBeVisible();
});

test('TCGdex supports pagination, cache, languages and persistent remote selections', async ({
  page,
}, testInfo) => {
  const pageSize = 48;
  const image = await readFile('e2e/card-fixture.png');
  const queries: string[] = [];
  await page.route('https://assets.tcgdex.net/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: image }),
  );
  await page.route('https://api.tcgdex.net/v2/**', async (route) => {
    const url = new URL(route.request().url());
    const language = url.pathname.split('/')[2];
    if (url.pathname.endsWith('/cards')) {
      const currentPage = Number(url.searchParams.get('pagination:page'));
      queries.push(`${language}:${currentPage}`);
      expect(url.searchParams.get('dexId')).toBe('eq:1025');
      expect(url.searchParams.get('pagination:itemsPerPage')).toBe(String(pageSize));
      const ids =
        currentPage === 1
          ? Array.from({ length: pageSize }, (_, index) => `fixture-${index + 1}`)
          : [`fixture-${pageSize + 1}`];
      await route.fulfill({ json: ids.map((id) => ({ id })) });
    } else {
      const id = url.pathname.split('/').at(-1);
      await route.fulfill({
        json: {
          id,
          name: 'Pecharunt',
          localId: id?.split('-').at(-1),
          dexId: [1025],
          rarity: language === 'es' ? 'Rara Ilustración' : 'Illustration rare',
          image: `https://assets.tcgdex.net/${language}/sv/sv01/1`,
          set: { id: 'sv01', name: 'Scarlet & Violet' },
        },
      });
    }
  });
  await page.goto('/pokemon/1025');
  await expect(page.locator('.tcgdex__card')).toHaveCount(pageSize);
  await expect(
    page.getByRole('heading', { name: 'Pecharunt', level: 2, exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pokecollector.collection.v1'))).toBeNull();
  await page.getByRole('button', { name: 'Cargar más', exact: true }).click();
  await expect(page.locator('.tcgdex__card')).toHaveCount(pageSize + 1);
  await expect(page.getByRole('button', { name: 'Cargar más', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Buscar en TCGdex', exact: true }).click();
  await expect(page.locator('.tcgdex__card')).toHaveCount(pageSize);
  expect(queries).toEqual(['es:1', 'es:2']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath('tcgdex-results.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.locator('.tcgdex__card').first().click();
  await expect(
    page.getByRole('heading', { name: 'Pecharunt', level: 2, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'La tengo', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ya la tengo', exact: true })).toBeVisible();
  const savedId = await page.evaluate(
    () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries[0].card.id,
  );
  expect(savedId).toMatch(/^tcgdex:es:/);
  await page.getByLabel('Idioma de las cartas').selectOption('en');
  await expect(page.locator('.tcgdex__card')).toHaveCount(pageSize);
  await page.locator('.tcgdex__card').first().click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'La tengo', exact: true }).click();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries[0].card.id,
    ),
  ).toBe(savedId);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'La quiero', exact: true }).click();
  const restored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries[0],
  );
  expect(restored.card.id).toMatch(/^tcgdex:en:/);
  expect(restored.status).toBe('wanted');
});

test('TCGdex failures preserve the collection and allow retry', async ({ page }) => {
  await page.goto('/pokemon/1');
  await page.getByRole('button', { name: 'La tengo', exact: true }).click();
  const saved = await page.evaluate(() => localStorage.getItem('pokecollector.collection.v1'));
  let attempts = 0;
  await page.route('https://api.tcgdex.net/v2/**', async (route) => {
    attempts += 1;
    if (attempts === 1) await route.fulfill({ status: 503, body: '' });
    else await route.fulfill({ json: [] });
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('No se pudo consultar TCGdex');
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(
    page.getByText('No hay cartas con forma verificada en esta página.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pokecollector.collection.v1'))).toBe(
    saved,
  );
});

test('TCGdex ignores late results after changing language', async ({ page }) => {
  let pendingSpanish: Route | undefined;
  await page.route('https://api.tcgdex.net/v2/**', async (route) => {
    if (route.request().url().includes('/es/')) pendingSpanish = route;
    else await route.fulfill({ json: [] });
  });
  await page.goto('/pokemon/1');
  await expect.poll(() => !!pendingSpanish).toBe(true);
  await page.getByLabel('Idioma de las cartas').selectOption('en');
  await expect(
    page.getByText('No hay cartas con forma verificada en esta página.', {
      exact: true,
    }),
  ).toBeVisible();
  const response = page.waitForResponse((response) => response.url().includes('/es/cards'));
  await pendingSpanish!.fulfill({ status: 503, body: '' });
  await response;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Idioma de las cartas')).toHaveValue('en');
});

test('legacy saved selections remain intact without the local sample', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pokecollector.collection.v1',
      JSON.stringify({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        currency: 'EUR',
        albums: [],
        entries: [
          {
            speciesId: 1,
            status: 'owned',
            paidCents: 1234,
            valueCents: null,
            valuedAt: null,
            card: {
              id: 'sv3pt5-166',
              speciesId: 1,
              name: 'Bulbasaur',
              language: 'en',
              set: '151',
              number: '166',
              rarity: 'Illustration Rare',
              illustration: 'illustration-rare',
              image: 'https://assets.tcgdex.net/en/sv/sv03.5/166/high.webp',
              source: 'https://github.com/PokemonTCG/pokemon-tcg-data',
            },
          },
        ],
      }),
    );
  });
  await page.goto('/pokemon/1');
  await expect(page.locator('.tcgdex__card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Ya la tengo', exact: true })).toBeVisible();
  await expect(page.getByLabel('Precio pagado (€)', { exact: true })).toHaveValue('12.34');
  const entry = await page.evaluate(
    () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries[0],
  );
  expect(entry.card.id).toBe('sv3pt5-166');
  expect(entry.paidCents).toBe(1234);
});

test('normal and regional Meowth have independent cards and share national number 0052', async ({
  page,
}, testInfo) => {
  await page.route('https://api.tcgdex.net/v2/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/cards')) {
      expect(url.searchParams.get('dexId')).toBe('eq:52');
      await route.fulfill({ json: [{ id: 'normal' }, { id: 'galar' }] });
    } else {
      const id = url.pathname.split('/').at(-1);
      await route.fulfill({
        json: {
          id,
          name: id === 'galar' ? 'Meowth de Galar' : 'Meowth',
          localId: id,
          dexId: [52],
          rarity: 'Rara Ilustración',
          image: 'https://assets.tcgdex.net/es/sv/sv01/52',
          set: { id: 'sv01', name: 'Scarlet & Violet' },
        },
      });
    }
  });
  await page.goto('/pokemon/52');
  await expect(page.locator('.tcgdex__card')).toHaveCount(1);
  await page.getByRole('button', { name: 'La tengo', exact: true }).click();
  await page.getByRole('link', { name: 'Volver a la Pokédex', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Buscar Pokémon' }).fill('#0052');
  await expect(page.locator('.specimen')).toHaveCount(3);
  await expect(page.locator('.specimen__identity > span').filter({ hasText: '#0052' })).toHaveCount(
    3,
  );
  await page.getByRole('link', { name: /Ver cartas de Meowth.*Galar/ }).click();
  await expect(page.locator('.page-heading__eyebrow')).toContainText('#0052');
  await expect(page.locator('.tcgdex__card')).toHaveCount(1);
  await expect(page.locator('.tcgdex__card')).toContainText('Meowth de Galar');
  await page.getByRole('button', { name: 'La tengo', exact: true }).click();
  const entries = await page.evaluate(
    () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries,
  );
  expect(entries).toHaveLength(2);
  expect(
    entries.every((entry: { card: { nationalId: number } }) => entry.card.nationalId === 52),
  ).toBe(true);
  expect(new Set(entries.map((entry: { speciesId: number }) => entry.speciesId)).size).toBe(2);
  await page.screenshot({
    path: testInfo.outputPath('regional-form.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('ambiguous Mega cards require explicit form confirmation', async ({ page }, testInfo) => {
  await page.route('https://api.tcgdex.net/v2/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/cards')) await route.fulfill({ json: [{ id: 'ambiguous-mega' }] });
    else
      await route.fulfill({
        json: {
          id: 'ambiguous-mega',
          name: 'M Charizard EX',
          localId: '1',
          dexId: [6],
          rarity: 'Ultra Rare',
          image: 'https://assets.tcgdex.net/en/xy/xy2/1',
          set: { id: 'xy2', name: 'Flashfire' },
        },
      });
  });
  await page.goto('/pokemon/110134');
  await expect(page.getByRole('checkbox', { name: /cartas sin forma verificada/ })).toBeVisible();
  await expect(page.locator('.tcgdex__card')).toHaveCount(0);
  await page.getByRole('checkbox', { name: /cartas sin forma verificada/ }).check();
  await page.locator('.tcgdex__card').click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'La tengo', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('pokecollector.collection.v1'))).toBeNull();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'La tengo', exact: true }).click();
  const entry = await page.evaluate(
    () => JSON.parse(localStorage.getItem('pokecollector.collection.v1')!).entries[0],
  );
  expect(entry.speciesId).toBe(110134);
  expect(entry.card.nationalId).toBe(6);
  expect(entry.card.requiresFormConfirmation).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath('mega-form.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('legacy regional cards migrate with their prices and album references', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pokecollector.collection.v1',
      JSON.stringify({
        schemaVersion: 1,
        currency: 'EUR',
        exportedAt: new Date().toISOString(),
        albums: [{ id: 'old-album', name: 'Mis regionales', speciesIds: [52] }],
        entries: [
          {
            speciesId: 52,
            status: 'owned',
            paidCents: 4200,
            valueCents: null,
            valuedAt: null,
            card: {
              id: 'old-galar-meowth',
              speciesId: 52,
              name: 'Galarian Meowth',
              language: 'en',
              set: 'Sword & Shield',
              number: '1',
              rarity: 'Rare',
              illustration: 'standard',
              image: 'https://assets.tcgdex.net/en/swsh/swsh1/1/high.webp',
              source: 'https://api.tcgdex.net/v2/en/cards/swsh1-1',
            },
          },
        ],
      }),
    );
  });
  await page.goto('/pokemon/110320');
  await expect(page.getByRole('button', { name: 'Ya la tengo', exact: true })).toBeVisible();
  await expect(page.getByLabel('Precio pagado (€)', { exact: true })).toHaveValue('42.00');
  await expect(page.getByRole('checkbox', { name: 'Mis regionales', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Guardar importes', exact: true }).click();
  await expect(page.getByText('Importes guardados.', { exact: true })).toBeVisible();
  const data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pokecollector.collection.v1')!),
  );
  expect(data.schemaVersion).toBe(2);
  expect(data.entries[0]).toMatchObject({ speciesId: 110320, paidCents: 4200 });
  expect(data.albums[0].speciesIds).toEqual([110320]);
});
