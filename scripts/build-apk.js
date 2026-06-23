#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const androidRoot = path.join(root, 'android-app');
const isWin = process.platform === 'win32';
const gradlew = path.join(androidRoot, isWin ? 'gradlew.bat' : 'gradlew');

require('./write-build-config.js');

console.log('\n=== Build APK ===\n');

const build = spawnSync(gradlew, ['assembleDebug'], {
  cwd: androidRoot,
  stdio: 'inherit',
  shell: isWin,
});

if (build.status !== 0) {
  console.error('\nBuild falhou. Instale Android SDK e execute: cd android-app && ./gradlew assembleDebug');
  process.exit(build.status || 1);
}

console.log('\nAPK: android-app/app/build/outputs/apk/debug/app-debug.apk');
console.log('Copia: android-app/dist/AnimeStream.apk (se configurado no Gradle)\n');