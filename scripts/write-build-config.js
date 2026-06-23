#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const outPath = path.join(root, 'android-app', 'www', 'js', 'build-config.js');

function readCloudUrl() {
  if (process.env.CLOUD_URL) return process.env.CLOUD_URL.trim();
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.trim();

  const cloudFile = path.join(root, 'cloud-url.txt');
  if (fs.existsSync(cloudFile)) {
    return fs.readFileSync(cloudFile, 'utf8').trim();
  }
  return '';
}

function getLanAddress() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const [name, iface] of Object.entries(nets)) {
    if (/nord|vpn|tap|loopback|virtual/i.test(name)) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
        ips.push(addr.address);
      }
    }
  }
  const wifi = ips.find((ip) => ip.startsWith('192.168.'));
  const ip = wifi || ips.find((ip) => !ip.startsWith('10.5.')) || '192.168.1.2';
  return `${ip}:3456`;
}

function normalizeHost(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/^https?:\/\//, '');
}

const cloudUrl = readCloudUrl();
const isCloud = process.env.CLOUD_MODE === 'true' || !!cloudUrl;
const server = isCloud ? normalizeHost(cloudUrl) : getLanAddress();

const content = `// Gerado por scripts/write-build-config.js em ${new Date().toISOString().slice(0, 16).replace('T', ' ')}
var BuildConfig = (function () {
  return {
    CLOUD_MODE: ${isCloud},
    DEFAULT_SERVER: '${server}',
    DISCOVERY_ENABLED: ${isCloud ? 'false' : 'true'},
    CONNECT_RETRIES: ${isCloud ? 6 : 4},
    TIMEOUT_MS: ${isCloud ? 90000 : 25000},
    PROBE_TIMEOUT_MS: ${isCloud ? 90000 : 2500},
  };
})();
`;

fs.writeFileSync(outPath, content, 'utf8');
console.log('build-config.js →', server, isCloud ? '(nuvem)' : '(LAN)');