const crypto = require('crypto');
const { fillRandomBytes, randomHex, randomBase64Url } = require('./secure-random');

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
const DISPATCH_TTL_MS = 90 * 1000;

const vault = new Map();
const dispatch = new Map();

function vaultKey() {
  const secret = process.env.VAULT_SECRET || 'anime-stream-magnet-vault-dev-key';
  return crypto.scryptSync(secret, 'anime-stream-vault-salt-v1', 32);
}

function seal(plaintext) {
  const key = vaultKey();
  const iv = fillRandomBytes(new Uint8Array(12));
  const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(iv));
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

function unseal(blob) {
  const key = vaultKey();
  const buf = Buffer.from(blob, 'base64url');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function purgeExpired() {
  const now = Date.now();
  for (const [ref, entry] of vault) {
    if (entry.expiresAt <= now) vault.delete(ref);
  }
  for (const [token, entry] of dispatch) {
    if (entry.expiresAt <= now) dispatch.delete(token);
  }
}

function storePayload(payload, meta = {}) {
  purgeExpired();
  const ref = randomHex(18);
  vault.set(ref, {
    sealed: seal(JSON.stringify(payload)),
    meta,
    createdAt: Date.now(),
    expiresAt: Date.now() + DEFAULT_TTL_MS,
  });
  return ref;
}

function readPayload(ref) {
  purgeExpired();
  const entry = vault.get(ref);
  if (!entry || entry.expiresAt <= Date.now()) {
    vault.delete(ref);
    return null;
  }
  try {
    return JSON.parse(unseal(entry.sealed));
  } catch {
    vault.delete(ref);
    return null;
  }
}

function updatePayload(ref, payload, meta = {}) {
  purgeExpired();
  const entry = vault.get(ref);
  if (!entry || entry.expiresAt <= Date.now()) {
    vault.delete(ref);
    return false;
  }
  entry.sealed = seal(JSON.stringify(payload));
  entry.meta = { ...entry.meta, ...meta };
  return true;
}

function createDispatchToken(ref, clientHint = '') {
  const payload = readPayload(ref);
  if (!payload) return null;

  const token = randomBase64Url(24);
  dispatch.set(token, {
    ref,
    clientHint: String(clientHint).slice(0, 64),
    expiresAt: Date.now() + DISPATCH_TTL_MS,
    uses: 0,
    maxUses: 1,
  });
  return token;
}

function consumeDispatch(token) {
  purgeExpired();
  const entry = dispatch.get(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    dispatch.delete(token);
    return null;
  }
  if (entry.uses >= entry.maxUses) {
    dispatch.delete(token);
    return null;
  }
  entry.uses += 1;
  const payload = readPayload(entry.ref);
  if (!payload) {
    dispatch.delete(token);
    return null;
  }
  dispatch.delete(token);
  return payload;
}

module.exports = {
  storePayload,
  readPayload,
  updatePayload,
  createDispatchToken,
  consumeDispatch,
  purgeExpired,
};