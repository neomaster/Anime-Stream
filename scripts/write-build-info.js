#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

function resolveCommit() {
  if (process.env.RENDER_GIT_COMMIT) return process.env.RENDER_GIT_COMMIT.slice(0, 12);
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const info = {
  version: pkg.version,
  commit: resolveCommit(),
  builtAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(root, 'build-info.json'), JSON.stringify(info, null, 2));
console.log('build-info:', info.commit, info.version);