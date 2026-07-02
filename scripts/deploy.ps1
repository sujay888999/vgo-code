<#
.SYNOPSIS
  VGO CODE 一键部署脚本 — 打包 + GitHub + 服务器 + Cloudflare
.DESCRIPTION
  自动化完成以下步骤:
  1. 更新版本号 (package.json + src/package.json)
  2. Git commit + push + tag
  3. 构建安装包 (npm run dist)
  4. 上传安装包到服务器 (nginx /downloads/ + Docker 容器)
  5. 清除 Cloudflare 缓存
.PARAMETER Version
  目标版本号, 如 "1.3.3"。留空则使用 package.json 中的当前版本。
.PARAMETER ReleaseNotes
  发布说明, 如 "修复xxx问题"。
.PARAMETER SkipBuild
  跳过 npm run dist 步骤 (用于只更新服务器文件的场景)。
.PARAMETER SkipGit
  跳过 git commit/push 步骤。
.PARAMETER SkipCloudflare
  跳过 Cloudflare 缓存清除。
.EXAMPLE
  .\deploy.ps1 -Version "1.3.3" -ReleaseNotes "修复登录问题"
  .\deploy.ps1 -Version "1.3.3" -SkipBuild
#>
param(
  [string]$Version = "",
  [string]$ReleaseNotes = "",
  [switch]$SkipBuild,
  [switch]$SkipGit,
  [switch]$SkipCloudflare,
  [string]$ServerHost = "38.181.42.161",
  [string]$ServerUser = "root",
  [string]$SshKeyPath = "C:\Users\one\.ssh\id_ed25519_vgo_ai",
  [string]$CloudflareZoneId = "4494936ec61e3da37615187189f99a57",
  [string]$CloudflareToken = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = "E:\VGO-CODE"
$DistDir = Join-Path $ProjectRoot "dist"
$NginxDownloadDir = "/var/www/html/downloads/vgo-code"
$DockerDownloadDir = "/app/frontend/public/downloads/vgo-code"

# ─── 辅助函数 ──────────────────────────────────────────────
function Write-Step {
  param([string]$Step, [string]$Message)
  Write-Host ""
  Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
  Write-Host "  [$Step] $Message" -ForegroundColor Yellow
  Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
}

function Write-OK {
  param([string]$Message)
  Write-Host "  ✓ $Message" -ForegroundColor Green
}

function Write-Fail {
  param([string]$Message)
  Write-Host "  ✗ $Message" -ForegroundColor Red
}

function Assert-FileExists {
  param([string]$Path, [string]$Label)
  if (-not (Test-Path $Path)) {
    throw "Missing file: $Label -> $Path"
  }
  Write-OK "$Label ($Path)"
}

function Resolve-Version {
  if (-not [string]::IsNullOrWhiteSpace($Version)) {
    return $Version
  }
  $pkg = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
  return [string]$pkg.version
}

# ─── 读取版本号 ──────────────────────────────────────────────
$Version = Resolve-Version
Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║  VGO CODE 部署脚本 — v$Version                              ║" -ForegroundColor Magenta
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# ─── Step 1: 更新版本号 ──────────────────────────────────────
Write-Step "1/6" "更新版本号 → $Version"

$pkgPath = Join-Path $ProjectRoot "package.json"
$srcPkgPath = Join-Path $ProjectRoot "src\package.json"

$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$oldVersion = $pkg.version
Write-Host "  当前版本: $oldVersion → 目标版本: $Version"

if ($oldVersion -ne $Version) {
  # 更新根 package.json
  $content = Get-Content $pkgPath -Raw
  $content = $content -replace "`"version`":\s*`"$([regex]::Escape($oldVersion))`"", "`"version`": `"$Version`""
  [System.IO.File]::WriteAllText($pkgPath, $content, [System.Text.UTF8Encoding]::new($false))
  Write-OK "package.json → $Version"

  # 更新 src/package.json
  if (Test-Path $srcPkgPath) {
    $srcContent = Get-Content $srcPkgPath -Raw
    $srcContent = $srcContent -replace "`"version`":\s*`"$([regex]::Escape($oldVersion))`"", "`"version`": `"$Version`""
    [System.IO.File]::WriteAllText($srcPkgPath, $srcContent, [System.Text.UTF8Encoding]::new($false))
    Write-OK "src/package.json → $Version"
  }
} else {
  Write-OK "版本号已是 $Version, 无需修改"
}

