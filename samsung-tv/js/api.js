var Api = (function () {
  var TIMEOUT_MS = 20000;

  function base() {
    var b = ServerConfig.getBaseUrl();
    if (!b) throw new Error('Servidor nao configurado');
    return b;
  }

  function abs(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return base() + (path.charAt(0) === '/' ? path : '/' + path);
  }

  function fetchWithTimeout(url, options) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('Tempo esgotado. Verifique se o PC esta ligado e na mesma rede.'));
      }, TIMEOUT_MS);

      fetch(url, options).then(function (res) {
        clearTimeout(timer);
        resolve(res);
      }).catch(function (err) {
        clearTimeout(timer);
        if (err.message && err.message.indexOf('Tempo esgotado') >= 0) reject(err);
        else reject(new Error(
          'Sem conexao. Checklist: 1) PC com npm run start:tv 2) Mesmo Wi-Fi 3) IP 192.168.x.x (nao VPN) 4) Porta 3456 5) Execute fix-network.ps1 como Admin no PC'
        ));
      });
    });
  }

  function fetchJson(path) {
    return fetchWithTimeout(abs(path), {
      headers: { Accept: 'application/json' },
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (err) {
          throw new Error(err.error || ('Erro ' + res.status));
        });
      }
      return res.json();
    });
  }

  function audioPrefQuery() {
    try {
      return localStorage.getItem('anime_stream_audio_pref') || 'legendado';
    } catch (e) {
      return 'legendado';
    }
  }

  return {
    health: function () { return fetchJson('/api/health'); },
    top: function () { return fetchJson('/api/top'); },
    search: function (q) { return fetchJson('/api/search?q=' + encodeURIComponent(q)); },
    anime: function (malId) {
      return fetchJson('/api/anime/' + malId + '?audio=' + encodeURIComponent(audioPrefQuery()));
    },
    source: function (url) { return fetchJson('/api/source?url=' + encodeURIComponent(url)); },
    stream: function (episodeUrl) { return fetchJson('/api/stream?url=' + encodeURIComponent(episodeUrl)); },
    abs: abs,
    resolveProxy: function (proxyPath) {
      return abs(proxyPath);
    },
  };
})();