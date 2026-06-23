# Instala o .wgt na Samsung TV via sdb (Tizen Studio Device Manager)
param(
  [string]$TvIp = "",
  [string]$WgtPath = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$dist = Join-Path $root "dist\AnimeStream.wgt"

if (-not $WgtPath) { $WgtPath = $dist }
if (-not (Test-Path $WgtPath)) {
  Write-Host "Pacote não encontrado. Execute primeiro: .\build-wgt.ps1" -ForegroundColor Red
  exit 1
}

$sdb = Get-Command sdb -ErrorAction SilentlyContinue
if (-not $sdb) {
  Write-Host "sdb não encontrado. Adicione Tizen Studio tools ao PATH:" -ForegroundColor Yellow
  Write-Host '  C:\tizen-studio\tools\ide\bin' -ForegroundColor Yellow
  Write-Host '  C:\tizen-studio\tools' -ForegroundColor Yellow
  exit 1
}

if ($TvIp) {
  Write-Host "Conectando à TV $TvIp..." -ForegroundColor Cyan
  sdb connect $TvIp:26101
}

$devices = sdb devices
Write-Host $devices

Write-Host "Instalando $WgtPath ..." -ForegroundColor Cyan
sdb install $WgtPath

Write-Host "Iniciando app..." -ForegroundColor Cyan
sdb shell 0 launch AnimShN1.AnimeStream

Write-Host "Pronto! Abra 'Anime Stream' no menu de apps da TV." -ForegroundColor Green