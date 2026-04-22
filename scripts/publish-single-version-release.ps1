param(
  [string]$Version = "",
  [string]$ReleaseNotes = "",
  [string]$DistDir = "E:\VGO-CODE\dist",
  [string]$WebDownloadDir = "",
  [string]$DownloadBaseUrl = "https://vgoai.cn/downloads/vgo-code",
  [switch]$LocalOnly,
  [string]$ServerHost = "139.180.213.100",
  [string]$ServerUser = "root",
  [string]$SshKeyPath = "C:\Users\one\.ssh\id_ed25519_vgo_ai",
  [string]$RemoteDownloadDir = "/opt/vgo-ai/downloads/vgo-code"
)

$ErrorActionPreference = "Stop"

function Get-PackageVersion {
  param([string]$PackagePath)
  $pkg = Get-Content $PackagePath -Raw | ConvertFrom-Json
  return [string]$pkg.version
}

function Assert-FileExists {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    throw "Missing required file: $Path"
  }
}

function Assert-CommandExists {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $Name"
  }
}

function Resolve-WebDownloadDir {
  param([string]$InputPath)
  if (-not [string]::IsNullOrWhiteSpace($InputPath) -and (Test-Path $InputPath)) {
    return (Resolve-Path $InputPath).Path
  }

  $candidates = @(
    "E:\api-platform网站平台\api-platform\frontend\public\downloads\vgo-code",
    "E:\api-platform*\api-platform\frontend\public\downloads\vgo-code"
  )

  foreach ($candidate in $candidates) {
    $resolved = Get-Item $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($resolved -and (Test-Path $resolved.FullName)) {
      return $resolved.FullName
    }
  }

  throw "Unable to resolve WebDownloadDir. Pass -WebDownloadDir explicitly."
}

if (-not $LocalOnly) {
  Assert-CommandExists ssh
  Assert-CommandExists scp
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = Get-PackageVersion -PackagePath "E:\VGO-CODE\package.json"
}

if ([string]::IsNullOrWhiteSpace($ReleaseNotes)) {
  $ReleaseNotes = "v${Version}: Single-version release channel update."
}

$WebDownloadDir = Resolve-WebDownloadDir -InputPath $WebDownloadDir

$installerName = "VGO-CODE-Setup-$Version.exe"
$blockMapName = "VGO-CODE-Setup-$Version.exe.blockmap"
$legacyInstallerName = "VGO CODE Setup $Version.exe"
$legacyBlockMapName = "VGO CODE Setup $Version.exe.blockmap"
$installerPath = Join-Path $DistDir $installerName
$blockMapPath = Join-Path $DistDir $blockMapName
$latestYmlPath = Join-Path $DistDir "latest.yml"
$readmePath = Join-Path $WebDownloadDir "README.md"
$versionJsonPath = Join-Path $WebDownloadDir "version.json"
$webInstallerPath = Join-Path $WebDownloadDir $installerName
$webBlockMapPath = Join-Path $WebDownloadDir $blockMapName
$webLatestYmlPath = Join-Path $WebDownloadDir "latest.yml"
$publishedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$legacyInstallerPath = Join-Path $DistDir $legacyInstallerName
$legacyBlockMapPath = Join-Path $DistDir $legacyBlockMapName

if (-not (Test-Path $installerPath) -and (Test-Path $legacyInstallerPath)) {
  Copy-Item $legacyInstallerPath $installerPath -Force
}

if (-not (Test-Path $blockMapPath) -and (Test-Path $legacyBlockMapPath)) {
  Copy-Item $legacyBlockMapPath $blockMapPath -Force
}

Assert-FileExists $installerPath
Assert-FileExists $blockMapPath
Assert-FileExists $latestYmlPath
Assert-FileExists $readmePath

$latestYmlText = Get-Content $latestYmlPath -Raw
$normalizedLatestYmlText = $latestYmlText -replace [regex]::Escape($legacyInstallerName), $installerName
if ($normalizedLatestYmlText -ne $latestYmlText) {
  [System.IO.File]::WriteAllText($latestYmlPath, $normalizedLatestYmlText, $utf8NoBom)
}

$versionPayload = [ordered]@{
  version = $Version
  tag = "v$Version"
  download_url = "$DownloadBaseUrl/$installerName"
  downloadUrl = "$DownloadBaseUrl/$installerName"
  release_notes = $ReleaseNotes
  published_at = $publishedAt
}

$versionJsonText = $versionPayload | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($versionJsonPath, $versionJsonText, $utf8NoBom)

Copy-Item $installerPath $webInstallerPath -Force
Copy-Item $blockMapPath $webBlockMapPath -Force
Copy-Item $latestYmlPath $webLatestYmlPath -Force

Write-Host "[publish] Local web directory synced: $WebDownloadDir"

if ($LocalOnly) {
  Assert-FileExists $versionJsonPath
  Assert-FileExists $webLatestYmlPath
  Assert-FileExists $webInstallerPath
  Write-Host "[publish] Local-only mode enabled. Remote upload skipped."
  Write-Host "[publish] Done."
  Write-Host "[publish] version.json: $versionJsonPath"
  Write-Host "[publish] latest.yml: $webLatestYmlPath"
  Write-Host "[publish] installer: $webInstallerPath"
  return
}

$remoteTarget = "${ServerUser}@${ServerHost}:${RemoteDownloadDir}/"
scp -i $SshKeyPath $webInstallerPath $remoteTarget | Out-Null
scp -i $SshKeyPath $webBlockMapPath $remoteTarget | Out-Null
scp -i $SshKeyPath $webLatestYmlPath $remoteTarget | Out-Null
scp -i $SshKeyPath $versionJsonPath $remoteTarget | Out-Null
scp -i $SshKeyPath $readmePath $remoteTarget | Out-Null

$remoteScript = @"
set -e
cd $RemoteDownloadDir
find . -maxdepth 1 -type f -name 'VGO-CODE-Setup-*.exe' ! -name '$installerName' -delete
find . -maxdepth 1 -type f -name 'VGO-CODE-Setup-*.exe.blockmap' ! -name '$blockMapName' -delete
find . -maxdepth 1 -type f -name 'VGO CODE Setup *.exe' -delete
find . -maxdepth 1 -type f -name 'VGO CODE Setup *.exe.blockmap' -delete
ls -lah
"@

ssh -i $SshKeyPath "${ServerUser}@${ServerHost}" $remoteScript

$versionJsonUrl = "$DownloadBaseUrl/version.json"
$latestYmlUrl = "$DownloadBaseUrl/latest.yml"
$installerUrl = "$DownloadBaseUrl/$installerName"

$versionJsonResult = Invoke-WebRequest -Uri $versionJsonUrl -UseBasicParsing
$latestYmlResult = Invoke-WebRequest -Uri $latestYmlUrl -UseBasicParsing
$installerHead = Invoke-WebRequest -Uri $installerUrl -Method Head -UseBasicParsing

if ($versionJsonResult.StatusCode -ne 200) {
  throw "version.json check failed with status $($versionJsonResult.StatusCode)"
}
if ($latestYmlResult.StatusCode -ne 200) {
  throw "latest.yml check failed with status $($latestYmlResult.StatusCode)"
}
if ($installerHead.StatusCode -ne 200) {
  throw "installer check failed with status $($installerHead.StatusCode)"
}

Write-Host "[publish] Done."
Write-Host "[publish] version.json: $versionJsonUrl"
Write-Host "[publish] latest.yml: $latestYmlUrl"
Write-Host "[publish] installer: $installerUrl"
