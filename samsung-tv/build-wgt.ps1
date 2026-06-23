# Empacota o app Samsung Tizen (.wgt)
# Requer Tizen Studio CLI no PATH, ou gera um pacote básico via ZIP.

param(
  [string]$CertProfile = "",
  [switch]$ZipOnly
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$outDir = Join-Path $root "dist"
$wgtName = "AnimeStream.wgt"

if (-not (Test-Path (Join-Path $root "icon.png"))) {
  Write-Host "Gerando icon.png..." -ForegroundColor Yellow
  & (Join-Path $root "generate-icon.ps1")
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$files = @(
  "config.xml",
  "index.html",
  "icon.png",
  "css\tv.css",
  "js\config.js",
  "js\api.js",
  "js\remote.js",
  "js\player.js",
  "js\app.js"
)

foreach ($f in $files) {
  if (-not (Test-Path (Join-Path $root $f))) {
    throw "Arquivo obrigatório ausente: $f"
  }
}

$tizen = Get-Command tizen -ErrorAction SilentlyContinue

if (-not $ZipOnly -and $tizen -and $CertProfile) {
  Write-Host "Empacotando com Tizen CLI (perfil: $CertProfile)..." -ForegroundColor Cyan
  Push-Location $root
  try {
    tizen package -t wgt -s $CertProfile -- $root
    $built = Get-ChildItem -Path $root -Filter "*.wgt" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($built) {
      Move-Item -Force $built.FullName (Join-Path $outDir $wgtName)
      Write-Host "Pacote criado: $(Join-Path $outDir $wgtName)" -ForegroundColor Green
      exit 0
    }
  } finally {
    Pop-Location
  }
}

# Fallback: ZIP renomeado (útil para instalação via Tizen Studio import)
Write-Host "Criando pacote ZIP (.wgt)..." -ForegroundColor Cyan
$zipPath = Join-Path $outDir $wgtName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')

foreach ($f in $files) {
  $full = Join-Path $root $f
  $entryName = $f -replace '\\', '/'
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $full, $entryName) | Out-Null
}

$zip.Dispose()
Write-Host "Pacote criado: $zipPath" -ForegroundColor Green

if (-not $tizen) {
  Write-Host "`nTizen CLI não encontrado. Para assinar e instalar na TV:" -ForegroundColor Yellow
  Write-Host "  1. Instale Tizen Studio: https://developer.samsung.com/tizen" -ForegroundColor Yellow
  Write-Host "  2. Importe a pasta samsung-tv como Web Project" -ForegroundColor Yellow
  Write-Host "  3. Crie certificado Samsung e empacote via IDE" -ForegroundColor Yellow
} elseif (-not $CertProfile) {
  Write-Host "`nPara assinar com Tizen CLI:" -ForegroundColor Yellow
  Write-Host "  .\build-wgt.ps1 -CertProfile SEU_PERFIL" -ForegroundColor Yellow
}