param(
  [string]$LanIp = $env:LAN_IP
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if ($LanIp) {
  $env:CERT_EXTRA_IPS = $LanIp
}

Write-Host "zalupa228local: docker compose up --build"
Write-Host "  HTTP  http://localhost:3000"
Write-Host "  HTTPS https://localhost:3443"
if ($env:CERT_EXTRA_IPS) {
  Write-Host "  CERT_EXTRA_IPS=$($env:CERT_EXTRA_IPS) (добавлено в SAN сертификата)"
}
Write-Host ""

docker compose up --build
