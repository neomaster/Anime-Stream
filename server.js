const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const config = require('./config');
const jikan = require('./services/jikan');
const streaming = require('./services/streaming');
const proxy = require('./services/proxy');
const { mergeByRelevance } = require('./services/matcher');
const cache = require('./services/cache');
const { normalizeSubtitles } = require('./services/subtitles');
const torrentSources = require('./services/torrent-sources');
const torrentStream = require('./services/torrent-stream');
const altPublic = require('./services/alt-public');

const app = express();
const pkg = require('./package.json');
const fs = require('fs');

let buildInfo = { commit: 'dev', version: pkg.version, builtAt: null };
try {
  buildInfo = { ...buildInfo, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')) };
} catch {
  /* local dev */
}

const BLOCKED_CDN_RE = /streampeaker|neko\./i;

if (config.CLOUD_MODE) {
  app.set('trust proxy', 1);
}

app.use(cors());
app.use(express.json());

function resolvePublicHost(req) {
  if (config.PUBLIC_URL) {
    return config.PUBLIC_URL.replace(/^https?:\/\//, '');
  }
  return req.get('host') || `localhost:${config.PORT}`;
}

app.get('/client-config.js', (req, res) => {
  const host = resolvePublicHost(req);
  const cloud = config.CLOUD_MODE || /\.(railway\.app|onrender\.com|fly\.dev)/i.test(host);
  res.type('application/javascript');
  res.send(
    `var BuildConfig=(function(){return{CLOUD_MODE:${cloud},DEFAULT_SERVER:'${host}',DISCOVERY_ENABLED:${cloud ? 'false' : 'true'},CONNECT_RETRIES:${cloud ? 6 : 4},TIMEOUT_MS:${cloud ? 90000 : 25000},PROBE_TIMEOUT_MS:${cloud ? 90000 : 2500}};})();`
  );
});

function getLanIPs() {
  const ips = [];
  for (const [name, iface] of Object.entries(os.networkInterfaces())) {
    if (/nord|vpn|tap|loopback|virtual/i.test(name)) continue;
    for (const addr of iface) {
      if (
        addr.family === 'IPv4' &&
        !addr.internal &&
        !addr.address.startsWith('169.254.')
      ) {
        ips.push(addr.address);
      }
    }
  }
  const unique = [...new Set(ips)];
  const wifi = unique.filter((ip) => ip.startsWith('192.168.') || ip.startsWith('10.'));
  return (wifi.length ? wifi : unique).sort();
}

app.get('/api/health', (req, res) => {
  const ips = getLanIPs();
  const host = resolvePublicHost(req);
  const publicUrl = host.startsWith('http') ? host : `https://${host}`;
  res.json({
    status: 'ok',
    version: pkg.version,
    port: config.PORT,
    cloud: config.CLOUD_MODE,
    host,
    publicUrl: config.CLOUD_MODE || /\.(railway\.app|onrender\.com)/i.test(host) ? publicUrl : null,
    ips,
    addresses: config.CLOUD_MODE
      ? [publicUrl]
      : ips.map((ip) => `${ip}:${config.PORT}`),
    streaming: streaming.mode(),
    build: buildInfo,
    goanime: streaming.goanimeAvailable(),
    altSources: config.ALT_SOURCES_ENABLED,
    altProvider: config.ALT_SOURCES_ENABLED ? altPublic.PUBLIC_PROVIDER : null,
    sources: {
      animefire: config.ANIMEFIRE_BASE,
      nyaa: config.NYAA_BASE,
      nyaaMirrors: config.NYAA_MIRRORS,
      nyaaRss: true,
    },
  });
});

app.get('/api/info', (_req, res) => {
  const ips = getLanIPs();
  res.json({
    name: 'Anime Stream',
    version: pkg.version,
    port: config.PORT,
    ips,
    addresses: ips.map((ip) => `${ip}:${config.PORT}`),
  });
});

app.get('/api/debug/probe', async (_req, res) => {
  const goanime = require('./services/goanime');
  const consumet = require('./services/consumet-stream');
  const out = { cloud: config.CLOUD_MODE, ts: Date.now() };

  async function timed(label, fn) {
    const t0 = Date.now();
    try {
      const value = await fn();
      out[label] = { ok: true, ms: Date.now() - t0, value };
    } catch (err) {
      out[label] = { ok: false, ms: Date.now() - t0, error: err.message };
    }
  }

  await timed('animefireSearch', async () => {
    const r = await goanime.searchAnimeFire('frieren');
    return { count: r.length, base: config.ANIMEFIRE_BASE, sample: r[0]?.name || null };
  });
  await timed('nyaaRss', async () => {
    const nyaa = require('./services/nyaa');
    const rows = await nyaa.searchIndex(['Sousou no Frieren'], 5);
    return { base: nyaa.getBase(), count: rows.length, sample: rows[0]?.name || null };
  });
  await timed('unitySearch', async () => {
    const unityDirect = require('./services/animeunity-direct');
    const r = await unityDirect.search('frieren');
    return r.slice(0, 3).map((x) => x.title);
  });
  await timed('saturnSearch', async () => {
    const r = await consumet.searchAnimeFire('steel ball run');
    return r.map((x) => ({ name: x.name, source: x.source }));
  });
  await timed('saturnDirect', async () => {
    const saturnDirect = require('./services/anime-saturn-direct');
    const r = await saturnDirect.search('steel ball run');
    return r.map((x) => x.title);
  });
  await timed('matchFrieren', async () => {
    const m = await streaming.findBestMatch('Sousou no Frieren', [
      "Frieren: Beyond Journey's End",
    ], { malId: 52991 });
    return m ? { name: m.name, source: m.source, url: String(m.url).slice(0, 80) } : null;
  });
  out.build = buildInfo;
  out.streaming = streaming.mode();
  await timed('matchYoujitsuS4', async () => {
    const m = await streaming.findBestMatch(
      'Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 4th Season: 2-nensei-hen 1 Gakki',
      ['Classroom of the Elite 4th Season: Second Year, First Semester', 'You-jitsu 4th Season'],
      { malId: 59708 }
    );
    if (!m?.url) return null;
    const eps = await streaming.getEpisodes(m.url).catch(() => []);
    return { name: m.name, source: m.source, episodes: eps.length };
  });

  res.json(out);
});

app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Query obrigatória' });

    const queries = streaming.buildSearchQueries([q]);
    const warnings = [];

    const [jikanSettled, fireSettled] = await Promise.allSettled([
      jikan.searchAnimeSafe(q, 25),
      streaming
        .searchAnimeFireMulti(queries)
        .catch(() => streaming.searchAnimeFire(q).catch(() => [])),
    ]);

    const jikanResults =
      jikanSettled.status === 'fulfilled' ? jikanSettled.value : [];
    if (jikanSettled.status === 'rejected' || !jikanResults.length) {
      warnings.push('Catálogo temporariamente indisponível — exibindo fontes alternativas.');
    }

    const fireResults =
      fireSettled.status === 'fulfilled' ? fireSettled.value : [];
    if (fireSettled.status === 'rejected') {
      warnings.push('Fontes de streaming indisponíveis no momento.');
    }

    const results = mergeByRelevance(jikanResults, fireResults, q);

    if (!results.length) {
      return res.status(503).json({
        error: 'Nenhum resultado encontrado. Tente novamente em instantes.',
        jikan: [],
        sources: [],
        results: [],
        warnings,
      });
    }

    res.json({
      jikan: jikanResults,
      sources: fireResults,
      results,
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro na busca' });
  }
});

app.get('/api/top', async (_req, res) => {
  try {
    const cached = cache.get('top-home');
    if (cached) return res.json(cached);

    const [top, season] = await Promise.all([
      jikan.getTopAnimeSafe(12),
      jikan.getSeasonAnimeSafe(),
    ]);

    const data = {
      top,
      season,
      warnings:
        !top.length && !season.length
          ? ['Catálogo MAL indisponível no momento.']
          : undefined,
    };
    if (top.length || season.length) {
      cache.set('top-home', data, 10 * 60 * 1000);
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/anime/:malId/meta', async (req, res) => {
  try {
    const malId = parseInt(req.params.malId, 10);
    const cacheKey = `anime-${malId}`;
    const cachedMeta = cache.get(cacheKey);
    let anime = cachedMeta?.anime;
    if (!anime) {
      anime = await jikan.getAnimeById(malId);
      cache.set(cacheKey, { anime }, 30 * 60 * 1000);
    }
    res.json({ anime });
  } catch (err) {
    res.status(503).json({
      error: 'Informações temporariamente indisponíveis. Tente novamente em instantes.',
      detail: err.message,
    });
  }
});

app.get('/api/anime/:malId', async (req, res) => {
  try {
    const malId = parseInt(req.params.malId, 10);
    const audioPref = req.query.audio === 'dublado' ? 'dublado' : 'legendado';
    const detailKey = `anime-detail:v3:${malId}:${audioPref}`;
    const cachedDetail = cache.get(detailKey);
    if (cachedDetail) return res.json(cachedDetail);

    const cacheKey = `anime-${malId}`;
    const cachedMeta = cache.get(cacheKey);

    let anime = cachedMeta?.anime;
    let sourceMatch = null;
    let altTitles = [];

    try {
      const resolved = await resolveAnimeSource(malId, audioPref);
      anime = resolved.anime;
      sourceMatch = resolved.sourceMatch;
      altTitles = resolved.altTitles;
    } catch (err) {
      return res.status(503).json({
        error: 'Informações temporariamente indisponíveis. Tente novamente em instantes.',
        detail: err.message,
      });
    }

    let episodes = [];
    if (sourceMatch?.url) {
      episodes = await streaming.getEpisodes(sourceMatch.url).catch(() => []);
    }

    // Catálogo magnet por título é carregado sob demanda em /api/alt/episode (evita timeout na nuvem).
    const altCatalog = { items: [], provider: altPublic.PUBLIC_PROVIDER };
    if (config.ALT_SOURCES_ENABLED && sourceMatch?.url) {
      const catalogKey = `alt:prefetch:${malId}`;
      torrentSources
        .catalogForTitles([anime.title, ...altTitles], { limit: 6 })
        .then((catalog) => cache.set(catalogKey, catalog, 10 * 60 * 1000))
        .catch(() => null);
    }

    const payload = {
      anime,
      source: sourceMatch,
      episodes,
      altCatalog: altPublic.publicCatalog(altCatalog),
      streaming: streaming.mode(),
      goanime: {
        available: streaming.goanimeAvailable(),
        path: config.CLOUD_MODE ? 'cloud' : config.GOANIME_PATH,
      },
    };
    cache.set(cacheKey, { anime }, 30 * 60 * 1000);
    if (episodes.length) {
      cache.set(detailKey, payload, 20 * 60 * 1000);
    }
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function resolveAnimeSource(malId, audioPref) {
  const cacheKey = `source-match:v3:${malId}:${audioPref}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const anime = await jikan.getAnimeById(malId);
  const altTitles = [
    anime.title_english,
    anime.title_japanese,
    ...(anime.synonyms || []),
  ].filter(Boolean);

  const sourceMatch = await streaming.findBestMatch(anime.title, altTitles, {
    audioPref,
    malId: anime.mal_id,
    expectedEpisodes: anime.episodes,
    status: anime.status,
  });

  const payload = { anime, sourceMatch, altTitles };
  if (sourceMatch?.url) {
    cache.set(cacheKey, payload, 60 * 60 * 1000);
  }
  return payload;
}

app.get('/api/anime/:malId/episodes', async (req, res) => {
  try {
    const malId = parseInt(req.params.malId, 10);
    const audioPref = req.query.audio === 'dublado' ? 'dublado' : 'legendado';
    const episodesKey = `episodes:v3:${malId}:${audioPref}`;
    const cachedEpisodes = cache.get(episodesKey);
    if (cachedEpisodes) return res.json(cachedEpisodes);

    const { sourceMatch } = await resolveAnimeSource(malId, audioPref);

    if (!sourceMatch?.url) {
      return res.json({
        source: null,
        episodes: [],
        audioPref,
        found: false,
        message: 'Anime não encontrado nas fontes de streaming',
      });
    }

    const episodes = await streaming.getEpisodes(sourceMatch.url);
    const payload = { source: sourceMatch, episodes, audioPref, found: true };
    if (episodes.length) cache.set(episodesKey, payload, 45 * 60 * 1000);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildVideoProxyUrl(req, videoUrl, referer) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('host');
  let out = `${proto}://${host}/api/proxy/video?url=${encodeURIComponent(videoUrl)}`;
  if (referer) out += `&referer=${encodeURIComponent(referer)}`;
  return out;
}

async function resolveEpisodeStream(req, episodeUrl, audioPref, episodeNumber) {
  const opts = { audioPref, episodeNumber };
  let stream = await streaming.getEpisodeStream(episodeUrl, opts);

  const needsFallback =
    config.CLOUD_MODE &&
    BLOCKED_CDN_RE.test(stream.videoUrl || '') &&
    parseInt(req.query.mal, 10) > 0 &&
    episodeNumber > 0;

  if (!needsFallback) return stream;

  const malId = parseInt(req.query.mal, 10);
  cache.del(`source-match:v3:${malId}:${audioPref}`);
  cache.del(`episodes:v3:${malId}:${audioPref}`);

  const { sourceMatch } = await resolveAnimeSource(malId, audioPref);
  if (!sourceMatch?.url || sourceMatch.source === 'animesaturn') return stream;

  const episodes = await streaming.getEpisodes(sourceMatch.url);
  const ep = episodes.find((e) => e.number === episodeNumber);
  if (!ep?.url) return stream;

  console.warn('[stream-fallback] Saturn CDN bloqueado, usando', sourceMatch.source);
  return streaming.getEpisodeStream(ep.url, opts);
}

app.get('/api/stream', async (req, res) => {
  try {
    const episodeUrl = req.query.url;
    if (!episodeUrl) return res.status(400).json({ error: 'URL do episódio obrigatória' });

    const audioPref = req.query.audio === 'dublado' ? 'dublado' : 'legendado';
    const episodeNumber = parseInt(req.query.ep, 10) || null;
    const stream = await resolveEpisodeStream(req, episodeUrl, audioPref, episodeNumber);
    const referer = stream.streamReferer || null;

    stream.videoProxy = buildVideoProxyUrl(req, stream.videoUrl, referer);
    stream.subtitles = normalizeSubtitles(stream.subtitles || []).map((sub) => ({
      ...sub,
      proxyUrl: `/api/proxy/subtitle?url=${encodeURIComponent(sub.url)}${
        referer ? `&referer=${encodeURIComponent(referer)}` : ''
      }`,
    }));
    stream.qualities = (stream.qualities || []).map((q) => ({
      ...q,
      proxyUrl: buildVideoProxyUrl(req, q.url, referer),
    }));

    res.json(stream);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/proxy/video', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'URL obrigatória' });
    await proxy.proxyStream(url, req, res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get('/api/proxy/subtitle', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'URL obrigatória' });
    await proxy.proxyText(url, res, req.query.referer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/source', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'URL obrigatória' });
    const data = await streaming.getAnimeFromSource(url);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sources/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Query obrigatória' });
    const results = await streaming.searchAnimeFire(q);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/alt/catalog', async (req, res) => {
  try {
    if (!config.ALT_SOURCES_ENABLED) {
      return res.status(404).json({ error: 'Fontes alternativas desativadas' });
    }
    const q = (req.query.q || '').trim();
    const malId = parseInt(req.query.malId, 10);

    let titles = q ? [q] : [];
    if (malId) {
      const anime = await jikan.getAnimeById(malId);
      titles = [anime.title, anime.title_english, ...(anime.synonyms || [])].filter(Boolean);
    }
    if (!titles.length) return res.status(400).json({ error: 'Informe q ou malId' });

    const catalog = await torrentSources.catalogForTitles(titles, {
      limit: parseInt(req.query.limit, 10) || 12,
    });
    res.json(altPublic.publicCatalog(catalog));
  } catch (err) {
    res.status(500).json({ error: 'Falha ao consultar catálogo ofuscado' });
  }
});

app.post('/api/alt/reserve', async (req, res) => {
  try {
    if (!config.ALT_SOURCES_ENABLED) {
      return res.status(404).json({ error: 'Fontes alternativas desativadas' });
    }
    const ref = (req.body?.ref || '').trim();
    if (!ref || !/^[a-f0-9]{36}$/i.test(ref)) {
      return res.status(400).json({ error: 'Ref inválida' });
    }

    const clientHint = String(req.headers['x-client-id'] || req.ip || '').slice(0, 64);
    const result = await torrentSources.reserveRef(ref, clientHint);
    if (!result.ok) return res.status(404).json({ error: result.error });

    res.json(altPublic.publicReserve(result));
  } catch (err) {
    res.status(500).json({ error: 'Falha ao reservar fonte' });
  }
});

app.get('/api/alt/episode', async (req, res) => {
  try {
    if (!config.ALT_SOURCES_ENABLED) {
      return res.status(404).json({ error: 'Magnets desativados' });
    }
    const malId = parseInt(req.query.malId, 10);
    const episode = parseInt(req.query.ep, 10);
    if (!malId || !episode) {
      return res.status(400).json({ error: 'Informe malId e ep' });
    }

    const anime = await jikan.getAnimeById(malId);
    const titles = [anime.title, anime.title_english, ...(anime.synonyms || [])].filter(Boolean);
    const catalog = await torrentSources.catalogForEpisode(titles, episode, {
      limit: parseInt(req.query.limit, 10) || 6,
    });
    res.json(altPublic.publicCatalog(catalog));
  } catch (err) {
    res.status(500).json({ error: 'Falha ao buscar magnets do episódio' });
  }
});

function altErrorStatus(code) {
  switch (code) {
    case 'INDEX_UNAVAILABLE':
      return 503;
    case 'NOT_FOUND':
    case 'MAGNET_NOT_FOUND':
      return 404;
    case 'REF_EXPIRED':
      return 410;
    case 'MAGNET_RESOLVE_FAILED':
    case 'MAGNET_INVALID':
    case 'INVALID_HREF':
    case 'TORRENT_ERROR':
    case 'NO_VIDEO_FILE':
    case 'UNSUPPORTED_FORMAT':
    case 'STREAM_START_FAILED':
      return 502;
    case 'SESSION_NOT_FOUND':
    case 'NOT_READY':
      return 404;
    case 'TORRENT_TIMEOUT':
      return 504;
    default:
      return 502;
  }
}

async function resolveMagnetPlayback(reqBody) {
  const ref = (reqBody?.ref || '').trim();
  const malId = parseInt(reqBody?.malId, 10);
  const episode = parseInt(reqBody?.episode, 10);

  if (ref && /^[a-f0-9]{36}$/i.test(ref)) {
    return torrentSources.openForRef(ref);
  }

  if (malId && episode) {
    let anime;
    try {
      anime = await jikan.getAnimeById(malId);
    } catch (err) {
      const e = new Error('Metadados do anime indisponíveis. Tente novamente.');
      e.code = 'MAL_UNAVAILABLE';
      throw e;
    }
    const titles = [anime.title, anime.title_english, ...(anime.synonyms || [])].filter(Boolean);
    return torrentSources.openForEpisode(titles, episode);
  }

  const e = new Error('Informe ref ou malId + episode');
  e.code = 'BAD_REQUEST';
  throw e;
}

app.get('/api/alt/stream/:sessionId/status', (req, res) => {
  const session = torrentStream.getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Sessão não encontrada', code: 'SESSION_NOT_FOUND' });
  }
  res.json(torrentStream.sessionStatus(session));
});

app.get('/api/alt/stream/:sessionId', async (req, res) => {
  try {
    let session = torrentStream.getSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Sessão não encontrada', code: 'SESSION_NOT_FOUND' });
    }

    if (!session.file) {
      try {
        session = await torrentStream.waitUntilReady(req.params.sessionId, 30000);
      } catch (err) {
        return res.status(altErrorStatus(err.code)).json(
          altPublic.publicOpenError({
            code: err.code || 'NOT_READY',
            error: err.message,
          })
        );
      }
    }

    torrentStream.pipeFileToResponse(session, req, res);
  } catch (err) {
    console.error('[alt/stream]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Falha no streaming do torrent', code: 'STREAM_ERROR' });
    }
  }
});

app.post('/api/alt/open', async (req, res) => {
  try {
    if (!config.ALT_SOURCES_ENABLED) {
      return res.status(404).json({ error: 'Magnets desativados', code: 'ALT_DISABLED' });
    }

    const result = await resolveMagnetPlayback(req.body);
    if (!result.ok) {
      return res.status(altErrorStatus(result.code)).json(altPublic.publicOpenError(result));
    }

    let streamSession;
    try {
      streamSession = torrentStream.startSession(result.magnet);
    } catch (err) {
      console.error('[alt/open stream]', err.message);
      return res.status(altErrorStatus(err.code)).json(
        altPublic.publicOpenError({
          code: err.code || 'STREAM_START_FAILED',
          error: err.message,
        })
      );
    }

    return res.json(altPublic.publicOpenSuccess(result, streamSession));
  } catch (err) {
    if (err.code === 'BAD_REQUEST') {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    if (err.code === 'MAL_UNAVAILABLE') {
      return res.status(503).json({ error: err.message, code: err.code });
    }
    console.error('[alt/open]', err.message);
    res.status(500).json(
      altPublic.publicOpenError({
        code: err.code || 'INTERNAL_ERROR',
        error: config.CLOUD_MODE ? 'Falha ao abrir fonte alternativa' : err.message,
      })
    );
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(config.PORT, '0.0.0.0', () => {
  const localIPs = getLanIPs();
  console.log(`\n  Anime Stream v${pkg.version}`);
  if (config.CLOUD_MODE) {
    console.log(`  Nuvem:     porta ${config.PORT} (CLOUD_MODE)`);
  } else {
    console.log(`  PC:        http://localhost:${config.PORT}`);
    for (const ip of localIPs) {
      console.log(`  TV/Rede:   http://${ip}:${config.PORT}`);
    }
  }
  console.log(`  Streaming: ${streaming.mode()}`);
  console.log(`  GoAnime:   ${streaming.goanimeAvailable() ? 'ok' : 'off'}`);
  console.log(`  AnimeFire: ${config.ANIMEFIRE_BASE}`);
  console.log(
    `  Alt fonts: ${config.ALT_SOURCES_ENABLED ? altPublic.PUBLIC_PROVIDER : 'off'}${config.NYAA_ENABLED ? ' (nyaa on)' : ''}`
  );
  console.log('');
});