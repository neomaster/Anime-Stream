/* global ServerConfig, Api, Remote, TvPlayer, Subtitles */
(function () {
  var EP_PAGE_SIZE = 48;
  var HEALTH_INTERVAL = 60000;
  var WATCH_KEY = 'anime_stream_watch';

  var state = {
    currentAnime: null,
    animeKey: '',
    episodes: [],
    currentEpisodeIndex: -1,
    episodePage: 0,
    currentStream: null,
    screen: 'setup',
    view: 'home',
    prevView: 'home',
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
    try { return JSON.parse(localStorage.getItem(WATCH_KEY) || '{}'); }
    catch (e) { return {}; }
  }

  function saveWatchProgress(animeKey, epNumber, epIndex, meta) {
    if (!animeKey) return;
    var store = getWatchStore();
    store[animeKey] = {
      ep: epNumber, index: epIndex, at: Date.now(), key: animeKey,
      title: meta && meta.title, poster: meta && meta.poster,
      malId: meta && meta.malId, sourceUrl: meta && meta.sourceUrl,
    };
    localStorage.setItem(WATCH_KEY, JSON.stringify(store));
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
        mal_id: it.malId, sourceUrl: it.sourceUrl,
      };
    }));
    Remote.refresh();
  }

  function getWatchProgress(animeKey) {
    var store = getWatchStore();
    return store[animeKey] || null;
  }

  function showSetup() {
    state.screen = 'setup';
    $('#setupScreen').hidden = false;
    $('#appRoot').hidden = true;
    ServerConfig.fillForm(ServerConfig.get());
    Remote.focusAt(0);
  }

  function showApp() {
    state.screen = 'app';
    $('#setupScreen').hidden = true;
    $('#appRoot').hidden = false;
    $('#serverLabel').textContent = 'Servidor: ' + ServerConfig.get();
    startHealthMonitor();
    Remote.focusAt(0);
  }

  function showView(name) {
    if (state.view !== name) state.prevView = state.view;
    state.view = name;
    sections.hero.hidden = name !== 'home';
    sections.home.hidden = name !== 'home';
    sections.search.hidden = name !== 'search';
    sections.detail.hidden = name !== 'detail';
    updateHintBar();
  }

  function updateHintBar() {
    var bar = $('#hintBar');
    if (!bar) return;
    var hints = ['Setas: navegar', 'OK: selecionar', 'Voltar: retornar'];
    if (state.view === 'detail' && !$('#playerSection').hidden) {
      hints.push('Play/Pause', '⏪/⏩: 10s');
    }
    hints.push('Vermelho: configuracoes');
    bar.textContent = hints.join('  ·  ');
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
    card.className = 'anime-card focusable' + (isSource ? ' source-only' : '');
    card.tabIndex = 0;

    var poster = anime.poster || anime.poster_small || '';
    card.innerHTML =
      '<div class="anime-card-poster">' +
        '<img src="' + escapeHtml(poster) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'" />' +
        (anime.score ? '<span class="anime-card-score">★ ' + escapeHtml(anime.score) + '</span>' : '') +
        (isSource ? '<span class="anime-card-badge">Catalogo</span>' : '') +
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
      container.innerHTML = '<p class="empty-msg">Nenhum resultado encontrado.</p>';
      return;
    }
    animes.forEach(function (a) { container.appendChild(createAnimeCard(a)); });
    Remote.refresh();
  }

  function loadHome() {
    renderContinueSection();
    renderSkeletonGrid($('#topGrid'), 6);
    renderSkeletonGrid($('#seasonGrid'), 6);

    Api.top().then(function (data) {
      renderGrid($('#topGrid'), data.top || []);
      renderGrid($('#seasonGrid'), data.season || []);
    }).catch(function (err) {
      $('#topGrid').innerHTML = '<p class="empty-msg error">' + escapeHtml(err.message) + '</p>';
      $('#seasonGrid').innerHTML = '';
      showToast('Erro ao carregar catalogo', true);
    });
  }

  function searchAnime(query) {
    if (!query.trim()) return;
    showView('search');

    var grid = $('#searchGrid');
    renderSkeletonGrid(grid, 8);

    Api.search(query).then(function (data) {
      var results = data.results || data.jikan || [];
      $('#resultCount').textContent = results.length + ' resultados';
      renderGrid(grid, results);
      Remote.focusAt(0);
    }).catch(function (err) {
      grid.innerHTML = '<p class="empty-msg error">' + escapeHtml(err.message) + '</p>';
    });
  }

  function getAnimeKey(data) {
    if (data.anime && data.anime.mal_id) return 'mal:' + data.anime.mal_id;
    if (data.sourceUrl) return 'src:' + data.sourceUrl;
    if (data.title) return 'title:' + data.title;
    return '';
  }

  function updateContinueButton() {
    var btn = $('#continueBtn');
    if (!btn) return;
    var progress = getWatchProgress(state.animeKey);
    if (!progress || !state.episodes.length) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    btn.textContent = 'Continuar do episodio ' + progress.ep;
    btn.onclick = function () {
      var idx = typeof progress.index === 'number' ? progress.index : -1;
      if (idx < 0) {
        for (var i = 0; i < state.episodes.length; i++) {
          if (String(state.episodes[i].number) === String(progress.ep)) { idx = i; break; }
        }
      }
      if (idx >= 0) {
        state.episodePage = Math.floor(idx / EP_PAGE_SIZE);
        renderEpisodes();
        var ep = state.episodes[idx];
        var btnEl = $('#episodesGrid').querySelector('[data-ep-index="' + idx + '"]');
        if (ep && btnEl) playEpisode(ep, btnEl, idx);
      }
    };
  }

  function renderDetailCommon(opts) {
    $('#detailTitle').textContent = opts.title;
    $('#detailSynopsis').textContent = opts.synopsis || 'Sinopse nao disponivel.';
    $('#detailPoster').src = opts.poster || '';
    $('#detailPoster').alt = opts.title;
    $('#detailBackdrop').style.backgroundImage = opts.poster ? 'url(' + opts.poster + ')' : '';

    var badge = $('#sourceBadge');
    if (opts.source) {
      badge.innerHTML = '▶ Fonte: ' + escapeHtml(opts.source.name);
    } else {
      badge.textContent = 'Nao encontrado nas fontes de streaming';
    }
    badge.hidden = false;

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
    $('#detailTitle').textContent = 'Carregando...';
    $('#detailSynopsis').textContent = '';
    $('#episodesGrid').innerHTML = '';
    $('#episodesEmpty').hidden = true;
    $('#continueBtn').hidden = true;
    setGlobalLoading(true, 'Buscando anime e episodios...');

    Api.anime(malId).then(function (data) {
      state.currentAnime = data.anime;
      state.animeKey = getAnimeKey(data);
      state._meta = { title: data.anime.title, poster: data.anime.poster, malId: malId };

      var anime = data.anime;
      $('#detailMeta').innerHTML =
        (anime.score ? '<span>★ ' + escapeHtml(anime.score) + '</span>' : '') +
        (anime.type ? '<span>' + escapeHtml(anime.type) + '</span>' : '') +
        (anime.episodes ? '<span>' + anime.episodes + ' eps</span>' : '') +
        (anime.status ? '<span>' + escapeHtml(anime.status) + '</span>' : '') +
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
      Remote.focusAt(0);
    }).catch(function (err) {
      $('#detailTitle').textContent = 'Erro';
      $('#detailSynopsis').textContent = err.message;
      showToast(err.message, true);
    }).then(function () {
      setGlobalLoading(false);
    });
  }

  function openSourceAnime(sourceUrl) {
    showView('detail');
    $('#playerSection').hidden = true;
    state.animeKey = 'src:' + sourceUrl;
    $('#detailTitle').textContent = 'Carregando...';
    $('#detailMeta').innerHTML = '<span>Catalogo AnimeFire</span>';
    setGlobalLoading(true, 'Carregando episodios...');

    Api.source(sourceUrl).then(function (data) {
      state.currentAnime = data;
      state._meta = { title: data.title, poster: data.poster, sourceUrl: sourceUrl };
      renderDetailCommon({
        title: data.title,
        synopsis: data.synopsis,
        poster: data.poster,
        source: data.source,
        episodes: data.episodes,
      });
      Remote.focusAt(0);
    }).catch(function (err) {
      $('#detailTitle').textContent = 'Erro';
      $('#detailSynopsis').textContent = err.message;
    }).then(function () {
      setGlobalLoading(false);
    });
  }

  function renderEpisodePagination(totalPages, hidePag) {
    var pag = $('#episodePagination');
    if (!pag) return;
    if (hidePag || totalPages <= 1) {
      pag.hidden = true;
      return;
    }
    pag.hidden = false;
    $('#epPageLabel').textContent = 'Pagina ' + (state.episodePage + 1) + ' de ' + totalPages;
    $('#epPrevBtn').disabled = state.episodePage <= 0;
    $('#epNextBtn').disabled = state.episodePage >= totalPages - 1;
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
    if (state.episodePage < 0) state.episodePage = 0;

    var start = state.episodePage * EP_PAGE_SIZE;
    var slice = list.slice(start, start + EP_PAGE_SIZE);

    slice.forEach(function (row) {
      var ep = row.ep;
      var globalIdx = row.i;
      var btn = document.createElement('button');
      btn.className = 'episode-btn focusable';
      if (globalIdx === state.currentEpisodeIndex) btn.classList.add('active');
      btn.textContent = ep.number;
      btn.title = ep.label;
      btn.setAttribute('data-ep-index', String(globalIdx));
      btn.addEventListener('click', function () { playEpisode(ep, btn, globalIdx); });
      grid.appendChild(btn);
    });

    renderEpisodePagination(totalPages, !!filter);
    Remote.refresh();
  }

  function setupSubtitles(stream) {
    Subtitles.setup(TvPlayer.el, stream, $('#subtitleSelect'), $('#subtitleControls'));
  }

  function setupQuality(stream) {
    var qualityControls = $('#qualityControls');
    var qualitySelect = $('#qualitySelect');
    qualityControls.hidden = true;
    state.currentStream = stream;

    if (!stream.qualities || stream.qualities.length < 2) return;

    qualityControls.hidden = false;
    qualitySelect.innerHTML = '';

    stream.qualities.forEach(function (q, idx) {
      var opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = q.label || ('Opcao ' + (idx + 1));
      if (q.label === stream.quality) opt.selected = true;
      qualitySelect.appendChild(opt);
    });

    qualitySelect.onchange = function () {
      var q = stream.qualities[parseInt(qualitySelect.value, 10)];
      if (!q) return;
      TvPlayer.showLoading('Trocando qualidade...');
      var proxy = Api.resolveProxy(q.proxyUrl || ('/api/proxy/video?url=' + encodeURIComponent(q.url)));
      var player = TvPlayer.el;
      var time = player.currentTime;
      player.src = proxy;
      player.addEventListener('loadeddata', function () {
        player.currentTime = time;
        player.play().catch(function () {});
      }, { once: true });
    };
  }

  function playNextEpisode() {
    var next = state.currentEpisodeIndex + 1;
    if (next >= state.episodes.length) {
      showToast('Ultimo episodio da temporada');
      return;
    }
    if (next >= (state.episodePage + 1) * EP_PAGE_SIZE) {
      state.episodePage++;
      renderEpisodes();
    }
    var ep = state.episodes[next];
    var btn = $('#episodesGrid').querySelector('[data-ep-index="' + next + '"]');
    if (ep) playEpisode(ep, btn, next);
  }

  function playEpisode(episode, btn, epIndex) {
    $$('.episode-btn').forEach(function (b) { b.classList.remove('active'); });
    if (btn) btn.classList.add('active');

    state.currentEpisodeIndex = epIndex;
    saveWatchProgress(state.animeKey, episode.number, epIndex, state._meta);

    var playerSection = $('#playerSection');
    playerSection.hidden = false;
    TvPlayer.reset();
    TvPlayer.showLoading();
    TvPlayer.setEpisodeLabel('Episodio ' + episode.number);
    updateHintBar();

    $('#subtitleControls').hidden = true;
    $('#qualityControls').hidden = true;

    var player = TvPlayer.el;
    player.pause();
    player.removeAttribute('src');
    var oldTracks = player.querySelectorAll('track');
    for (var i = 0; i < oldTracks.length; i++) oldTracks[i].remove();

    Api.stream(episode.url).then(function (stream) {
      player.src = Api.resolveProxy(stream.videoProxy);
      player.play().catch(function () {});
      setupSubtitles(stream);
      setupQuality(stream);
      Remote.focusElement($('#playPauseBtn'));
    }).catch(function (err) {
      TvPlayer.hideLoading();
      showToast('Erro ao carregar episodio: ' + err.message, true);
    });
  }

  function checkHealth() {
    return Api.health().then(function (health) {
      var status = $('#serverStatus');
      status.classList.add('online');
      status.title = health.goanime
        ? 'Servidor online · streaming pronto'
        : 'Servidor online · streaming local indisponivel';
    }).catch(function () {
      $('#serverStatus').classList.remove('online');
      $('#serverStatus').title = 'Servidor offline';
    });
  }

  function startHealthMonitor() {
    if (healthTimer) clearInterval(healthTimer);
    checkHealth();
    healthTimer = setInterval(checkHealth, HEALTH_INTERVAL);
  }

  function saveServer() {
    var raw = ServerConfig.readForm();
    if (!raw) {
      setSetupStatus('Preencha os 4 blocos do IP (ex: 192 · 168 · 1 · 2)', 'err');
      return;
    }
    ServerConfig.set(raw);
    setSetupStatus('Testando conexao...', '');
    Api.health().then(function (health) {
      setSetupStatus('Conectado ao servidor!', 'ok');
      setTimeout(function () {
        showApp();
        loadHome();
      }, 500);
    }).catch(function (err) {
      setSetupStatus('Falha: ' + err.message, 'err');
    });
  }

  function testServer() {
    var raw = ServerConfig.readForm();
    if (!raw) {
      setSetupStatus('Preencha o IP antes de testar', 'err');
      return;
    }
    ServerConfig.set(raw);
    setSetupStatus('Testando...', '');
    Api.health().then(function (health) {
      setSetupStatus('Conexao OK — servidor respondendo', 'ok');
    }).catch(function (err) {
      setSetupStatus('Erro: ' + err.message, 'err');
    });
  }

  function handleBack() {
    if (state.screen !== 'app') return;

    if (state.view === 'detail') {
      if (!$('#playerSection').hidden) {
        $('#playerSection').hidden = true;
        TvPlayer.el.pause();
        updateHintBar();
        Remote.focusAt(0);
        return;
      }
      showView(state.prevView === 'search' ? 'search' : 'home');
      if (state.prevView !== 'search') loadHome();
      Remote.focusAt(0);
      return;
    }

    if (state.view === 'search') {
      showView('home');
      $('#searchInput').value = '';
      Remote.focusAt(0);
    }
  }

  function handleMediaKey(code) {
    if ($('#playerSection').hidden) return;
    if (code === Remote.KEYS.PLAY || code === Remote.KEYS.PAUSE) TvPlayer.togglePlay();
    else if (code === Remote.KEYS.RW) TvPlayer.seekRelative(-10);
    else if (code === Remote.KEYS.FF) TvPlayer.seekRelative(10);
    else if (code === Remote.KEYS.STOP) {
      TvPlayer.el.pause();
      TvPlayer.el.currentTime = 0;
    }
  }

  function bindEvents() {
    $('#saveServerBtn').addEventListener('click', saveServer);
    $('#testServerBtn').addEventListener('click', testServer);

    $('#searchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      searchAnime($('#searchInput').value);
    });

    $('#homeBtn').addEventListener('click', function () {
      showView('home');
      $('#searchInput').value = '';
      loadHome();
      Remote.focusAt(0);
    });

    $('#settingsBtn').addEventListener('click', showSetup);

    $('#epPrevBtn').addEventListener('click', function () {
      if (state.episodePage > 0) {
        state.episodePage--;
        renderEpisodes();
        Remote.focusAt(0);
      }
    });

    $('#epNextBtn').addEventListener('click', function () {
      var totalPages = Math.ceil(state.episodes.length / EP_PAGE_SIZE);
      if (state.episodePage < totalPages - 1) {
        state.episodePage++;
        renderEpisodes();
        Remote.focusAt(0);
      }
    });

    var epFilter = $('#epFilter');
    if (epFilter) {
      epFilter.addEventListener('input', function () {
        state.episodePage = 0;
        renderEpisodes();
      });
    }
  }

  function boot() {
    sections = {
      hero: $('#heroSection'),
      home: $('#homeSection'),
      search: $('#searchSection'),
      detail: $('#detailSection'),
    };

    TvPlayer.init();
    TvPlayer.setOnEnded(playNextEpisode);
    Subtitles.bindAudioPrefSelect($('#audioPrefSelect'), function () {
      if (state.currentAnime && state.currentAnime.mal_id) {
        openAnime(state.currentAnime.mal_id);
      }
    });

    Remote.init({
      onBack: handleBack,
      onMediaKey: handleMediaKey,
      onRedKey: showSetup,
    });

    bindEvents();
    ServerConfig.bindForm();
    updateHintBar();

    if (ServerConfig.isConfigured()) {
      Api.health().then(function () {
        showApp();
        loadHome();
      }).catch(function () {
        showSetup();
      });
    } else {
      showSetup();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();