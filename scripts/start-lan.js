#!/usr/bin/env node
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const PORT = parseInt(process.env.PORT, 10) || 3456;
const root = path.join(__dirname, '..');

function getLanIPs() {
  const ips = [];
  for (const [name, iface] of Object.entries(os.networkInterfaces())) {
    if (/nord|vpn|tap|loopback|virtual/i.test(name)) continue;
    for (const addr of iface) {
      if (
        addr.family === 'IPv4' &&
        !addr.internal &&
        !addr.address.startsWith('169.254.')
      ) {
        ips.push(addr.address);
      }
    }
  }
  const unique = [...new Set(ips)];
  const wifi = unique.filter((ip) => ip.startsWith('192.168.') || ip.startsWith('10.'));
  return (wifi.length ? wifi : unique).sort();
}

console.log('\n=== Anime Stream — rede local ===\n');
const ips = getLanIPs();
if (ips.length) {
  console.log('Acesse na rede:');
  ips.forEach((ip) => console.log(`  http://${ip}:${PORT}`));
} else {
  console.log(`  http://SEU-IP-LOCAL:${PORT}`);
}
console.log(`\nLocal: http://localhost:${PORT}`);
console.log('\nSe o celular/TV não conectar, libere a porta', PORT, 'no firewall do Windows.');
console.log('Pressione Ctrl+C para encerrar.\n');

spawn(process.execPath, [path.join(root, 'server.js')], {
  stdio: 'inherit',
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
});