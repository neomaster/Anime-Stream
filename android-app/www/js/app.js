/* global ServerConfig, Api, TvPlayer, Subtitles, AltSources */
(function () {
  var EP_PAGE_SIZE = 48;
  var HEALTH_INTERVAL = 60000;
  var WATCH_KEY = 'anime_stream_watch';

  var state = {
    currentAnime: null,
    animeKey: '',
    malId: null,
    episodes: [],
    currentEpisodeIndex: -1,
    episodePage: 0,
    currentStream: null,
    hls: null,
    screen: 'setup',
    view: 'home',
    prevView: 'home',
    altSourcesEnabled: false,
  };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  var sections = {};
  var healthTimer = null;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(msg, isError) {
    var toast = $('#toast');
    toast.textContent = msg;
    toast.className = 'toast' + (isError ? ' error' : '');
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { toast.hidden = true; }, 4500);
  }

  function setGlobalLoading(show, text) {
    var el = $('#globalLoading');
    if (!el) return;
    if (text) $('#globalLoadingText').textContent = text;
    el.hidden = !show;
  }

  function setSetupStatus(msg, type) {
    var el = $('#setupStatus');
    el.textContent = msg || '';
    el.className = 'setup-status' + (type ? ' ' + type : '');
  }

  function getWatchStore() {
    return StorageSafe.safeGetJson(WATCH_KEY, {});
  }

  function saveWatchProgress(animeKey, epNumber, epIndex, meta) {
    if (!animeKey) return;
    var store = getWatchStore();
    store[animeKey] = {
      ep: epNumber, index: epIndex, at: Date.now(), key: animeKey,
      title: meta && meta.title, poster: meta && meta.poster,
      malId: meta && meta.malId, sourceUrl: meta && meta.sourceUrl,
    };
    StorageSafe.safeSetJson(WATCH_KEY, store);
    renderContinueSection();
  }

  function renderContinueSection() {
    var sec = $('#continueSection');
    var grid = $('#continueGrid');
    if (!sec || !grid) return;
    var store = getWatchStore();
    var items = Object.keys(store).map(function (k) { return store[k]; })
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); }).slice(0, 10);
    if (!items.length) { sec.hidden = true; return; }
    sec.hidden = false;
    renderGrid(grid, items.map(function (it) {
      return {
        title: it.title || 'Anime', poster: it.poster, ep: it.ep,
        mal_id: it.malId, sourceUrl: it.sourceUrl, key: it.key,
      };
    }));
  }

  function getWatchProgress(animeKey) {
    return getWatchStore()[animeKey] || null;
  }

  function showSetup(isError) {
    state.screen = 'setup';
    $('#setupScreen').hidden = false;
    $('#appRoot').hidden = true;
    $('#retryConnectBtn').hidden = !isError;
    var msg = $('#setupMessage');
    if (msg) msg.textContent = isError ? 'Nao foi possivel conectar' : 'Conectando ao servidor...';
  }

  function showApp() {
    state.screen = 'app';
    $('#setupScreen').hidden = true;
    $('#appRoot').hidden = false;
    startHealthMonitor();
  }

  function showView(name) {
    if (state.view !== name) state.prevView = state.view;
    state.view = name;
    sections.home.hidden = name !== 'home';
    sections.search.hidden = name !== 'search';
    sections.detail.hidden = name !== 'detail';
  }

  function renderSkeletonGrid(container, count) {
    container.innerHTML = '';
    for (var i = 0; i < count; i++) {
      var sk = document.createElement('div');
      sk.className = 'skeleton-card';
      sk.innerHTML = '<div class="skeleton-poster"></div><div class="skeleton-title"></div>';
      container.appendChild(sk);
    }
  }

  function createAnimeCard(anime) {
    var card = document.createElement('article');
    var isSource = anime.source === 'animefire' || anime.sourceUrl;
    card.className = 'anime-card' + (isSource ? ' source-only' : '');
    var poster = anime.poster || anime.poster_small || '';
    card.innerHTML =
      '<div class="anime-card-poster">' +
        '<img src="' + escapeHtml(poster) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'" />' +
        (anime.score ? '<span class="anime-card-score">★ ' + escapeHtml(anime.score) + '</span>' : '') +
        (anime.ep ? '<span class="anime-card-ep">Ep. ' + escapeHtml(anime.ep) + '</span>' : '') +
      '</div>' +
      '<p class="anime-card-title">' + escapeHtml(anime.title) + '</p>';
    card.addEventListener('click', function () {
      if (anime.mal_id) openAnime(anime.mal_id);
      else if (anime.sourceUrl) openSourceAnime(anime.sourceUrl);
      else if (isSource && anime.sourceUrl) openSourceAnime(anime.sourceUrl);
    });
    return card;
  }

  function renderGrid(container, animes) {
    container.innerHTML = '';
    if (!animes.length) {
      container.innerHTML = '<p class="empty-msg">Nenhum resultado.</p>';
      return;
    }
    animes.forEach(function (a) { container.appendChild(createAnimeCard(a)); });
  }

  function loadHome() {
    renderContinueSection();
    renderSkeletonGrid($('#topGrid'), 6);
    renderSkeletonGrid($('#seasonGrid'), 6);
    Api.top().then(function (data) {
      renderGrid($('#topGrid'), data.top || []);
      renderGrid($('#seasonGrid'), data.season || []);
    }).catch(function (err) {
      showToast('Erro: ' + err.message, true);
    });
  }

  function searchAnime(query) {
    if (!query.trim()) return;
    showView('search');
    var grid = $('#searchGrid');
    renderSkeletonGrid(grid, 8);
    Api.search(query).then(function (data) {
      var results = data.results || data.jikan || [];
      if (data.warnings && data.warnings.length) showToast(data.warnings[0], true);
      $('#resultCount').textContent = results.length + ' resultados';
      if (!results.length) {
        grid.innerHTML = '<p class="empty-msg">Nenhum resultado. Tente novamente em instantes.</p>';
        return;
      }
      renderGrid(grid, results);
    }).catch(function (err) {
      grid.innerHTML = '<p class="empty-msg error">' + escapeHtml(err.message) + '</p>';
    });
  }

  function updateContinueButton() {
    var btn = $('#continueBtn');
    var progress = getWatchProgress(state.animeKey);
    if (!btn || !progress || !state.episodes.length) { if (btn) btn.hidden = true; return; }
    btn.hidden = false;
    btn.textContent = 'Continuar ep. ' + progress.ep;
    btn.onclick = function () {
      var idx = progress.index >= 0 ? progress.index : state.episodes.findIndex(function (e) {
        return String(e.number) === String(progress.ep);
      });
      if (idx >= 0) {
        state.episodePage = Math.floor(idx / EP_PAGE_SIZE);
        renderEpisodes();
        playEpisode(state.episodes[idx], null, idx);
      }
    };
  }

  function renderDetailCommon(opts) {
    $('#detailTitle').textContent = opts.title;
    $('#detailSynopsis').textContent = opts.synopsis || 'Sinopse indisponivel.';
    $('#detailPoster').src = opts.poster || '';
    $('#detailBackdrop').style.backgroundImage = opts.poster ? 'url(' + opts.poster + ')' : '';
    var badge = $('#sourceBadge');
    badge.textContent = opts.source
      ? ('Fonte: ' + opts.source.name + (opts.episodes && opts.episodes.length ? ' · ' + opts.episodes.length + ' eps' : ''))
      : 'Episodios nao encontrados na nuvem';
    state.episodes = opts.episodes || [];
    state.episodePage = 0;
    state.currentEpisodeIndex = -1;
    var epFilter = $('#epFilter');
    if (epFilter) epFilter.value = '';
    renderEpisodes();
    updateContinueButton();
  }

  function openAnime(malId) {
    showView('detail');
    $('#playerSection').hidden = true;
    setGlobalLoading(true, 'Carregando...');
    Api.anime(malId).then(function (data) {
      state.currentAnime = data.anime;
      state.animeKey = 'mal:' + malId;
      state.malId = malId;
      state._meta = { title: data.anime.title, poster: data.anime.poster, malId: malId };
      var anime = data.anime;
      $('#detailMeta').innerHTML =
        (anime.score ? '<span>★ ' + anime.score + '</span>' : '') +
        (anime.type ? '<span>' + anime.type + '</span>' : '') +
        '<div>' + (anime.genres || []).map(function (g) {
          return '<span class="tag">' + escapeHtml(g) + '</span>';
        }).join('') + '</div>';
      renderDetailCommon({
        title: anime.title,
        synopsis: anime.synopsis,
        poster: anime.poster,
        source: data.source,
        episodes: data.episodes,
      });
    }).catch(function (err) {
      $('#detailTitle').textContent = 'Erro';
      $('#detailSynopsis').textContent = err.message;
    }).then(function () { setGlobalLoading(false); });
  }

  function openSourceAnime(url) {
    showView('detail');
    state.animeKey = 'src:' + url;
    state.malId = null;
    setGlobalLoading(true, 'Carregando...');
    Api.source(url).then(function (data) {
      state.currentAnime = data;
      state._meta = { title: data.title, poster: data.poster, sourceUrl: url };
      renderDetailCommon({
        title: data.title,
        synopsis: data.synopsis,
        poster: data.poster,
        source: data.source,
        episodes: data.episodes,
      });
    }).catch(function (err) {
      showToast(err.message, true);
    }).then(function () { setGlobalLoading(false); });
  }

  function renderEpisodes() {
    var grid = $('#episodesGrid');
    grid.innerHTML = '';
    if (!state.episodes.length) {
      $('#episodesEmpty').hidden = false;
      $('#episodePagination').hidden = true;
      return;
    }
    $('#episodesEmpty').hidden = true;
    var filter = ($('#epFilter') && $('#epFilter').value || '').trim();
    var list = state.episodes.map(function (ep, i) { return { ep: ep, i: i }; });
    if (filter) {
      list = list.filter(function (x) { return String(x.ep.number).indexOf(filter) >= 0; });
    }
    var totalPages = Math.max(1, Math.ceil(list.length / EP_PAGE_SIZE));
    if (state.episodePage >= totalPages) state.episodePage = totalPages - 1;
    var start = state.episodePage * EP_PAGE_SIZE;
    list.slice(start, start + EP_PAGE_SIZE).forEach(function (row) {
      var ep = row.ep;
      var idx = row.i;
      var btn = document.createElement('button');
      btn.className = 'episode-btn' + (idx === state.currentEpisodeIndex ? ' active' : '');
      btn.textContent = ep.number;
      btn.setAttribute('data-ep-index', idx);
      btn.addEventListener('click', function () { onEpisodeClick(ep, btn, idx); });
      grid.appendChild(btn);
    });
    var pag = $('#episodePagination');
    if (!pag) return;
    if (filter || totalPages <= 1) { pag.hidden = true; return; }
    pag.hidden = false;
    $('#epPageLabel').textContent = (state.episodePage + 1) + '/' + totalPages;
    $('#epPrevBtn').disabled = state.episodePage <= 0;
    $('#epNextBtn').disabled = state.episodePage >= totalPages - 1;
  }

  function setupSubtitles(stream) {
    Subtitles.setup(TvPlayer.el, stream, $('#subtitleSelect'), $('#subtitleControls'));
  }

  function setupQuality(stream) {
    $('#qualityControls').hidden = true;
    state.currentStream = stream;
    if (!stream.qualities || stream.qualities.length < 2) return;
    $('#qualityControls').hidden = false;
    var sel = $('#qualitySelect');
    sel.innerHTML = '';
    stream.qualities.forEach(function (q, i) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = q.label || ('Q' + (i + 1));
      sel.appendChild(opt);
    });
    sel.onchange = function () {
      var q = stream.qualities[parseInt(sel.value, 10)];
      if (!q) return;
      var player = TvPlayer.el;
      var t = player.currentTime;
      destroyHls();
      var src = Api.resolveProxy(q.proxyUrl || ('/api/proxy/video?url=' + encodeURIComponent(q.url)));
      if (/\.m3u8|type=hls/i.test(src) && window.Hls && Hls.isSupported()) {
        state.hls = new Hls();
        state.hls.loadSource(src);
        state.hls.attachMedia(player);
        state.hls.on(Hls.Events.MANIFEST_PARSED, function () {
          player.currentTime = t;
          player.play().catch(function () {});
        });
      } else {
        player.src = src;
        player.addEventListener('loadeddata', function () {
          player.currentTime = t;
          player.play().catch(function () {});
        }, { once: true });
      }
    };
  }

  function playNextEpisode() {
    var next = state.currentEpisodeIndex + 1;
    if (next >= state.episodes.length) return;
    if (next >= (state.episodePage + 1) * EP_PAGE_SIZE) { state.episodePage++; renderEpisodes(); }
    playEpisode(state.episodes[next], null, next);
  }

  function destroyHls() {
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
  }

  function onEpisodeClick(episode, btn, idx) {
    if (!state.altSourcesEnabled || !state.malId) {
      playEpisode(episode, btn, idx);
      return;
    }

    AltSources.showEpisodePicker({
      episode: episode,
      malId: state.malId,
      onStream: function () { playEpisode(episode, btn, idx); },
      onMagnet: function (opts) {
        opts = opts || {};
        var previewSeeders = null;
        var previewLeechers = null;

        function pushProgress(seeders, leechers, phase) {
          if (!opts.onMagnetProgress) return;
          opts.onMagnetProgress({
            buttonLabel: AltSources.formatSeederLabel(seeders, leechers, phase),
            statusLabel: seeders != null && !isNaN(Number(seeders))
              ? seeders + ' seeders disponiveis'
              : (phase === 'scan' ? 'Buscando melhor fonte...' : 'Preparando streaming...'),
          });
        }

        pushProgress(null, null, 'scan');

        var catalogChain = AltSources.fetchEpisodeMagnetCatalog(state.malId, episode.number)
          .then(function (catalog) {
            var best = catalog && catalog.items && catalog.items[0];
            if (best) {
              previewSeeders = best.seeders != null ? best.seeders : null;
              previewLeechers = best.leechers != null ? best.leechers : null;
              pushProgress(previewSeeders, previewLeechers, 'scan');
            }
          })
          .catch(function () {});

        return catalogChain.then(function () {
          pushProgress(previewSeeders, previewLeechers, 'resolve');
          return AltSources.openEpisodeMagnet(state.malId, episode.number);
        }).then(function (result) {
          var seeders = result.seeders != null ? result.seeders : previewSeeders;
          var leechers = result.leechers != null ? result.leechers : previewLeechers;
          pushProgress(seeders, leechers, 'connect');
          if (opts.onPickerClose) opts.onPickerClose();

          $$('.episode-btn').forEach(function (b) { b.classList.remove('active'); });
          if (btn) btn.classList.add('active');
          state.currentEpisodeIndex = idx;
          saveWatchProgress(state.animeKey, episode.number, idx, state._meta);
          $('#playerSection').hidden = false;
          TvPlayer.reset();
          TvPlayer.showLoading(AltSources.formatSeederLabel(seeders, leechers, 'connect'));
          TvPlayer.setEpisodeLabel(
            seeders != null
              ? 'Ep. ' + episode.number + ' · Magnet · ' + seeders + ' seeders'
              : 'Ep. ' + episode.number + ' · Magnet'
          );
          destroyHls();
          var player = TvPlayer.el;
          player.pause();
          player.removeAttribute('src');
          player.load();

          return AltSources.playMagnetStream({
            streamUrl: result.streamUrl,
            statusUrl: result.statusUrl,
            videoEl: player,
            onProgress: function (pct, peers) {
              var label = 'Torrent ' + pct + '%';
              if (seeders != null) label += ' · ' + seeders + ' seeders';
              if (peers) label += ' · ' + peers + ' peers';
              TvPlayer.showLoading(label);
            },
            onReady: function () { TvPlayer.hideLoading(); },
          }).then(function () {
            if (result.quality || seeders != null) {
              showToast('Magnet · ' + (result.quality || 'SD') + (seeders != null ? ' · ' + seeders + ' seeders' : ''));
            }
            $('#playerSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          });
        });
      },
      onError: function (err) {
        showToast(AltSources.formatMagnetError(err), true);
      },
    });
  }

  function playEpisode(episode, btn, idx) {
    $$('.episode-btn').forEach(function (b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');
    state.currentEpisodeIndex = idx;
    saveWatchProgress(state.animeKey, episode.number, idx, state._meta);
    $('#playerSection').hidden = false;
    TvPlayer.reset();
    TvPlayer.showLoading();
    TvPlayer.setEpisodeLabel('Ep. ' + episode.number);
    var player = TvPlayer.el;
    destroyHls();
    player.pause();
    player.removeAttribute('src');
    player.load();
    player.querySelectorAll('track').forEach(function (t) { t.remove(); });
    Api.stream(episode.url).then(function (stream) {
      var src = Api.resolveProxy(stream.videoProxy);
      var useHls = stream.type === 'hls' || /\.m3u8/i.test(src);
      if (useHls && window.Hls && Hls.isSupported()) {
        state.hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          xhrSetup: function (xhr) { xhr.withCredentials = false; },
        });
        state.hls.loadSource(src);
        state.hls.attachMedia(player);
        state.hls.on(Hls.Events.MANIFEST_PARSED, function () {
          player.play().catch(function () {});
        });
        state.hls.on(Hls.Events.ERROR, function (_, data) {
          if (!data.fatal) return;
          destroyHls();
          player.src = src;
          player.play().catch(function () {
            showToast('Erro ao reproduzir episodio', true);
          });
        });
      } else {
        player.src = src;
        player.addEventListener('error', function onErr() {
          player.removeEventListener('error', onErr);
          showToast('Erro ao carregar video. Tente outro episodio.', true);
        }, { once: true });
        player.play().catch(function () {});
      }
      setupSubtitles(stream);
      setupQuality(stream);
      $('#playerSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }).catch(function (err) {
      TvPlayer.hideLoading();
      showToast(err.message, true);
    });
  }

  function checkHealth() {
    return Api.health().then(function (h) {
      state.altSourcesEnabled = !!h.altSources;
      $('#serverStatus').classList.add('online');
      $('#serverStatus').title = h.altSources ? 'Online · magnet' : 'Online';
    }).catch(function () {
      $('#serverStatus').classList.remove('online');
    });
  }

  function startHealthMonitor() {
    if (healthTimer) clearInterval(healthTimer);
    checkHealth();
    healthTimer = setInterval(checkHealth, HEALTH_INTERVAL);
  }

  function autoConnect() {
    showSetup(false);
    setSetupStatus('', '');
    $('#retryConnectBtn').hidden = true;
    setGlobalLoading(true, 'Conectando...');

    ServerConfig.connectWithRetries(function (msg) {
      setSetupStatus(msg, '');
      setGlobalLoading(true, msg);
    }).then(function () {
      setGlobalLoading(false);
      setSetupStatus('Conectado!', 'ok');
      setTimeout(function () { showApp(); loadHome(); }, 300);
    }).catch(function (err) {
      setGlobalLoading(false);
      showSetup(true);
      setSetupStatus(err.message, 'err');
    });
  }

  function bindEvents() {
    $('#retryConnectBtn').addEventListener('click', autoConnect);
    $('#searchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      searchAnime($('#searchInput').value);
    });
    $('#homeBtn').addEventListener('click', function () {
      showView('home');
      loadHome();
    });

    $('#epPrevBtn').addEventListener('click', function () {
      if (state.episodePage > 0) { state.episodePage--; renderEpisodes(); }
    });
    $('#epNextBtn').addEventListener('click', function () {
      var max = Math.ceil(state.episodes.length / EP_PAGE_SIZE) - 1;
      if (state.episodePage < max) { state.episodePage++; renderEpisodes(); }
    });
    var epFilter = $('#epFilter');
    if (epFilter) {
      epFilter.addEventListener('input', function () {
        state.episodePage = 0;
        renderEpisodes();
      });
    }
  }

  function onStorageDegraded() {
    showToast('Disco cheio ou extensão do Chrome bloqueando armazenamento. Histórico só nesta sessão.', true);
  }

  function boot() {
    sections = {
      home: $('#homeSection'),
      search: $('#searchSection'),
      detail: $('#detailSection'),
    };

    window.addEventListener('anime-stream:storage', function (ev) {
      if (ev.detail && ev.detail.mode === 'memory') onStorageDegraded();
    });
    if (typeof StorageSafe !== 'undefined' && StorageSafe.getStorageMode() === 'memory') {
      onStorageDegraded();
    }

    TvPlayer.init();
    TvPlayer.setOnEnded(playNextEpisode);
    Subtitles.bindAudioPrefSelect($('#audioPrefSelect'), function () {
      if (state.currentAnime && state.currentAnime.mal_id) {
        openAnime(state.currentAnime.mal_id);
      }
    });
    bindEvents();
    autoConnect();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();