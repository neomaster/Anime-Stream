import { createPlayer } from './player.js';
import * as Subtitles from './subtitles.js';
import {
  showEpisodePicker,
  openEpisodeMagnet,
  playMagnetStream,
  fetchEpisodeMagnetCatalog,
  formatSeederLabel,
} from './alt-sources.js';
import { safeGetJson, safeSetJson, getStorageMode } from './storage-safe.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const EP_PAGE = 60;
const WATCH_KEY = 'anime_stream_watch';
const FAV_KEY = 'anime_stream_favs';

const state = {
  currentAnime: null,
  animeKey: '',
  malId: null,
  sourceUrl: null,
  episodes: [],
  episodePage: 0,
  currentEpisodeIndex: -1,
  hls: null,
  searchTimeout: null,
  currentStream: null,
  altSourcesEnabled: false,
};

const videoPlayer = createPlayer();
const player = videoPlayer.el;

const sections = {
  hero: $('#heroSection'),
  home: $('#homeSection'),
  search: $('#searchSection'),
  detail: $('#detailSection'),
};

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.hidden = true; }, 4000);
}

async function api(path, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 90000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { signal: controller.signal });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Erro ${res.status}`);
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('O servidor demorou para responder. Tente novamente em instantes.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function getWatchStore() {
  return safeGetJson(WATCH_KEY, {});
}

function saveWatch(entry) {
  const store = getWatchStore();
  store[entry.key] = { ...entry, at: Date.now() };
  safeSetJson(WATCH_KEY, store);
}

function getFavs() {
  return safeGetJson(FAV_KEY, []);
}

function toggleFav(item) {
  let favs = getFavs();
  const idx = favs.findIndex((f) => f.key === item.key);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.unshift({ ...item, at: Date.now() });
  if (favs.length > 20) favs = favs.slice(0, 20);
  safeSetJson(FAV_KEY, favs);
  updateFavBtn();
  renderContinueSection();
}

function isFav(key) {
  return getFavs().some((f) => f.key === key);
}

function showSection(name) {
  if (name === 'home') {
    sections.hero.hidden = false;
    sections.home.hidden = false;
    sections.search.hidden = true;
    sections.detail.hidden = true;
  } else if (name === 'search') {
    sections.hero.hidden = true;
    sections.home.hidden = true;
    sections.search.hidden = false;
    sections.detail.hidden = true;
  } else if (name === 'detail') {
    sections.hero.hidden = true;
    sections.home.hidden = true;
    sections.search.hidden = true;
    sections.detail.hidden = false;
  }
}

function createAnimeCard(anime, onClick) {
  const card = document.createElement('article');
  const isSource = anime.source === 'animefire' || anime.sourceUrl;
  card.className = `anime-card${isSource ? ' source-only' : ''}`;
  const poster = anime.poster || anime.poster_small || '';
  card.innerHTML = `
    <div class="anime-card-poster">
      <img src="${escapeHtml(poster)}" alt="" loading="lazy" onerror="this.style.display='none'" />
      ${anime.score ? `<span class="anime-card-score">★ ${escapeHtml(anime.score)}</span>` : ''}
      ${anime.ep ? `<span class="anime-card-ep">Ep. ${escapeHtml(anime.ep)}</span>` : ''}
      ${isSource ? '<span class="anime-card-badge">Catálogo</span>' : ''}
    </div>
    <p class="anime-card-title">${escapeHtml(anime.title)}</p>
  `;
  card.addEventListener('click', onClick || (() => {
    if (isSource && anime.sourceUrl) openSourceAnime(anime.sourceUrl);
    else if (anime.mal_id) openAnime(anime.mal_id);
    else if (anime.key && anime.malId) openAnime(anime.malId);
    else if (anime.key && anime.sourceUrl) openSourceAnime(anime.sourceUrl);
  }));
  return card;
}

function renderGrid(container, animes) {
  container.innerHTML = '';
  if (!animes.length) {
    container.innerHTML = '<p class="empty-msg">Nenhum resultado.</p>';
    return;
  }
  animes.forEach((a) => container.appendChild(createAnimeCard(a)));
}

function renderSkeleton(container, n = 6) {
  container.innerHTML = Array.from({ length: n }, () =>
    '<div class="skeleton-card"><div class="skeleton-poster"></div><div class="skeleton-line"></div></div>'
  ).join('');
}

function renderContinueSection() {
  const store = getWatchStore();
  const favs = getFavs();
  const items = [...Object.values(store), ...favs.filter((f) => !store[f.key])]
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 12);

  const sec = $('#continueSection');
  const grid = $('#continueGrid');
  if (!items.length) {
    sec.hidden = true;
    return;
  }
  sec.hidden = false;
  renderGrid(grid, items.map((it) => ({
    title: it.title,
    poster: it.poster,
    mal_id: it.malId,
    sourceUrl: it.sourceUrl,
    key: it.key,
    ep: it.ep,
  })));
}

async function loadHome() {
  renderSkeleton($('#topGrid'));
  renderSkeleton($('#seasonGrid'));
  renderContinueSection();
  try {
    const { top, season } = await api('/api/top');
    renderGrid($('#topGrid'), top);
    renderGrid($('#seasonGrid'), season);
  } catch (err) {
    showToast('Erro ao carregar catálogo', true);
  }
}

async function searchAnime(query) {
  if (!query.trim()) return;
  showSection('search');
  const grid = $('#searchGrid');
  renderSkeleton(grid, 8);
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    const results = data.results || data.jikan || [];
    if (data.warnings?.length) showToast(data.warnings[0], true);
    $('#resultCount').textContent = `${results.length} resultados`;
    if (!results.length) {
      grid.innerHTML = '<p class="empty-msg">Nenhum resultado. A API MAL pode estar sobrecarregada — tente de novo.</p>';
      return;
    }
    renderGrid(grid, results);
  } catch (err) {
    grid.innerHTML = `<p class="empty-msg error">${escapeHtml(err.message)}</p>`;
  }
}

function setAnimeKey(malId, sourceUrl, title, poster) {
  state.malId = malId || null;
  state.sourceUrl = sourceUrl || null;
  state.animeKey = malId ? `mal:${malId}` : sourceUrl ? `src:${sourceUrl}` : '';
  state._meta = { title, poster, key: state.animeKey, malId, sourceUrl };
  updateFavBtn();
  updateContinueBtn();
}

function updateFavBtn() {
  const btn = $('#favBtn');
  if (!btn || !state.animeKey) return;
  btn.hidden = false;
  const fav = isFav(state.animeKey);
  btn.textContent = fav ? '★' : '☆';
  btn.classList.toggle('active', fav);
  btn.onclick = () => toggleFav({ ...state._meta, key: state.animeKey });
}

function updateContinueBtn() {
  const btn = $('#continueBtn');
  const progress = getWatchStore()[state.animeKey];
  if (!btn || !progress) { if (btn) btn.hidden = true; return; }
  btn.hidden = false;
  btn.textContent = `Continuar do ep. ${progress.ep}`;
  btn.onclick = () => resumeEpisode(progress);
}

function resumeEpisode(progress) {
  const idx = progress.index >= 0 ? progress.index : state.episodes.findIndex(
    (e) => String(e.number) === String(progress.ep)
  );
  if (idx >= 0) {
    state.episodePage = Math.floor(idx / EP_PAGE);
    renderEpisodes();
    playEpisode(state.episodes[idx], $(`[data-ep-index="${idx}"]`), idx);
  }
}

function renderDetailCommon({ title, synopsis, poster, source, episodes }) {
  $('#detailTitle').textContent = title;
  $('#detailSynopsis').textContent = synopsis || 'Sinopse não disponível.';
  $('#detailPoster').src = poster || '';
  $('#detailPoster').alt = title;
  $('#detailBackdrop').style.backgroundImage = poster ? `url(${poster})` : '';

  const badge = $('#sourceBadge');
  if (source) {
    badge.innerHTML = `▶ ${escapeHtml(source.name)}`;
  } else {
    badge.textContent = '⚠ Não encontrado nas fontes de streaming';
  }

  state.episodes = episodes || [];
  state.episodePage = 0;
  state.currentEpisodeIndex = -1;
  $('#epFilter').value = '';
  renderEpisodes();
  updateContinueBtn();
}

function renderAnimeMeta(anime) {
  $('#detailMeta').innerHTML = `
    ${anime.score ? `<span>★ ${anime.score}</span>` : ''}
    ${anime.type ? `<span>${anime.type}</span>` : ''}
    ${anime.episodes ? `<span>${anime.episodes} eps</span>` : ''}
    ${anime.status ? `<span>${anime.status}</span>` : ''}
    <div>${(anime.genres || []).map((g) => `<span class="tag">${escapeHtml(g)}</span>`).join('')}</div>
  `;
}

async function openAnime(malId) {
  showSection('detail');
  window.scrollTo(0, 0);
  $('#playerSection').hidden = true;
  history.replaceState(null, '', `?anime=${malId}`);

  $('#detailTitle').textContent = 'Carregando...';
  $('#detailSynopsis').textContent = 'Buscando informações do anime…';
  $('#sourceBadge').textContent = '⏳ Consultando fontes…';
  $('#episodesGrid').innerHTML = '<p class="ep-empty">Carregando episódios…</p>';

  const audio = encodeURIComponent(Subtitles.getAudioPref());
  const streamPath = `/api/anime/${malId}/episodes?audio=${audio}`;

  try {
    const streamPromise = api(streamPath, { timeoutMs: 90000 }).catch((err) => ({ error: err }));

    const meta = await api(`/api/anime/${malId}/meta`, { timeoutMs: 20000 });
    const anime = meta.anime;
    state.currentAnime = anime;
    setAnimeKey(malId, null, anime.title, anime.poster);
    renderAnimeMeta(anime);
    renderDetailCommon({
      title: anime.title,
      synopsis: anime.synopsis,
      poster: anime.poster,
      source: null,
      episodes: [],
    });
    $('#detailSynopsis').textContent = 'Buscando episódios nas fontes de streaming…';

    const stream = await streamPromise;
    if (stream?.error) throw stream.error;

    if (!stream?.found && !stream?.source) {
      $('#sourceBadge').textContent = '⚠ Não encontrado nas fontes de streaming';
      $('#episodesGrid').innerHTML =
        '<p class="ep-empty">Nenhum episódio encontrado nas fontes disponíveis.</p>';
      return;
    }

    renderDetailCommon({
      title: anime.title,
      synopsis: anime.synopsis,
      poster: anime.poster,
      source: stream.source,
      episodes: stream.episodes,
    });
  } catch (err) {
    if (state.currentAnime) {
      $('#sourceBadge').textContent = '⚠ Não encontrado nas fontes de streaming';
      $('#episodesGrid').innerHTML = '<p class="ep-empty">Nenhum episódio encontrado nas fontes disponíveis.</p>';
      showToast(err.message || 'Episódios indisponíveis no momento.', true);
      return;
    }
    $('#detailTitle').textContent = 'Erro';
    $('#detailSynopsis').textContent = err.message;
    showToast(err.message, true);
  }
}

async function openSourceAnime(sourceUrl) {
  showSection('detail');
  window.scrollTo(0, 0);
  $('#playerSection').hidden = true;

  try {
    const data = await api(`/api/source?url=${encodeURIComponent(sourceUrl)}`);
    state.currentAnime = data;
    setAnimeKey(null, sourceUrl, data.title, data.poster);
    $('#detailMeta').innerHTML = '<span>Catálogo AnimeFire</span>';
    renderDetailCommon({
      title: data.title,
      synopsis: data.synopsis,
      poster: data.poster,
      source: data.source,
      episodes: data.episodes,
    });
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderEpisodes() {
  const grid = $('#episodesGrid');
  const filter = ($('#epFilter').value || '').trim();
  grid.innerHTML = '';

  if (!state.episodes.length) {
    $('#episodesEmpty').hidden = false;
    $('#episodePagination').hidden = true;
    return;
  }
  $('#episodesEmpty').hidden = true;

  let list = state.episodes.map((ep, i) => ({ ep, i }));
  if (filter) {
    list = list.filter(({ ep }) => String(ep.number).includes(filter));
  }

  const totalPages = Math.max(1, Math.ceil(list.length / EP_PAGE));
  if (state.episodePage >= totalPages) state.episodePage = totalPages - 1;

  const start = state.episodePage * EP_PAGE;
  const slice = list.slice(start, start + EP_PAGE);

  slice.forEach(({ ep, i }) => {
    const btn = document.createElement('button');
    btn.className = 'episode-btn' + (i === state.currentEpisodeIndex ? ' active' : '');
    btn.textContent = ep.number;
    btn.title = ep.label;
    btn.dataset.epIndex = i;
    btn.addEventListener('click', () => onEpisodeClick(ep, btn, i));
    grid.appendChild(btn);
  });

  const pag = $('#episodePagination');
  if (filter || totalPages <= 1) {
    pag.hidden = true;
  } else {
    pag.hidden = false;
    $('#epPageLabel').textContent = `${state.episodePage + 1} / ${totalPages}`;
    $('#epPrevBtn').disabled = state.episodePage <= 0;
    $('#epNextBtn').disabled = state.episodePage >= totalPages - 1;
  }
}

function setupSubtitles(stream) {
  Subtitles.setup(player, stream, $('#subtitleSelect'), $('#subtitleControls'));
}

function setupQuality(stream) {
  const qualityControls = $('#qualityControls');
  const qualitySelect = $('#qualitySelect');
  qualityControls.hidden = true;
  state.currentStream = stream;
  if (!stream.qualities?.length || stream.qualities.length < 2) return;

  qualityControls.hidden = false;
  qualitySelect.innerHTML = '';
  stream.qualities.forEach((q, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = q.label || `Opção ${i + 1}`;
    if (q.label === stream.quality) opt.selected = true;
    qualitySelect.appendChild(opt);
  });
  qualitySelect.onchange = () => {
    const q = stream.qualities[parseInt(qualitySelect.value, 10)];
    if (!q) return;
    videoPlayer.showLoading('Trocando qualidade...');
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    const time = player.currentTime;
    player.src = `/api/proxy/video?url=${encodeURIComponent(q.url)}`;
    player.addEventListener('loadeddata', () => {
      player.currentTime = time;
      player.play().catch(() => {});
    }, { once: true });
  };
}

function playNextEpisode() {
  const next = state.currentEpisodeIndex + 1;
  if (next >= state.episodes.length) {
    showToast('Último episódio');
    return;
  }
  if (next >= (state.episodePage + 1) * EP_PAGE) {
    state.episodePage++;
    renderEpisodes();
  }
  playEpisode(state.episodes[next], $(`[data-ep-index="${next}"]`), next);
}

function onEpisodeClick(episode, btn, idx) {
  if (!state.altSourcesEnabled || !state.malId) {
    playEpisode(episode, btn, idx);
    return;
  }

  showEpisodePicker({
    episode,
    malId: state.malId,
    onStream: () => playEpisode(episode, btn, idx),
    onMagnet: (opts) => playMagnetEpisode(episode, btn, idx, opts),
    onError: (err) => showToast(formatMagnetError(err), true),
  });
}

function formatPeers(seeders, leechers) {
  const s = seeders != null && seeders !== '' ? Number(seeders) : null;
  const l = leechers != null && leechers !== '' ? Number(leechers) : null;
  if ((s == null || Number.isNaN(s)) && (l == null || Number.isNaN(l))) return '';
  const parts = [];
  if (s != null && !Number.isNaN(s)) parts.push(`${s} seeder${s === 1 ? '' : 's'}`);
  if (l != null && !Number.isNaN(l)) parts.push(`${l} leecher${l === 1 ? '' : 's'}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function formatTriedSources(triedSources) {
  if (!Array.isArray(triedSources) || !triedSources.length) return '';
  const lines = triedSources.slice(0, 4).map((t) => {
    const peers = formatPeers(t.seeders, t.leechers);
    const name = t.label || 'fonte ofuscada';
    if (t.ok) return `${name}${peers}`;
    return `${name}${peers}: ${t.code || 'falhou'}`;
  });
  return ` Fontes tentadas: ${lines.join('; ')}.`;
}

