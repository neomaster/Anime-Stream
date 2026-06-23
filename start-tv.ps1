# Inicia o Anime Stream acessivel na rede local (Samsung TV, celular, etc.)
$port = 3456
$ruleName = "Anime Stream ($port)"

function Get-LanIPs {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.PrefixOrigin -ne 'WellKnown' -and
    $_.InterfaceAlias -notmatch 'Nord|VPN|TAP|Loopback'
  } | ForEach-Object { $_.IPAddress } | Sort-Object -Unique

  # Preferir 192.168.x (Wi-Fi/router); ignorar faixas VPN tipo 10.5.x
  $wifi = $ips | Where-Object { $_ -like '192.168.*' }
  if ($wifi) { return $wifi }
  return $ips | Where-Object { $_ -notlike '169.254.*' -and $_ -notlike '10.5.*' }
}

Write-Host ""
Write-Host "=== Anime Stream - Modo TV ===" -ForegroundColor Cyan

# Tenta corrigir rede/firewall automaticamente
$fixScript = Join-Path $PSScriptRoot "fix-network.ps1"
if (Test-Path $fixScript) {
  & $fixScript -Port $port
}

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existing) {
  try {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null
    Write-Host "Firewall: porta $port liberada." -ForegroundColor Green
  } catch {
    Write-Host "Firewall: execute como Administrador para liberar a porta $port." -ForegroundColor Yellow
    Write-Host "  Ou libere manualmente: Painel > Firewall > Regra de entrada TCP $port" -ForegroundColor Yellow
  }
} else {
  Write-Host "Firewall: regra ja configurada." -ForegroundColor Green
}

Set-Location $PSScriptRoot

$lanIPs = @(Get-LanIPs)

Write-Host ""
Write-Host "Dispositivos na rede:" -ForegroundColor White
Write-Host "  Android APK: android-app/dist/AnimeStream.apk" -ForegroundColor Cyan
Write-Host "  Samsung TV:  samsung-tv/README.md" -ForegroundColor Cyan
Write-Host "  Navegador:" -ForegroundColor White
if ($lanIPs.Count -gt 0) {
  Write-Host "  No app Android/TV, digite:" -ForegroundColor White
  foreach ($ip in $lanIPs) {
    Write-Host "    $ip`:$port" -ForegroundColor Yellow -BackgroundColor DarkBlue
    Write-Host "    (blocos: $($ip -replace '\.', ' | '))" -ForegroundColor DarkGray
  }
  Write-Host ""
  foreach ($ip in $lanIPs) {
    Write-Host "    http://${ip}:${port}" -ForegroundColor Yellow
  }
} else {
  Write-Host "    http://SEU-IP-LOCAL:${port}" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Pressione Ctrl+C para encerrar." -ForegroundColor DarkGray
Write-Host ""

node server.js