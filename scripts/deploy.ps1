param(
  [string]$ServerHost = "139.180.213.100",
  [string]$ServerUser = "root",
  [string]$ProjectRoot = "",
  [string]$SshKeyPath = "C:\Users\one\.ssh\id_ed25519_vgo_ai",
  [string]$RemotePath = "/opt/vgo-ai/api-platform",
  [string]$RemoteArchive = "/root/vgo-ai-deploy.tar.gz"
)

$ErrorActionPreference = "Stop"

function Assert-CommandExists {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

Assert-CommandExists ssh
Assert-CommandExists scp
Assert-CommandExists tar

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

if (-not (Test-Path $ProjectRoot)) {
  throw "Project root not found: $ProjectRoot"
}

if (-not (Test-Path $SshKeyPath)) {
  throw "SSH key not found: $SshKeyPath"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archivePath = Join-Path $env:TEMP "vgo-ai-$timestamp.tar.gz"

Write-Host "Packing project..."
tar -czf $archivePath `
  --exclude=node_modules `
  --exclude=.next `
  --exclude=dist `
  --exclude=.git `
  --exclude=.env `
  -C $ProjectRoot .

Write-Host "Uploading archive..."
scp -i $SshKeyPath $archivePath "${ServerUser}@${ServerHost}:${RemoteArchive}" | Out-Null

$remoteScript = @"
set -e
mkdir -p $RemotePath
find $RemotePath -mindepth 1 -maxdepth 1 ! -name '.env' -exec rm -rf {} +
tar -xzf $RemoteArchive -C $RemotePath
if [ ! -f $RemotePath/.env ] && [ -f /opt/vgo-ai/api-platform.env ]; then
  cp /opt/vgo-ai/api-platform.env $RemotePath/.env
fi
cd $RemotePath
docker compose up -d --build
docker exec api-platform-backend node dist/database/run-migrations.js
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
"@

Write-Host "Deploying on server..."
ssh -i $SshKeyPath "${ServerUser}@${ServerHost}" $remoteScript

Remove-Item $archivePath -Force -ErrorAction SilentlyContinue
Write-Host "Deploy complete."
