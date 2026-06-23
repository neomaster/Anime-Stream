/* global tizen */
var ServerConfig = (function () {
  var STORAGE_KEY = 'anime_stream_server';
  var DEFAULT_PORT = '3456';

  function getRaw() {
    try {
      if (typeof tizen !== 'undefined' && tizen.preference) {
        return tizen.preference.getValue(STORAGE_KEY);
      }
    } catch (e) { /* ignore */ }
    return localStorage.getItem(STORAGE_KEY) || '';
  }

  function setRaw(url) {
    var clean = (url || '').replace(/\/+$/, '');
    try {
      if (typeof tizen !== 'undefined' && tizen.preference) {
        tizen.preference.setValue(STORAGE_KEY, clean);
        return;
      }
    } catch (e) { /* ignore */ }
    localStorage.setItem(STORAGE_KEY, clean);
  }

  function normalizeInput(input) {
    var v = (input || '').trim();
    v = v.replace(/^https?:\/\//i, '');
    v = v.replace(/\/+$/, '');
    return v;
  }

  function parseAddress(raw) {
    var v = normalizeInput(raw);
    if (!v) return null;

    var withPort = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/);
    if (withPort) {
      return { o1: withPort[1], o2: withPort[2], o3: withPort[3], o4: withPort[4], port: withPort[5] };
    }

    var ipOnly = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipOnly) {
      return { o1: ipOnly[1], o2: ipOnly[2], o3: ipOnly[3], o4: ipOnly[4], port: DEFAULT_PORT };
    }

    return null;
  }

  function composeAddress(o1, o2, o3, o4, port) {
    var parts = [o1, o2, o3, o4].map(function (p) {
      return String(p || '').replace(/\D/g, '');
    });
    if (parts.some(function (p) { return !p; })) return '';
    for (var i = 0; i < 4; i++) {
      var n = parseInt(parts[i], 10);
      if (n > 255) return '';
      parts[i] = String(n);
    }
    var p = String(port || DEFAULT_PORT).replace(/\D/g, '') || DEFAULT_PORT;
    return parts.join('.') + ':' + p;
  }

  function readForm() {
    function val(id) {
      var el = document.getElementById(id);
      return el ? el.value : '';
    }
    return composeAddress(val('ip1'), val('ip2'), val('ip3'), val('ip4'), val('portInput'));
  }

  function fillForm(raw) {
    var parsed = parseAddress(raw);
    if (!parsed) return;
    var map = { ip1: parsed.o1, ip2: parsed.o2, ip3: parsed.o3, ip4: parsed.o4, portInput: parsed.port };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = map[id];
    });
    updatePreview();
  }

  function updatePreview() {
    var el = document.getElementById('ipPreview');
    if (!el) return;
    var addr = readForm();
    el.textContent = addr || '—';
  }

  function bindForm() {
    var octets = ['ip1', 'ip2', 'ip3', 'ip4'];
    var ids = octets.concat(['portInput']);

    ids.forEach(function (id, idx) {
      var el = document.getElementById(id);
      if (!el) return;

      el.addEventListener('input', function () {
        el.value = el.value.replace(/\D/g, '');
        if (octets.indexOf(id) >= 0 && el.value.length >= 3) {
          var next = ids[idx + 1];
          if (next) document.getElementById(next).focus();
        }
        updatePreview();
      });

      el.addEventListener('focus', function () {
        setTimeout(function () { el.select(); }, 0);
      });
    });

    updatePreview();
  }

  return {
    get: function () { return getRaw(); },
    set: function (url) { setRaw(url); },
    getBaseUrl: function () {
      var base = getRaw();
      if (!base) return '';
      if (!/^https?:\/\//i.test(base)) base = 'http://' + base;
      return base.replace(/\/+$/, '');
    },
    isConfigured: function () { return !!getRaw(); },
    normalizeInput: normalizeInput,
    parseAddress: parseAddress,
    composeAddress: composeAddress,
    readForm: readForm,
    fillForm: fillForm,
    bindForm: bindForm,
    updatePreview: updatePreview,
    DEFAULT_PORT: DEFAULT_PORT,
  };
})();