# ─── Step 2: 构建安装包 ──────────────────────────────────────
if (-not $SkipBuild) {
  Write-Step "2/6" "构建安装包 (npm run dist)"

  Push-Location $ProjectRoot
  try {
    Write-Host "  运行 npm run dist ..."
    npm run dist
    if ($LASTEXITCODE -ne 0) { throw "npm run dist failed" }
    Write-OK "构建完成"
  } finally {
    Pop-Location
  }
} else {
  Write-Step "2/6" "跳过构建 (--SkipBuild)"
}

# ─── 验证构建产物 ──────────────────────────────────────────────
$installerName = "VGO-CODE-Setup-$Version.exe"
$blockMapName = "VGO-CODE-Setup-$Version.exe.blockmap"
$legacyInstallerName = "VGO CODE Setup $Version.exe"
$legacyBlockMapName = "VGO CODE Setup $Version.exe.blockmap"

$installerPath = Join-Path $DistDir $installerName
$blockMapPath = Join-Path $DistDir $blockMapName
$latestYmlPath = Join-Path $DistDir "latest.yml"
$versionJsonPath = Join-Path $DistDir "version.json"

# 兼容旧命名
if (-not (Test-Path $installerPath)) {
  $legacyPath = Join-Path $DistDir $legacyInstallerName
  if (Test-Path $legacyPath) {
    Copy-Item $legacyPath $installerPath -Force
    Write-OK "兼容: 复制 $legacyInstallerName → $installerName"
  }
}
if (-not (Test-Path $blockMapPath)) {
  $legacyPath = Join-Path $DistDir $legacyBlockMapName
  if (Test-Path $legacyPath) {
    Copy-Item $legacyPath $blockMapPath -Force
    Write-OK "兼容: 复制 $legacyBlockMapName → $blockMapName"
  }
}

Write-Host ""
Write-Host "  验证构建产物:" -ForegroundColor White
Assert-FileExists $installerPath "安装包"
Assert-FileExists $blockMapPath "BlockMap"
Assert-FileExists $latestYmlPath "latest.yml"

