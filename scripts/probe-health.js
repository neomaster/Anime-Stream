#!/usr/bin/env node
const base = (process.argv[2] || process.env.CLOUD_URL || '').trim().replace(/\/+$/, '');
if (!base) {
  console.error('Uso: node scripts/probe-health.js <url>');
  console.error('Ex.: node scripts/probe-health.js https://anime-stream-xxxx.onrender.com');
  process.exit(1);
}

const url = /^https?:\/\//i.test(base) ? base : `https://${base}`;
const health = `${url}/api/health`;

(async () => {
  const res = await fetch(health, { signal: AbortSignal.timeout(120000) });
  const body = await res.text();
  console.log('URL:', url);
  console.log('HTTP:', res.status);
  try {
    const json = JSON.parse(body);
    console.log(JSON.stringify(json, null, 2));
    if (json.status === 'ok' && json.cloud && json.altSources) process.exit(0);
    if (json.status === 'ok') process.exit(0);
  } catch {
    console.log(body.slice(0, 400));
  }
  process.exit(1);
})().catch((err) => {
  console.error('Falha:', err.message);
  process.exit(1);
});