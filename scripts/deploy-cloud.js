#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cloudFile = path.join(root, 'cloud-url.txt');
const skipApk = process.argv.includes('--skip-apk');
const skipDeploy = process.argv.includes('--skip-deploy');
const cloudUrlArg = process.argv.find((a) => a.startsWith('--url='));
const hookArg = process.argv.find((a) => a.startsWith('--hook='));

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
    ...opts,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

function saveCloudUrl(url) {
  const clean = url.trim().replace(/\/+$/, '');
  const withProto = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  fs.writeFileSync(cloudFile, withProto, 'utf8');
  process.env.CLOUD_URL = withProto;
  console.log('URL na nuvem:', withProto);
  return withProto;
}

function triggerRenderDeploy(hookUrl) {
  const hook = hookUrl || process.env.RENDER_DEPLOY_HOOK_URL;
  if (!hook) {
    console.log('\nDeploy automático: conecte o repositório GitHub ao Render (Blueprint render.yaml).');
    console.log('Ou defina RENDER_DEPLOY_HOOK_URL / --hook=<url> para disparar deploy manual.\n');
    return;
  }

  console.log('\n=== Deploy Render (hook) ===\n');
  const result = spawnSync('curl', ['-fsS', hook], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || 'Falha ao acionar deploy hook');
    process.exit(result.status || 1);
  }
  console.log(result.stdout || 'Deploy acionado.');
}

if (cloudUrlArg) {
  saveCloudUrl(cloudUrlArg.split('=').slice(1).join('='));
}

if (!skipDeploy) {
  if (hookArg) {
    triggerRenderDeploy(hookArg.split('=').slice(1).join('='));
  } else {
    triggerRenderDeploy();
  }
}

if (!skipApk && fs.existsSync(cloudFile)) {
  require('./write-build-config.js');
  console.log('\nPara gerar APK: npm run build:apk\n');
}

console.log('Servidor na nuvem. Inicie localmente com: npm run start:cloud');