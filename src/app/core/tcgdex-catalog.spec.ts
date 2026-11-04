import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapTcgdexCard, TcgdexCatalog, tcgdexIllustration } from './tcgdex-catalog';
import { createBackup, EMPTY_COLLECTION, parseBackup, chooseCard } from './collection';

const detail = {
  id: 'sv03.5-166',
  name: 'Bulbasaur',
  localId: '166',
  dexId: [1],
  rarity: 'Illustration rare',
  image: 'https://assets.tcgdex.net/en/sv/sv03.5/166',
  set: { id: 'sv03.5', name: '151' },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TCGdex adapter', () => {
  it('maps verified metadata and creates portable language-specific identifiers', () => {
    const english = mapTcgdexCard(detail, 1, 'en')!;
    expect(english).toMatchObject({
      id: 'tcgdex:en:sv03.5-166',
      language: 'en',
      illustration: 'illustration-rare',
      image: `${detail.image}/high.webp`,
    });
    expect(mapTcgdexCard(detail, 1, 'es')?.id).not.toBe(english.id);
    const backup = createBackup(chooseCard(EMPTY_COLLECTION, english));
    expect(
      parseBackup(JSON.stringify(backup), [{ id: 1, name: 'Bulbasaur', generation: 1 }]),
    ).toEqual(backup);
  });
  it('does not assign other species', () => {
    expect(mapTcgdexCard(detail, 25, 'en')).toBeNull();
  });
  it.each([
    null,
    '',
    'not-a-url',
    'https://untrusted.example/image',
    'http://assets.tcgdex.net/en/sv/sv01/1',
  ])('keeps physical cards with missing or invalid artwork %s', (image) => {
    expect(mapTcgdexCard({ ...detail, image }, 1, 'en')).toMatchObject({ image: null });
  });
  it('uses TCGplayer when the provided artwork URL is invalid', () => {
    expect(
      mapTcgdexCard(
        {
          ...detail,
          image: 'not-a-url',
          variants_detailed: [{ thirdParty: { tcgplayer: 684461 } }],
        },
        1,
        'en',
      )?.image,
    ).toBe('https://tcgplayer-cdn.tcgplayer.com/product/684461_in_1000x1000.jpg');
  });
  it.each([
    { set: { id: 'A1', name: 'Genetic Apex' }, image: undefined },
    { set: { id: 'P-A', name: 'Promos-A' }, image: null },
    { set: { id: 'B2a', name: 'Paldean Wonders' }, image: 'not-a-url' },
    {
      set: { id: 'future-pocket', name: 'Pocket' },
      image: 'https://assets.tcgdex.net/en/tcgp/future/1',
    },
  ])('excludes Pocket cards regardless of artwork availability: $set.id', (pocket) => {
    expect(mapTcgdexCard({ ...detail, ...pocket }, 1, 'en')).toBeNull();
  });
  it('silently excludes Pocket cards without counting them as omitted and keeps physical cards without artwork', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json([{ id: 'A1-001' }, { id: 'physical' }, { id: 'wrong-species' }]),
        )
        .mockResolvedValueOnce(
          Response.json({
            ...detail,
            id: 'A1-001',
            image: null,
            set: { id: 'A1', name: 'Genetic Apex' },
          }),
        )
        .mockResolvedValueOnce(Response.json({ ...detail, id: 'physical', image: 'not-a-url' }))
        .mockResolvedValueOnce(Response.json({ ...detail, id: 'wrong-species', dexId: [25] })),
    );
    const result = await new TcgdexCatalog().search(1, 'en');
    expect(result).toMatchObject({ hasMore: false, omitted: 1 });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ id: 'tcgdex:en:physical', image: null });
  });
  it('keeps cards without either image source selectable and portable', () => {
    const card = mapTcgdexCard({ ...detail, image: undefined }, 1, 'en')!;
    expect(card).toMatchObject({ id: `tcgdex:en:${detail.id}`, image: null });
    const backup = createBackup(chooseCard(EMPTY_COLLECTION, card));
    expect(
      parseBackup(JSON.stringify(backup), [{ id: 1, name: 'Bulbasaur', generation: 1 }]),
    ).toEqual(backup);
  });
  it('uses the TCGplayer product image when TCGdex has no artwork and preserves backups', () => {
    const promo = mapTcgdexCard(
      {
        ...detail,
        id: 'mep-037',
        localId: '037',
        image: undefined,
        rarity: 'Promo',
        set: { id: 'mep', name: 'MEP Black Star Promos' },
        variants_detailed: [
          { thirdParty: { cardmarket: 875186 } },
          { thirdParty: { tcgplayer: 684461 } },
        ],
      },
      1,
      'es',
    )!;
    expect(promo).toMatchObject({
      id: 'tcgdex:es:mep-037',
      language: 'es',
      rarity: 'Promo',
      illustration: 'standard',
      image: 'https://tcgplayer-cdn.tcgplayer.com/product/684461_in_1000x1000.jpg',
    });
    const backup = createBackup(chooseCard(EMPTY_COLLECTION, promo));
    expect(
      parseBackup(JSON.stringify(backup), [{ id: 1, name: 'Bulbasaur', generation: 1 }]),
    ).toEqual(backup);
  });
  it('prefers TCGdex artwork even when a TCGplayer product is available', () => {
    expect(
      mapTcgdexCard(
        {
          ...detail,
          variants_detailed: [{ thirdParty: { tcgplayer: 684461 } }],
        },
        1,
        'en',
      )?.image,
    ).toBe(`${detail.image}/high.webp`);
  });
  it.each([undefined, 0, -1, 1.5, '684461', 'invalid/path', Number.MAX_SAFE_INTEGER + 1])(
    'does not build a fallback image from invalid product ID %s',
    (productId) => {
      expect(
        mapTcgdexCard(
          {
            ...detail,
            image: undefined,
            variants_detailed: [{ thirdParty: { tcgplayer: productId } }],
          },
          1,
          'en',
        ),
      ).toMatchObject({ image: null });
    },
  );
  it('normalizes known rarities conservatively without treating all rare cards as full art', () => {
    expect(tcgdexIllustration('Special illustration rare')).toBe('special-illustration-rare');
    expect(tcgdexIllustration('Rara Ilustración')).toBe('illustration-rare');
    expect(tcgdexIllustration('Rara Ilustración Especial')).toBe('special-illustration-rare');
    expect(tcgdexIllustration('Ultra Rare', 'sv03.5')).toBe('full-art');
    expect(tcgdexIllustration('Ultra Rare', 'bw1')).toBe('standard');
    expect(tcgdexIllustration('Rare Holo')).toBe('standard');
  });
  it('filters by exact national number and caches identical concurrent requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([{ id: detail.id }]))
      .mockResolvedValueOnce(Response.json(detail));
    vi.stubGlobal('fetch', fetchMock);
    const catalog = new TcgdexCatalog();
    const first = catalog.search(1, 'en');
    expect(catalog.search(1, 'en')).toBe(first);
    expect((await first).cards).toHaveLength(1);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('dexId')).toBe('eq:1');
    expect(url.searchParams.get('pagination:itemsPerPage')).toBe('48');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('does not cache failed requests and allows retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal('fetch', fetchMock);
    const catalog = new TcgdexCatalog();
    await expect(catalog.search(1, 'es')).rejects.toThrow();
    expect(await catalog.search(1, 'es')).toMatchObject({ cards: [], hasMore: false });
  });
  it('returns pagination state and excludes wrong-species cards', async () => {
    const logMock = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([{ id: detail.id }]))
      .mockResolvedValueOnce(Response.json({ ...detail, dexId: [25] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new TcgdexCatalog().search(1, 'en')).toEqual({
      cards: [],
      hasMore: false,
      omitted: 1,
    });
    expect(logMock).not.toHaveBeenCalled();
  });

  it('keeps pages bounded and loads at most three details concurrently', async () => {
    let active = 0;
    let maximum = 0;
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/cards'))
        return Response.json(
          Array.from({ length: 48 }, (_, index) => ({ id: `fixture-${index}` })),
        );
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return Response.json({ ...detail, id: url.pathname.split('/').at(-1) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await new TcgdexCatalog().search(1, 'en', 2);
    expect(result.cards).toHaveLength(48);
    expect(result.hasMore).toBe(true);
    expect(maximum).toBeLessThanOrEqual(3);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('pagination:page')).toBe('2');
  });

  it('rejects invalid national numbers and pages without making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const catalog = new TcgdexCatalog();
    await expect(catalog.search(0, 'es')).rejects.toThrow();
    await expect(catalog.search(1, 'en', -1)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('queries the national number but returns only the requested regional form', async () => {
    const normal = { id: 52, nationalId: 52, name: 'Meowth', generation: 1, aliases: ['Meowth'] };
    const galar = {
      id: 110320,
      nationalId: 52,
      name: 'Meowth de Galar',
      generation: 8,
      aliases: ['Galarian Meowth'],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json([{ id: 'normal' }, { id: 'galar' }, { id: 'ambiguous' }]),
      )
      .mockResolvedValueOnce(
        Response.json({ ...detail, id: 'normal', dexId: [52], name: 'Meowth' }),
      )
      .mockResolvedValueOnce(
        Response.json({ ...detail, id: 'galar', dexId: [52], name: 'Galarian Meowth' }),
      )
      .mockResolvedValueOnce(
        Response.json({ ...detail, id: 'ambiguous', dexId: [52], name: 'Unknown Meowth' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const result = await new TcgdexCatalog().searchForm(galar, [normal, galar], 'en');
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('dexId')).toBe('eq:52');
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      speciesId: 110320,
      nationalId: 52,
      name: 'Galarian Meowth',
    });
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0].requiresFormConfirmation).toBe(true);
    expect(result.omitted).toBe(1);
  });
});
