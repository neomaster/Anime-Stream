# Compila o APK Android do Anime Stream
param(
  [ValidateSet('debug', 'release')]
  [string]$Variant = 'debug'
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$dist = Join-Path $root "dist"
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:USERPROFILE "Android\Sdk" }

function Ensure-GradleWrapper {
  $jar = Join-Path $root "gradle\wrapper\gradle-wrapper.jar"
  if (Test-Path $jar) { return }

  Write-Host "Baixando Gradle Wrapper..." -ForegroundColor Cyan
  $url = "https://raw.githubusercontent.com/gradle/gradle/v8.4.0/gradle/wrapper/gradle-wrapper.jar"
  New-Item -ItemType Directory -Force -Path (Split-Path $jar) | Out-Null
  Invoke-WebRequest -Uri $url -OutFile $jar -UseBasicParsing
}

function Ensure-AndroidSdk {
  $cmdline = Join-Path $sdkRoot "cmdline-tools\latest"
  $sdkmanager = Join-Path $cmdline "bin\sdkmanager.bat"

  if (-not (Test-Path $sdkmanager)) {
    Write-Host "Instalando Android SDK Command-line Tools..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null

    $zipUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
    $zipPath = Join-Path $env:TEMP "android-cmdline-tools.zip"
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

    $extract = Join-Path $env:TEMP "android-cmdline-tools"
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Expand-Archive -Path $zipPath -DestinationPath $extract -Force

    $dest = Join-Path $sdkRoot "cmdline-tools\latest"
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
    Move-Item (Join-Path $extract "cmdline-tools") $dest
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
  }

  $env:ANDROID_HOME = $sdkRoot
  $env:ANDROID_SDK_ROOT = $sdkRoot

  Write-Host "Instalando pacotes SDK (platform-tools, build-tools, platform)..." -ForegroundColor Cyan
  $packages = @(
    "platform-tools",
    "platforms;android-34",
    "build-tools;34.0.0"
  )

  foreach ($pkg in $packages) {
    & $sdkmanager --sdk_root=$sdkRoot $pkg | Out-Null
  }

  $yes = "y`n" * 20
  $yes | & $sdkmanager --sdk_root=$sdkRoot --licenses 2>&1 | Out-Null
}

function Get-CloudUrlFromProject {
  $cloudFile = Join-Path (Split-Path $root -Parent) "cloud-url.txt"
  if (Test-Path $cloudFile) {
    return (Get-Content $cloudFile -Raw).Trim()
  }
  return $null
}

function Get-BuildServerAddress {
  $cloud = Get-CloudUrlFromProject
  if ($cloud) {
    return ($cloud -replace '^https?://', '').TrimEnd('/')
  }

  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.PrefixOrigin -ne 'WellKnown' -and
    $_.InterfaceAlias -notmatch 'Nord|VPN|TAP|Loopback'
  } | ForEach-Object { $_.IPAddress } | Sort-Object -Unique

  $wifi = $ips | Where-Object { $_ -like '192.168.*' }
  $ip = if ($wifi) { $wifi | Select-Object -First 1 } else { $ips | Where-Object { $_ -notlike '169.254.*' -and $_ -notlike '10.5.*' } | Select-Object -First 1 }
  if (-not $ip) { $ip = '192.168.1.2' }
  return "${ip}:3456"
}

function Write-BuildConfig {
  param([string]$ServerAddress)
  $configPath = Join-Path $root "www\js\build-config.js"
  $cloud = Get-CloudUrlFromProject
  $isCloud = [bool]$cloud

  if ($isCloud) {
    $hostOnly = ($ServerAddress -replace '^https?://', '').TrimEnd('/')
    $content = @"
// Gerado automaticamente pelo build-apk.ps1 em $(Get-Date -Format 'yyyy-MM-dd HH:mm')
var BuildConfig = (function () {
  return {
    CLOUD_MODE: true,
    DEFAULT_SERVER: '$hostOnly',
    DISCOVERY_ENABLED: false,
    CONNECT_RETRIES: 6,
    TIMEOUT_MS: 90000,
    PROBE_TIMEOUT_MS: 90000,
  };
})();
"@
    Write-Host "Servidor na nuvem embutido no APK: $hostOnly" -ForegroundColor Green
  } else {
    $content = @"
// Gerado automaticamente pelo build-apk.ps1 em $(Get-Date -Format 'yyyy-MM-dd HH:mm')
var BuildConfig = (function () {
  return {
    CLOUD_MODE: false,
    DEFAULT_SERVER: '$ServerAddress',
    DISCOVERY_ENABLED: true,
    CONNECT_RETRIES: 4,
    TIMEOUT_MS: 25000,
    PROBE_TIMEOUT_MS: 2500,
  };
})();
"@
    Write-Host "Servidor local embutido no APK: $ServerAddress" -ForegroundColor Green
  }

  Set-Content -Path $configPath -Value $content -Encoding UTF8
}

Write-Host ""
Write-Host "=== Anime Stream - Build APK ===" -ForegroundColor Cyan

$serverAddress = Get-BuildServerAddress
Write-BuildConfig -ServerAddress $serverAddress

& (Join-Path $root "generate-icons.ps1")
Ensure-GradleWrapper
Ensure-AndroidSdk

$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:JAVA_HOME = $env:JAVA_HOME

Push-Location $root
try {
  $task = if ($Variant -eq 'release') { 'assembleRelease' } else { 'assembleDebug' }
  Write-Host "Compilando ($task)..." -ForegroundColor Cyan
  & .\gradlew.bat $task --no-daemon --stacktrace
  if ($LASTEXITCODE -ne 0) { throw "Gradle falhou com codigo $LASTEXITCODE" }

  $apkDir = Join-Path $root "app\build\outputs\apk\$Variant"
  $apk = Get-ChildItem -Path $apkDir -Filter "*.apk" | Select-Object -First 1
  if (-not $apk) { throw "APK nao encontrado em $apkDir" }

  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  $out = Join-Path $dist "AnimeStream.apk"
  Copy-Item $apk.FullName $out -Force

  Write-Host ""
  Write-Host "APK criado: $out" -ForegroundColor Green
  Write-Host "Tamanho: $([math]::Round($apk.Length / 1MB, 2)) MB" -ForegroundColor Green
} finally {
  Pop-Location
}