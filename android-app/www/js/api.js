var Api = (function () {
  function base() {
    var b = ServerConfig.getBaseUrl();
    if (!b) throw new Error('Servidor nao configurado');
    return b;
  }

  function abs(path) {
    if (/^https?:\/\//i.test(path)) return path;
    return base() + (path.charAt(0) === '/' ? path : '/' + path);
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    var ms = timeoutMs || ServerConfig.getTimeoutMs();
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('Tempo esgotado. Verifique se o PC esta ligado e na mesma rede Wi-Fi.'));
      }, ms);

      fetch(url, options).then(function (res) {
        clearTimeout(timer);
        resolve(res);
      }).catch(function (err) {
        clearTimeout(timer);
        if (err.message && err.message.indexOf('Tempo esgotado') >= 0) reject(err);
        else reject(new Error(
          'Sem conexao com o servidor. Confirme npm start no PC e o mesmo Wi-Fi.'
        ));
      });
    });
  }

  function fetchJson(path, timeoutMs) {
    return fetchWithTimeout(abs(path), {
      headers: { Accept: 'application/json' },
    }, timeoutMs).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (err) {
          throw new Error(err.error || ('Erro ' + res.status));
        });
      }
      return res.json();
    });
  }

  function audioPrefQuery() {
    return (typeof StorageSafe !== 'undefined' && StorageSafe.safeGet('anime_stream_audio_pref', 'legendado')) || 'legendado';
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