var ServerConfig = (function () {
  var STORAGE_KEY = 'anime_stream_server';
  var DEFAULT_PORT = '3456';
  var build = typeof BuildConfig !== 'undefined' ? BuildConfig : {};
  var CLOUD_MODE = !!build.CLOUD_MODE;
  var FIXED_SERVER = build.DEFAULT_SERVER || (CLOUD_MODE ? '' : '192.168.1.2:3456');
  var CONNECT_RETRIES = build.CONNECT_RETRIES || (CLOUD_MODE ? 6 : 4);
  var TIMEOUT_MS = build.TIMEOUT_MS || (CLOUD_MODE ? 90000 : 25000);
  var PROBE_TIMEOUT_MS = build.PROBE_TIMEOUT_MS || (CLOUD_MODE ? 90000 : 2500);
  var DISCOVERY_ENABLED = CLOUD_MODE ? false : build.DISCOVERY_ENABLED !== false;

  function getRaw() {
    if (CLOUD_MODE) return FIXED_SERVER;
    return localStorage.getItem(STORAGE_KEY) || FIXED_SERVER;
  }

  function setRaw(url) {
    if (CLOUD_MODE) return;
    localStorage.setItem(STORAGE_KEY, (url || '').replace(/\/+$/, ''));
  }

  function normalizeInput(input) {
    var v = (input || '').trim();
    v = v.replace(/\/+$/, '');
    return v;
  }

  function toBaseUrl(addr) {
    var base = normalizeInput(addr);
    if (!base) return '';
    if (/^https?:\/\//i.test(base)) return base;
    if (CLOUD_MODE || /\.(com|app|dev|io|net|org)(:|\/|$)/i.test(base)) {
      return 'https://' + base;
    }
    return 'http://' + base;
  }

  function parseAddress(raw) {
    var v = normalizeInput(raw).replace(/^https?:\/\//i, '');
    if (!v) return null;

    var withPort = v.match(/^([\w.-]+):(\d{1,5})$/);
    if (withPort && withPort[1].indexOf('.') < 0) return null;

    var hostPort = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/);
    if (hostPort) {
      return { o1: hostPort[1], o2: hostPort[2], o3: hostPort[3], o4: hostPort[4], port: hostPort[5] };
    }

    return null;
  }

  function getSubnetFromAddress(addr) {
    var parsed = parseAddress(addr.replace(/^https?:\/\//i, ''));
    if (!parsed) return null;
    return {
      subnet: [parsed.o1, parsed.o2, parsed.o3].join('.'),
      port: parsed.port || DEFAULT_PORT,
    };
  }

  function getCandidateList() {
    var seen = {};
    var list = [];

    function add(addr) {
      var normalized = normalizeInput(addr).replace(/^https?:\/\//i, '');
      if (!normalized || seen[normalized]) return;
      seen[normalized] = true;
      list.push(normalized);
    }

    add(getRaw());
    add(FIXED_SERVER);

    var subnet = getSubnetFromAddress(FIXED_SERVER);
    if (subnet) {
      for (var i = 1; i <= 254; i++) {
        add(subnet.subnet + '.' + i + ':' + subnet.port);
      }
    }

    return list;
  }

  function probeAddress(addr, timeoutMs) {
    var url = toBaseUrl(addr) + '/api/health';
    return new Promise(function (resolve) {
      var timer = setTimeout(function () { resolve(null); }, timeoutMs || PROBE_TIMEOUT_MS);
      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (res) {
          clearTimeout(timer);
          resolve(res.ok ? normalizeInput(addr) : null);
        })
        .catch(function () {
          clearTimeout(timer);
          resolve(null);
        });
    });
  }

  function discoverServer(onProgress) {
    if (!DISCOVERY_ENABLED) {
      return Promise.reject(new Error('Servidor na nuvem indisponivel. Tente novamente em instantes.'));
    }

    var candidates = getCandidateList();
    var batchSize = 36;
    var index = 0;

    function scanBatch() {
      if (index >= candidates.length) {
        return Promise.reject(new Error(
          'Servidor nao encontrado. No PC execute npm start e confirme o mesmo Wi-Fi.'
        ));
      }

      var batch = candidates.slice(index, index + batchSize);
      index += batchSize;

      if (onProgress) {
        onProgress('Procurando servidor... (' + Math.min(index, candidates.length) + '/' + candidates.length + ')');
      }

      return Promise.all(batch.map(function (addr) {
        return probeAddress(addr, PROBE_TIMEOUT_MS);
      })).then(function (results) {
        for (var i = 0; i < results.length; i++) {
          if (results[i]) {
            setRaw(results[i]);
            return results[i];
          }
        }
        return scanBatch();
      });
    }

    return scanBatch();
  }

  function connectWithRetries(onProgress) {
    var attempts = 0;
    var maxAttempts = CONNECT_RETRIES;

    function tryKnown() {
      attempts++;
      var addr = getRaw();
      if (onProgress) {
        var label = CLOUD_MODE ? 'Conectando ao servidor na nuvem...' : 'Conectando...';
        onProgress(label + ' (' + attempts + '/' + maxAttempts + ')');
      }
      return probeAddress(addr, TIMEOUT_MS).then(function (found) {
        if (found) {
          setRaw(found);
          return found;
        }
        if (attempts < maxAttempts) return tryKnown();
        return discoverServer(onProgress);
      });
    }

    if (!CLOUD_MODE) setRaw(FIXED_SERVER);
    return tryKnown();
  }

  return {
    get: function () { return getRaw(); },
    set: function (url) { setRaw(url); },
    getBaseUrl: function () { return toBaseUrl(getRaw()); },
    getTimeoutMs: function () { return TIMEOUT_MS; },
    isCloudMode: function () { return CLOUD_MODE; },
    isConfigured: function () { return !!getRaw(); },
    getFixedServer: function () { return FIXED_SERVER; },
    connectWithRetries: connectWithRetries,
    discoverServer: discoverServer,
    normalizeInput: normalizeInput,
    DEFAULT_PORT: DEFAULT_PORT,
  };
})();