function formatMagnetError(err) {
  if (!err) return 'Erro ao abrir magnet';

  const peers = formatPeers(err.seeders, err.leechers);
  const tried = formatTriedSources(err.triedSources);

  if (err.code === 'INDEX_UNAVAILABLE' || err.status === 503) {
    return `Índices alternativos indisponíveis no momento.${tried} Tente novamente em instantes ou use Assistir online.`;
  }
  if (err.code === 'NOT_FOUND' || err.status === 404) {
    const ep = err.episode ? ` (ep. ${err.episode})` : '';
    return (
      err.message ||
      `Nenhum torrent encontrado para este episódio${ep}.${tried} Tente outro episódio ou use Assistir online.`
    );
  }
  if (err.code === 'TORRENT_TIMEOUT' || err.status === 504) {
    return `Torrent demorou para responder${peers}.${tried} Tente novamente ou use Assistir online.`;
  }
  if (err.code === 'MAGNET_RESOLVE_FAILED' || err.code === 'MAGNET_NOT_FOUND' || err.code === 'MAGNET_INVALID') {
    return `Não foi possível obter o magnet${peers}.${tried} Tente outra fonte ou Assistir online.`;
  }
  if (err.code === 'REF_EXPIRED') {
    return `Fonte expirada${peers}. Abra o episódio novamente.`;
  }
  if (err.code === 'UNSUPPORTED_FORMAT' || err.code === 'NO_VIDEO_FILE') {
    return `${err.message || 'Este torrent não tem vídeo compatível com o player.'}${peers}.`;
  }
  if (err.code === 'STREAM_START_FAILED' || err.code === 'TORRENT_ERROR') {
    return `${err.message || 'Falha ao iniciar o streaming'}${peers}.${tried}`;
  }
  if (err.message && peers) return `${err.message}${peers}.${tried}`;
  return err.message || `Falha no streaming magnet${peers}.${tried}`;
}

