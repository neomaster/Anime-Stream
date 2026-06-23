var AltSources = (function () {
  var STREAM_WAIT_MS = 120000;
  var STREAM_POLL_MS = 800;

  function formatSeederLabel(seeders, leechers, phase) {
    phase = phase || 'found';
    var s = seeders != null && seeders !== '' ? Number(seeders) : null;
    var l = leechers != null && leechers !== '' ? Number(leechers) : null;
    if (s == null || isNaN(s)) {
      return phase === 'scan' ? 'Varrendo fontes...' : 'Magnet';
    }
    var parts = [s + ' seeder' + (s === 1 ? '' : 's')];
    if (l != null && !isNaN(l)) parts.push(l + ' leecher' + (l === 1 ? '' : 's'));
    var suffix = phase === 'scan' ? ' encontrados...' : phase === 'resolve' ? ' · resolvendo...' : ' · conectando...';
    return parts.join(', ') + suffix;
  }

  function fetchEpisodeMagnetCatalog(malId, episode) {
    return fetch(Api.abs('/api/alt/episode?malId=' + encodeURIComponent(malId) + '&ep=' + encodeURIComponent(episode)), {
      headers: { Accept: 'application/json' },
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || ('Erro ' + res.status));
          err.code = data.code || ('HTTP_' + res.status);
          throw err;
        }
        return data;
      });
    });
  }

  function openEpisodeMagnet(malId, episode, ref) {
    return fetch(Api.abs('/api/alt/open'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(ref ? { ref: ref } : { malId: malId, episode: episode }),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || ('Erro ' + res.status));
          err.code = data.code || ('HTTP_' + res.status);
          err.status = res.status;
          err.tried = data.tried;
          err.triedSources = data.triedSources;
          err.seeders = data.seeders;
          err.leechers = data.leechers;
          err.episode = data.episode;
          throw err;
        }
        if (!data.streamUrl) {
          throw new Error('Servidor sem URL de streaming');
        }
        return data;
      });
    });
  }

  function waitForTorrentStream(statusUrl, onProgress) {
    var start = Date.now();

    function poll() {
      if (Date.now() - start >= STREAM_WAIT_MS) {
        return Promise.reject(new Error('Tempo esgotado aguardando torrent'));
      }
      return fetch(Api.abs(statusUrl), { headers: { Accept: 'application/json' } })
        .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
        .then(function (out) {
          if (out.data.status === 'error') {
            throw new Error(out.data.error || 'Erro no torrent');
          }
          if (out.data.ready) return out.data;
          var pct = Math.round((out.data.progress || 0) * 100);
          if (onProgress) onProgress(pct, out.data.peers || 0, out.data.status);
          return new Promise(function (r) { setTimeout(r, STREAM_POLL_MS); }).then(poll);
        });
    }

    return poll();
  }

  function playMagnetStream(opts) {
    var player = opts.videoEl;
    var chain = opts.statusUrl
      ? waitForTorrentStream(opts.statusUrl, opts.onProgress)
      : Promise.resolve();

    return chain.then(function () {
      return new Promise(function (resolve, reject) {
        function onLoaded() {
          player.removeEventListener('loadeddata', onLoaded);
          player.removeEventListener('error', onErr);
          if (opts.onReady) opts.onReady();
          resolve();
        }
        function onErr() {
          player.removeEventListener('loadeddata', onLoaded);
          player.removeEventListener('error', onErr);
          reject(new Error('Erro ao reproduzir stream'));
        }
        player.addEventListener('loadeddata', onLoaded);
        player.addEventListener('error', onErr);
        player.src = Api.abs(opts.streamUrl);
        player.load();
        player.play().catch(function () {});
      });
    });
  }

  function formatPeers(seeders, leechers) {
    var s = seeders != null && seeders !== '' ? Number(seeders) : null;
    var l = leechers != null && leechers !== '' ? Number(leechers) : null;
    if ((s == null || isNaN(s)) && (l == null || isNaN(l))) return '';
    var parts = [];
    if (s != null && !isNaN(s)) parts.push(s + ' seeder' + (s === 1 ? '' : 's'));
    if (l != null && !isNaN(l)) parts.push(l + ' leecher' + (l === 1 ? '' : 's'));
    return parts.length ? ' (' + parts.join(', ') + ')' : '';
  }

  function formatTriedSources(triedSources) {
    if (!Array.isArray(triedSources) || !triedSources.length) return '';
    var lines = triedSources.slice(0, 4).map(function (t) {
      var peers = formatPeers(t.seeders, t.leechers);
      var name = t.label || 'fonte ofuscada';
      if (t.ok) return name + peers;
      return name + peers + ': ' + (t.code || 'falhou');
    });
    return ' Fontes tentadas: ' + lines.join('; ') + '.';
  }

  function formatMagnetError(err) {
    if (!err) return 'Erro ao abrir magnet';

    var peers = formatPeers(err.seeders, err.leechers);
    var tried = formatTriedSources(err.triedSources);

    if (err.code === 'INDEX_UNAVAILABLE' || err.status === 503) {
      return 'Indices alternativos indisponiveis no momento.' + tried + ' Tente novamente ou use Assistir online.';
    }
    if (err.code === 'NOT_FOUND' || err.status === 404) {
      var ep = err.episode ? ' (ep. ' + err.episode + ')' : '';
      return err.message || ('Nenhum torrent para este episodio' + ep + '.' + tried);
    }
    if (err.code === 'TORRENT_TIMEOUT' || err.status === 504) {
      return 'Torrent demorou para responder' + peers + '.' + tried;
    }
    if (err.code === 'MAGNET_RESOLVE_FAILED' || err.code === 'MAGNET_NOT_FOUND' || err.code === 'MAGNET_INVALID') {
      return 'Nao foi possivel obter o magnet' + peers + '.' + tried;
    }
    if (err.code === 'UNSUPPORTED_FORMAT' || err.code === 'NO_VIDEO_FILE') {
      return (err.message || 'Torrent sem video compativel') + peers + '.';
    }
    if (err.message && peers) return err.message + peers + '.' + tried;
    return err.message || ('Falha no streaming magnet' + peers + '.' + tried);
  }

  function updateMagnetPickerUI(buttonLabel, statusLabel, loading) {
    var magnetBtn = document.getElementById('pickerMagnetBtn');
    var statusEl = document.getElementById('pickerMagnetStatus');
    if (magnetBtn) {
      magnetBtn.disabled = !!loading;
      if (buttonLabel) magnetBtn.textContent = buttonLabel;
    }
    if (statusEl) {
      if (statusLabel) {
        statusEl.hidden = false;
        statusEl.textContent = statusLabel;
      } else {
        statusEl.hidden = true;
        statusEl.textContent = '';
      }
    }
  }

  function closePicker() {
    var picker = document.getElementById('episodePicker');
    if (picker) picker.hidden = true;
    updateMagnetPickerUI('Magnet', '', false);
  }

  function showEpisodePicker(opts) {
    var picker = document.getElementById('episodePicker');
    var epLabel = document.getElementById('pickerEpNum');
    var streamBtn = document.getElementById('pickerStreamBtn');
    var magnetBtn = document.getElementById('pickerMagnetBtn');
    var cancelBtn = document.getElementById('pickerCancelBtn');
    var backdrop = picker ? picker.querySelector('.episode-picker-backdrop') : null;

    if (!picker || !streamBtn || !magnetBtn) {
      opts.onStream();
      return;
    }

    if (epLabel) epLabel.textContent = String(opts.episode.number);
    updateMagnetPickerUI('Magnet', '', false);
    picker.hidden = false;

    streamBtn.onclick = function () { closePicker(); opts.onStream(); };

    magnetBtn.onclick = function () {
      updateMagnetPickerUI('Varrendo fontes...', 'Buscando melhor fonte...', true);
      opts.onMagnet({
        onMagnetProgress: function (payload) {
          updateMagnetPickerUI(payload.buttonLabel, payload.statusLabel, true);
        },
        onPickerClose: closePicker,
      }).catch(function (err) {
        updateMagnetPickerUI('Magnet', '', false);
        if (opts.onError) opts.onError(err);
      });
    };

    cancelBtn.onclick = closePicker;
    if (backdrop) backdrop.onclick = closePicker;
  }

  return {
    fetchEpisodeMagnetCatalog: fetchEpisodeMagnetCatalog,
    formatSeederLabel: formatSeederLabel,
    openEpisodeMagnet: openEpisodeMagnet,
    playMagnetStream: playMagnetStream,
    formatMagnetError: formatMagnetError,
    showEpisodePicker: showEpisodePicker,
  };
})();