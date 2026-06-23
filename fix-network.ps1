# Corrige firewall e rede para o Anime Stream aceitar conexoes do celular/TV
# Execute como Administrador: clique direito > Executar como administrador
param([int]$Port = 3456)

$ErrorActionPreference = "Continue"
$rulePort = "Anime Stream ($Port)"
$ruleNode = "Anime Stream Node.js"

Write-Host ""
Write-Host "=== Anime Stream - Corrigir rede ===" -ForegroundColor Cyan

# Rede Wi-Fi/Ethernet como Privada (firewall menos restritivo)
Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object {
  $_.InterfaceAlias -notmatch 'Nord|VPN|TAP|Loopback'
} | ForEach-Object {
  if ($_.NetworkCategory -ne 'Private') {
    try {
      Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private
      Write-Host "Rede '$($_.InterfaceAlias)' definida como Privada." -ForegroundColor Green
    } catch {
      Write-Host "Nao foi possivel alterar perfil de '$($_.InterfaceAlias)'." -ForegroundColor Yellow
    }
  }
}

# Regra por porta (todas as redes)
$existing = Get-NetFirewallRule -DisplayName $rulePort -ErrorAction SilentlyContinue
if (-not $existing) {
  try {
    New-NetFirewallRule -DisplayName $rulePort -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
    Write-Host "Firewall: porta $Port liberada." -ForegroundColor Green
  } catch {
    Write-Host "ERRO firewall porta: execute este script como Administrador." -ForegroundColor Red
  }
} else {
  Set-NetFirewallRule -DisplayName $rulePort -Enabled True -Action Allow -Profile Any -ErrorAction SilentlyContinue
  Write-Host "Firewall: regra da porta $Port OK." -ForegroundColor Green
}

# Regra para o Node.js
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if ($nodePath) {
  $nodeRule = Get-NetFirewallRule -DisplayName $ruleNode -ErrorAction SilentlyContinue
  if (-not $nodeRule) {
    try {
      New-NetFirewallRule -DisplayName $ruleNode -Direction Inbound -Program $nodePath -Action Allow -Profile Any | Out-Null
      Write-Host "Firewall: Node.js liberado ($nodePath)." -ForegroundColor Green
    } catch {
      Write-Host "Firewall Node: requer Administrador." -ForegroundColor Yellow
    }
  }
}

$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
  $_.IPAddress -notlike '127.*' -and
  $_.InterfaceAlias -notmatch 'Nord|VPN|TAP|Loopback' -and
  $_.IPAddress -notlike '169.254.*'
} | ForEach-Object { $_.IPAddress } | Sort-Object -Unique

Write-Host ""
Write-Host "Use ESTE IP no app (nao use IP de VPN):" -ForegroundColor White
foreach ($ip in $ips) {
  Write-Host "  $ip`:$Port" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "No celular, teste no navegador:" -ForegroundColor White
if ($ips.Count -gt 0) {
  $testUrl = 'http://' + $ips[0] + ':' + $Port + '/api/health'
  Write-Host "  $testUrl" -ForegroundColor Cyan
}
Write-Host ""