# ─── Step 3: Git commit + push + tag ──────────────────────────
if (-not $SkipGit) {
  Write-Step "3/6" "Git commit + push + tag (v$Version)"

  Push-Location $ProjectRoot
  try {
    # 配置代理绕过
    $env:NO_PROXY = "*"
    $pushCmd = @(
      "-c", "http.proxy=",
      "-c", "https.proxy=",
      "-c", "credential.helper="
    )

    git add package.json src/package.json 2>&1 | Out-Null
    $commitMsg = "release: v$Version"
    if (-not [string]::IsNullOrWhiteSpace($ReleaseNotes)) {
      $commitMsg += " — $ReleaseNotes"
    }

    $status = git status --porcelain 2>&1
    if ($status) {
      git commit -m $commitMsg
      Write-OK "Git commit: $commitMsg"
    } else {
      Write-OK "没有需要提交的更改"
    }

    # Push (绕过 WSL 代理)
    git @pushCmd push origin master 2>&1
    Write-OK "Git push: origin master"

    # Tag
    $tagName = "v$Version"
    $existingTag = git tag -l $tagName 2>&1
    if ($existingTag -eq $tagName) {
      Write-OK "Tag $tagName 已存在, 跳过"
    } else {
      git tag -a $tagName -m "Release $Version"
      git @pushCmd push origin $tagName 2>&1
      Write-OK "Git push: tag $tagName"
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Step "3/6" "跳过 Git (--SkipGit)"
}

# ─── Step 4: 生成 version.json ────────────────────────────────
Write-Step "4/6" "生成 version.json"

$publishedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$versionPayload = [ordered]@{
  version      = $Version
  tag          = "v$Version"
  download_url = "https://vgoai.cn/downloads/vgo-code/$installerName"
  downloadUrl  = "https://vgoai.cn/downloads/vgo-code/$installerName"
  release_notes = if ([string]::IsNullOrWhiteSpace($ReleaseNotes)) { "v$Version release" } else { $ReleaseNotes }
  published_at = $publishedAt
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$versionJsonText = $versionPayload | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($versionJsonPath, $versionJsonText, $utf8NoBom)
Write-OK "version.json → $versionJsonPath"
Write-Host "  内容: $versionJsonText" -ForegroundColor DarkGray

# ─── Step 5: 上传到服务器 ──────────────────────────────────────
Write-Step "5/6" "上传到服务器 $ServerHost"

$remoteNginx = "${ServerUser}@${ServerHost}:${NginxDownloadDir}/"
$remoteDocker = "${ServerUser}@${ServerHost}:${DockerDownloadDir}/"

# 上传到 nginx 静态目录
Write-Host "  上传到 nginx: $NginxDownloadDir"
scp -i $SshKeyPath $installerPath $remoteNginx 2>&1 | Out-Null
scp -i $SshKeyPath $blockMapPath $remoteNginx 2>&1 | Out-Null
scp -i $SshKeyPath $latestYmlPath $remoteNginx 2>&1 | Out-Null
scp -i $SshKeyPath $versionJsonPath $remoteNginx 2>&1 | Out-Null
Write-OK "nginx 目录上传完成"

# 上传到 Docker 容器
Write-Host "  上传到 Docker 容器: $DockerDownloadDir"
scp -i $SshKeyPath $installerPath $remoteDocker 2>&1 | Out-Null
scp -i $SshKeyPath $blockMapPath $remoteDocker 2>&1 | Out-Null
scp -i $SshKeyPath $latestYmlPath $remoteDocker 2>&1 | Out-Null
scp -i $SshKeyPath $versionJsonPath $remoteDocker 2>&1 | Out-Null
Write-OK "Docker 容器上传完成"

# 清理旧版本 (nginx 目录)
$cleanupScript = @"
set -e
cd $NginxDownloadDir
find . -maxdepth 1 -type f -name 'VGO-CODE-Setup-*.exe' ! -name '$installerName' -delete 2>/dev/null || true
find . -maxdepth 1 -type f -name 'VGO-CODE-Setup-*.exe.blockmap' ! -name '$blockMapName' -delete 2>/dev/null || true
find . -maxdepth 1 -type f -name 'VGO CODE Setup *.exe' -delete 2>/dev/null || true
find . -maxdepth 1 -type f -name 'VGO CODE Setup *.exe.blockmap' -delete 2>/dev/null || true
ls -lah
"@
ssh -i $SshKeyPath "${ServerUser}@${ServerHost}" $cleanupScript
Write-OK "旧版本已清理"

# 验证下载链接
Write-Host "  验证下载链接..."
$verifyUrls = @(
  "https://vgoai.cn/downloads/vgo-code/version.json",
  "https://vgoai.cn/downloads/vgo-code/latest.yml",
  "https://vgoai.cn/downloads/vgo-code/$installerName"
)
foreach ($url in $verifyUrls) {
  try {
    $resp = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -TimeoutSec 10
    Write-OK "$url → $($resp.StatusCode)"
  } catch {
    Write-Fail "$url → $($_.Exception.Message)"
  }
}

# ─── Step 6: 清除 Cloudflare 缓存 ──────────────────────────────
if (-not $SkipCloudflare) {
  Write-Step "6/6" "清除 Cloudflare 缓存"

  if ([string]::IsNullOrWhiteSpace($CloudflareToken)) {
    # 尝试从环境变量读取
    $CloudflareToken = $env:CF_API_TOKEN
  }

  if ([string]::IsNullOrWhiteSpace($CloudflareToken)) {
    Write-Host "  ⚠ 未提供 Cloudflare Token, 跳过缓存清除" -ForegroundColor Yellow
    Write-Host "  手动清除: https://dash.cloudflare.com → vgoai.cn → 缓存 → 清除" -ForegroundColor Yellow
    Write-Host "  或设置环境变量: `$env:CF_API_TOKEN = 'your_token'" -ForegroundColor Yellow
  } else {
    $purgeBody = @{ purge_everything = $true } | ConvertTo-Json
    $tempFile = Join-Path $env:TEMP "cf-purge.json"
    [System.IO.File]::WriteAllText($tempFile, $purgeBody, [System.Text.UTF8Encoding]::new($false))

    try {
      $resp = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$CloudflareZoneId/purge_cache" `
        -Method Post `
        -Headers @{
          "Authorization" = "Bearer $CloudflareToken"
          "Content-Type"  = "application/json"
        } `
        -InFile $tempFile

      if ($resp.success) {
        Write-OK "Cloudflare 缓存已清除 (全部)"
      } else {
        Write-Fail "Cloudflare 清除失败: $($resp.errors | ConvertTo-Json)"
      }
    } catch {
      Write-Fail "Cloudflare 清除异常: $($_.Exception.Message)"
    } finally {
      Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
    }
  }
} else {
  Write-Step "6/6" "跳过 Cloudflare 清除 (--SkipCloudflare)"
}

# ─── 完成 ──────────────────────────────────────────────────
Write-Host ""
Write-Host "╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  部署完成! v$Version                                        ║" -ForegroundColor Green
Write-Host "╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  GitHub:     https://github.com/sujay888999/vgo-code/releases/tag/v$Version" -ForegroundColor White
Write-Host "  下载页面:   https://vgoai.cn/teams" -ForegroundColor White
Write-Host "  version.json: https://vgoai.cn/downloads/vgo-code/version.json" -ForegroundColor White
Write-Host ""
