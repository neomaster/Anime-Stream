const altPublic = require('../services/alt-public');

const leaked = altPublic.publicOpenError({
  code: 'INDEX_UNAVAILABLE',
  error: 'HTTP 404 em https://www.1377x.to — Nyaa falhou em nyaa.one',
  triedSources: [
    {
      ref: 'abc',
      provider: 'nya',
      source: 'Nyaa',
      label: '[SubsPlease] Sousou no Frieren',
      seeders: 10,
      leechers: 2,
      ok: false,
      error: 'magnet:?xt=urn:btih:deadbeef',
      code: 'MAGNET_NOT_FOUND',
    },
  ],
});

console.log(JSON.stringify(leaked, null, 2));

const catalog = altPublic.publicCatalog({
  provider: 'nya+x7f',
  items: [
    {
      ref: 'ref1',
      provider: 'nya',
      source: 'Nyaa',
      label: '████ Frieren',
      quality: '1080p',
    },
  ],
});

console.log('catalog', JSON.stringify(catalog, null, 2));