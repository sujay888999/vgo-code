param(
  [string]$TunnelName = "vgo-local-docker",
  [string]$ConfigPath = "$env:USERPROFILE\.cloudflared\config.yml",
  [string]$LogDir = "E:\VGO-CODE\logs"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $ConfigPath)) {
  throw "Cloudflared config not found: $ConfigPath"
}

if (!(Test-Path $LogDir)) {
  New-Item -Path $LogDir -ItemType Directory | Out-Null
}

$existing = Get-CimInstance Win32_Process -Filter "name='cloudflared.exe'" |
  Where-Object { $_.CommandLine -like "*$TunnelName*" }

if ($existing) {
  Write-Host "Tunnel process already running for $TunnelName"
  exit 0
}

$outLog = Join-Path $LogDir "cloudflared-vgo-out.log"
$errLog = Join-Path $LogDir "cloudflared-vgo-err.log"

Start-Process `
  -FilePath "cloudflared" `
  -ArgumentList "tunnel", "--config", $ConfigPath, "run", $TunnelName `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog

Start-Sleep -Seconds 2
Write-Host "Started cloudflared tunnel: $TunnelName"

