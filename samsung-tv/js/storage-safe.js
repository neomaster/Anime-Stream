var StorageSafe = (function () {
  var memory = {};
  var mode = 'localStorage';

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

  function switchToMemory() {
    mode = 'memory';
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
      switchToMemory();
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
      switchToMemory();
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
    return safeSet(key, JSON.stringify(value));
  }

  if (!probeLocalStorage()) switchToMemory();

  return {
    safeGet: safeGet,
    safeSet: safeSet,
    safeGetJson: safeGetJson,
    safeSetJson: safeSetJson,
    getStorageMode: function () { return mode; },
  };
})();