function pushMagnetProgress(onMagnetProgress, seeders, leechers, phase) {
  if (!onMagnetProgress) return;
  const buttonLabel = formatSeederLabel(seeders, leechers, phase);
  const statusLabel =
    seeders != null && !Number.isNaN(Number(seeders))
      ? `${seeders} seeders disponíveis`
      : phase === 'scan'
        ? 'Buscando melhor fonte…'
        : 'Preparando streaming…';
  onMagnetProgress({ buttonLabel, statusLabel });
}

async function playMagnetEpisode(episode, btn, idx, { onMagnetProgress, onPickerClose } = {}) {
  pushMagnetProgress(onMagnetProgress, null, null, 'scan');

  let previewSeeders = null;
  let previewLeechers = null;

  try {
    const catalog = await fetchEpisodeMagnetCatalog(state.malId, episode.number);
    const best = catalog?.items?.[0];
    if (best) {
      previewSeeders = best.seeders ?? null;
      previewLeechers = best.leechers ?? null;
      pushMagnetProgress(onMagnetProgress, previewSeeders, previewLeechers, 'scan');
    }
  } catch {
    /* segue para /api/alt/open */
  }

  pushMagnetProgress(onMagnetProgress, previewSeeders, previewLeechers, 'resolve');

  const result = await openEpisodeMagnet(state.malId, episode.number);
  const seeders = result.seeders ?? previewSeeders;
  const leechers = result.leechers ?? previewLeechers;

  pushMagnetProgress(onMagnetProgress, seeders, leechers, 'connect');
  onPickerClose?.();

  $$('.episode-btn').forEach((b) => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  state.currentEpisodeIndex = idx;
  saveWatch({
    key: state.animeKey,
    title: state._meta?.title,
    poster: state._meta?.poster,
    malId: state.malId,
    sourceUrl: state.sourceUrl,
    ep: episode.number,
    index: idx,
  });
  renderContinueSection();

  const playerSection = $('#playerSection');
  playerSection.hidden = false;
  videoPlayer.reset();
  videoPlayer.showLoading(
    seeders != null ? formatSeederLabel(seeders, leechers, 'connect') : 'Conectando ao torrent…'
  );
  videoPlayer.setEpisodeLabel(
    seeders != null
      ? `Episódio ${episode.number} · Magnet · ${seeders} seeders`
      : `Episódio ${episode.number} · Magnet`
  );

  if (state.hls) {
    state.hls.destroy();
    state.hls = null;
  }
  player.pause();
  player.removeAttribute('src');
  player.querySelectorAll('track').forEach((t) => t.remove());

  try {
    await playMagnetStream({
      streamUrl: result.streamUrl,
      statusUrl: result.statusUrl,
      videoEl: player,
      onProgress: (pct, peers, status) => {
        const seederLabel = seeders != null ? ` · ${seeders} seeders` : '';
        const peerLabel = peers > 0 ? ` · ${peers} peer(s)` : '';
        videoPlayer.showLoading(`Torrent ${status || 'carregando'}… ${pct}%${seederLabel}${peerLabel}`);
      },
      onReady: () => videoPlayer.hideLoading(),
      onError: (err) => showToast(err.message, true),
    });

    if (result.quality || result.seeders != null || result.leechers != null) {
      const peers = formatPeers(result.seeders, result.leechers);
      showToast(
        `Streaming magnet${peers} · ${result.quality || 'SD'}${result.label ? ` · ${result.label}` : ''}`
      );
    }

    playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    videoPlayer.hideLoading();
    throw err;
  }
}

async function playEpisode(episode, btn, idx) {
  $$('.episode-btn').forEach((b) => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  state.currentEpisodeIndex = idx;
  saveWatch({
    key: state.animeKey,
    title: state._meta?.title,
    poster: state._meta?.poster,
    malId: state.malId,
    sourceUrl: state.sourceUrl,
    ep: episode.number,
    index: idx,
  });
  renderContinueSection();

  const playerSection = $('#playerSection');
  playerSection.hidden = false;
  videoPlayer.reset();
  videoPlayer.showLoading();
  videoPlayer.setEpisodeLabel(`Episódio ${episode.number}`);

  if (state.hls) { state.hls.destroy(); state.hls = null; }
  player.pause();
  player.removeAttribute('src');
  player.querySelectorAll('track').forEach((t) => t.remove());

  try {
    const stream = await api(
      `/api/stream?url=${encodeURIComponent(episode.url)}&audio=${encodeURIComponent(Subtitles.getAudioPref())}`
    );
    const src = stream.videoProxy;

    if (stream.type === 'hls' && window.Hls && Hls.isSupported()) {
      state.hls = new Hls();
      state.hls.loadSource(src);
      state.hls.attachMedia(player);
      state.hls.on(Hls.Events.MANIFEST_PARSED, () => player.play().catch(() => {}));
    } else {
      player.src = src;
      player.play().catch(() => {});
    }

    setupSubtitles(stream);
    setupQuality(stream);
    playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    videoPlayer.hideLoading();
    showToast(`Erro: ${err.message}`, true);
  }
}

function setupSearch() {
  const form = $('#searchForm');
  const input = $('#searchInput');
  const suggestions = $('#searchSuggestions');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    suggestions.hidden = true;
    searchAnime(input.value);
  });

  input.addEventListener('input', () => {
    clearTimeout(state.searchTimeout);
    const q = input.value.trim();
    if (q.length < 2) { suggestions.hidden = true; return; }

    state.searchTimeout = setTimeout(async () => {
      try {
        const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
        const results = (data.results || data.jikan).slice(0, 8);
        suggestions.innerHTML = '';
        results.forEach((a) => {
          const item = document.createElement('div');
          item.className = 'suggestion-item';
          item.innerHTML = `
            <img src="${escapeHtml(a.poster_small || a.poster || '')}" alt="" onerror="this.style.display='none'" />
            <span>${escapeHtml(a.title)}</span>
          `;
          item.addEventListener('click', () => {
            input.value = a.title;
            suggestions.hidden = true;
            if (a.sourceUrl) openSourceAnime(a.sourceUrl);
            else openAnime(a.mal_id);
          });
          suggestions.appendChild(item);
        });
        suggestions.hidden = results.length === 0;
      } catch {
        suggestions.hidden = true;
      }
    }, 350);
  });

  document.addEventListener('click', (e) => {
    if (!form.contains(e.target)) suggestions.hidden = true;
  });
}

