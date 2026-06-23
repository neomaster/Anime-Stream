var StorageSafe = (function () {
  var memory = {};
  var mode = 'localStorage';
  var warned = false;

  var PRUNE_LIMITS = {
    anime_stream_watch: 15,
    anime_stream_favs: 20,
  };

  function isExtensionNoise(reason) {
    var msg = String((reason && reason.message) || reason || '');
    var stack = String((reason && reason.stack) || '');
    var hay = msg + ' ' + stack;
    return (
      /ChromeMethodBFE|\.ldb|FILE_ERROR_NO_SPACE|Unable to create writable file/i.test(hay) ||
      /content\.js|polyfill\.js/i.test(hay)
    );
  }

  function installNoiseShield() {
    if (window.__animeStreamNoiseShield) return;
    window.__animeStreamNoiseShield = true;

    window.addEventListener('unhandledrejection', function (ev) {
      if (isExtensionNoise(ev.reason)) ev.preventDefault();
    });

    window.addEventListener('error', function (ev) {
      if (isExtensionNoise(ev.error || ev.message)) ev.preventDefault();
    });
  }

  function probeLocalStorage() {
    try {
      var k = '__anime_stream_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function switchToMemory(reason) {
    if (mode === 'memory') return;
    mode = 'memory';
    window.__animeStreamStorageMode = mode;
    if (!warned) {
      warned = true;
      try {
        window.dispatchEvent(new CustomEvent('anime-stream:storage', { detail: { mode: mode, reason: reason } }));
      } catch (e) { /* ignore */ }
    }
  }

  function pruneValue(key, value) {
    var limit = PRUNE_LIMITS[key];
    if (!limit) return value;

    if (key === 'anime_stream_watch' && value && typeof value === 'object') {
      var sorted = Object.keys(value).map(function (k) { return [k, value[k]]; })
        .sort(function (a, b) { return (b[1].at || 0) - (a[1].at || 0); });
      var out = {};
      sorted.slice(0, limit).forEach(function (pair) { out[pair[0]] = pair[1]; });
      return out;
    }

    if (key === 'anime_stream_favs' && Array.isArray(value)) {
      return value.slice(0, limit);
    }

    return value;
  }

  function initStorage() {
    installNoiseShield();
    if (!probeLocalStorage()) switchToMemory('localStorage bloqueado');
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        if (est.quota && est.usage && est.usage / est.quota > 0.92) {
          switchToMemory('quota quase cheia');
        }
      }).catch(function () {});
    }
  }

  function safeGet(key, fallback) {
    if (fallback === undefined) fallback = null;
    if (mode === 'memory') {
      return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : fallback;
    }
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) {
      switchToMemory('leitura falhou');
      return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : fallback;
    }
  }

  function safeSet(key, value) {
    if (mode === 'memory') {
      memory[key] = value;
      return true;
    }
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      switchToMemory('disco cheio');
      memory[key] = value;
      return false;
    }
  }

  function safeGetJson(key, fallback) {
    var raw = safeGet(key, null);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function safeSetJson(key, value) {
    return safeSet(key, JSON.stringify(pruneValue(key, value)));
  }

  initStorage();

  return {
    safeGet: safeGet,
    safeSet: safeSet,
    safeGetJson: safeGetJson,
    safeSetJson: safeSetJson,
    getStorageMode: function () { return mode; },
    isExtensionNoise: isExtensionNoise,
  };
})();