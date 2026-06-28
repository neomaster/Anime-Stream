# Publica o Anime Stream na nuvem (Render ou Railway) e atualiza o APK
param(
  [ValidateSet('render', 'railway', 'auto')]
  [string]$Provider = 'render',
  [string]$CloudUrl = '',
  [switch]$SkipApk,
  [switch]$SkipDeploy
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$cloudUrlFile = Join-Path $root "cloud-url.txt"

function Write-CloudUrl {
  param([string]$Url)
  $clean = $Url.Trim().TrimEnd('/')
  if ($clean -notmatch '^https?://') { $clean = "https://$clean" }
  Set-Content -Path $cloudUrlFile -Value $clean -Encoding UTF8
  Write-Host "URL na nuvem: $clean" -ForegroundColor Green
  return $clean
}

function Read-CloudUrl {
  if ($CloudUrl) { return Write-CloudUrl $CloudUrl }
  if (Test-Path $cloudUrlFile) {
    return (Get-Content $cloudUrlFile -Raw).Trim()
  }
  return $null
}

function Update-AndroidBuildConfig {
  param([string]$Url)
  $hostOnly = ($Url -replace '^https?://', '').TrimEnd('/')
  $configPath = Join-Path $root "android-app\www\js\build-config.js"
  $content = @"
// Gerado automaticamente — servidor na nuvem
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
  Set-Content -Path $configPath -Value $content -Encoding UTF8
  Write-Host "APK configurado para: $hostOnly" -ForegroundColor Green
}

function Deploy-Railway {
  Write-Host ""
  Write-Host "=== Deploy Railway ===" -ForegroundColor Cyan
  Write-Host "Se necessario, faca login no navegador que abrir." -ForegroundColor Yellow

  Push-Location $root
  try {
    npx @railway/cli whoami 2>$null
    if ($LASTEXITCODE -ne 0) {
      npx @railway/cli login
      if ($LASTEXITCODE -ne 0) { throw "Login Railway cancelado ou falhou" }
    }

    if (-not (Test-Path (Join-Path $root ".railway"))) {
      npx @railway/cli init --name anime-stream
    }

    $env:CLOUD_MODE = "true"
    npx @railway/cli up --detach
    if ($LASTEXITCODE -ne 0) { throw "railway up falhou" }

    $domain = npx @railway/cli domain 2>&1 | Out-String
    if ($domain -match '(https?://[^\s]+)') {
      return Write-CloudUrl $Matches[1]
    }

    $status = npx @railway/cli status --json 2>&1 | Out-String
    if ($status -match '"url"\s*:\s*"([^"]+)"') {
      return Write-CloudUrl $Matches[1]
    }

    throw "Deploy concluido, mas URL nao detectada. Execute: npx @railway/cli domain"
  } finally {
    Pop-Location
  }
}

function Show-RenderInstructions {
  $url = Read-CloudUrl
  Write-Host ""
  Write-Host "=== Deploy Render (gratuito) ===" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "1. Crie conta em https://render.com (gratis)" -ForegroundColor White
  Write-Host "2. Faca push do codigo: gh auth login && npm run publish:github" -ForegroundColor White
  Write-Host "3. Dashboard > New + > Blueprint > conecte github.com/neomaster/Anime-Stream" -ForegroundColor White
  Write-Host "   (ou Web Service manual:)" -ForegroundColor DarkGray
  Write-Host "   - Build:  npm ci --omit=dev" -ForegroundColor DarkGray
  Write-Host "   - Start:  node server.js" -ForegroundColor DarkGray
  Write-Host "   - Health: /api/health" -ForegroundColor DarkGray
  Write-Host "   - Env:    CLOUD_MODE=true" -ForegroundColor DarkGray
  Write-Host "4. Apos deploy, copie a URL (ex: https://anime-stream.onrender.com)" -ForegroundColor White
  Write-Host "5. Execute:" -ForegroundColor White
  Write-Host "   npm run deploy:cloud -- -CloudUrl https://SUA-URL.onrender.com -SkipDeploy" -ForegroundColor Yellow
  Write-Host ""
  if ($url) {
    Write-Host "URL atual salva: $url" -ForegroundColor Green
  }
}

function Test-CloudHealth {
  param([string]$Url)
  $health = "$($Url.TrimEnd('/'))/api/health"
  Write-Host "Testando $health ..." -ForegroundColor Cyan
  $res = Invoke-WebRequest -Uri $health -UseBasicParsing -TimeoutSec 120
  $json = $res.Content | ConvertFrom-Json
  Write-Host "OK - versao $($json.version) cloud=$($json.cloud)" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Anime Stream - Deploy Nuvem ===" -ForegroundColor Cyan

if (-not $SkipDeploy) {
  $deployedUrl = $null
  if ($Provider -eq 'railway') {
    try {
      $deployedUrl = Deploy-Railway
    } catch {
      Write-Host "Railway: $($_.Exception.Message)" -ForegroundColor Yellow
      throw
    }
  } else {
    Show-RenderInstructions
    if (-not (Read-CloudUrl)) {
      Write-Host ""
      Write-Host "Nenhuma URL na nuvem configurada ainda." -ForegroundColor Yellow
      Write-Host "Repositorio GitHub: https://github.com/neomaster/Anime-Stream" -ForegroundColor Cyan
      exit 1
    }
  }
}

$url = Read-CloudUrl
if (-not $url) { throw "Informe -CloudUrl ou faca deploy primeiro" }

try {
  Test-CloudHealth $url
} catch {
  Write-Host "Aviso: servidor ainda iniciando (Render free demora ~1 min no 1o acesso)." -ForegroundColor Yellow
  Write-Host $_.Exception.Message -ForegroundColor DarkGray
}

Update-AndroidBuildConfig $url

if (-not $SkipApk) {
  & (Join-Path $root "android-app\build-apk.ps1")
}

Write-Host ""
Write-Host "Pronto! Instale o APK e abra — conecta automaticamente a:" -ForegroundColor Green
Write-Host "  $url" -ForegroundColor Yellow