async function checkHealth() {
  try {
    const health = await api('/api/health');
    state.altSourcesEnabled = !!health.altSources;
    const status = $('#goanimeStatus');
    status.classList.toggle('online', health.status === 'ok');
    status.title = health.altSources
      ? `Servidor online · streaming + magnet · v${health.version}`
      : `Servidor online · v${health.version}`;
  } catch { /* ignore */ }
}

$('#epFilter')?.addEventListener('input', () => {
  state.episodePage = 0;
  renderEpisodes();
});

$('#epPrevBtn')?.addEventListener('click', () => {
  if (state.episodePage > 0) { state.episodePage--; renderEpisodes(); }
});

$('#epNextBtn')?.addEventListener('click', () => {
  const max = Math.ceil(state.episodes.length / EP_PAGE) - 1;
  if (state.episodePage < max) { state.episodePage++; renderEpisodes(); }
});

$$('[data-nav]').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    showSection('home');
    $('#searchInput').value = '';
    history.replaceState(null, '', '/');
    loadHome();
  });
});

videoPlayer.setOnEnded(playNextEpisode);
Subtitles.bindAudioPrefSelect($('#audioPrefSelect'), () => {
  if (state.malId) openAnime(state.malId);
});
setupSearch();
loadHome();
checkHealth();

const params = new URLSearchParams(location.search);
const animeParam = params.get('anime');
if (animeParam) openAnime(parseInt(animeParam, 10));

window.addEventListener('anime-stream:storage', (ev) => {
  if (ev.detail?.mode === 'memory') {
    showToast('Disco do navegador cheio. Extensões do Chrome podem causar isso — histórico só nesta sessão.', true);
  }
});

if (getStorageMode() === 'memory') {
  showToast('Armazenamento local indisponível — modo sessão ativo.', true);
}