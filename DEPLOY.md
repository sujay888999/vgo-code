# VGO CODE 部署指南

## 架构概览

```
本地 Windows 开发机
  ├─ git push → GitHub (sujay888999/vgo-code)
  ├─ SCP 安装包 → 服务器 /var/www/html/downloads/vgo-code/ (nginx 静态服务)
  ├─ SCP 安装包 → Docker 容器 /app/frontend/public/downloads/vgo-code/
  └─ Cloudflare API → 清除 CDN 缓存

服务器 38.181.42.161
  ├─ nginx (80) → /downloads/ 静态服务 (绕过 Docker)
  ├─ nginx (80) → proxy_pass http://127.0.0.1:7860 (Docker 容器)
  └─ Docker api-platform (7860)
       ├─ PostgreSQL
       ├─ NestJS 后端 (3001)
       ├─ Next.js 前端 (3000)
       └─ nginx (容器内, 80)
```

## 快速部署 (一键)

```powershell
# 完整部署: 版本号更新 + 构建 + Git + 上传 + Cloudflare 清缓存
.\scripts\deploy.ps1 -Version "1.3.3" -ReleaseNotes "修复xxx问题"

# 设置 Cloudflare Token (可选, 只需设置一次)
$env:CF_API_TOKEN = "cfut_xxxxx"
.\scripts\deploy.ps1 -Version "1.3.3" -ReleaseNotes "修复xxx问题"
```

## 分步部署

### 1. 更新版本号

```powershell
# 自动更新 package.json + src/package.json
# 或手动修改:
#   "version": "1.3.3"  (根 package.json)
#   "version": "1.3.3"  (src/package.json)
```

### 2. 构建安装包

```powershell
npm run dist
# 产出: dist/VGO-CODE-Setup-1.3.3.exe + .blockmap + latest.yml
```

### 3. 推送到 GitHub

```powershell
$env:NO_PROXY = "*"
git -c http.proxy="" -c https.proxy="" -c credential.helper="" push origin master
git tag -a v1.3.3 -m "Release 1.3.3"
git -c http.proxy="" -c https.proxy="" -c credential.helper="" push origin v1.3.3
```

> **注意**: Windows 上 git push 必须设置 `NO_PROXY=*` + `credential.helper=` 绕过 WSL 干扰。

### 4. 上传到服务器

```powershell
$server = "root@38.181.42.161"
$key = "C:\Users\one\.ssh\id_ed25519_vgo_ai"

# nginx 静态目录 (下载链接直接服务)
scp -i $key dist/VGO-CODE-Setup-1.3.3.exe ${server}:/var/www/html/downloads/vgo-code/
scp -i $key dist/VGO-CODE-Setup-1.3.3.exe.blockmap ${server}:/var/www/html/downloads/vgo-code/
scp -i $key dist/latest.yml ${server}:/var/www/html/downloads/vgo-code/
scp -i $key dist/version.json ${server}:/var/www/html/downloads/vgo-code/

# Docker 容器内 (前端页面引用)
scp -i $key dist/VGO-CODE-Setup-1.3.3.exe ${server}:/app/frontend/public/downloads/vgo-code/
scp -i $key dist/VGO-CODE-Setup-1.3.3.exe.blockmap ${server}:/app/frontend/public/downloads/vgo-code/
scp -i $key dist/latest.yml ${server}:/app/frontend/public/downloads/vgo-code/
scp -i $key dist/version.json ${server}:/app/frontend/public/downloads/vgo-code/

# 清理旧版本
ssh -i $key $server "cd /var/www/html/downloads/vgo-code && find . -maxdepth 1 -type f -name 'VGO-CODE-Setup-*.exe' ! -name 'VGO-CODE-Setup-1.3.3.exe' -delete"
```

### 5. 清除 Cloudflare 缓存

**方式 A: 通过 Cloudflare 控制台**
1. 登录 https://dash.cloudflare.com → 选择 vgoai.cn
2. 左侧菜单 → 缓存 → 配置 → Purge All

**方式 B: 通过 API**
```powershell
$cfToken = "cfut_xxxxx"
$zoneId = "4494936ec61e3da37615187189f99a57"

# 清除所有缓存
Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones/$zoneId/purge_cache" `
  -Method Post `
  -Headers @{ "Authorization" = "Bearer $cfToken"; "Content-Type" = "application/json" } `
  -Body '{"purge_everything":true}'
```

### 6. 验证

```powershell
# 检查 version.json
curl.exe -s https://vgoai.cn/downloads/vgo-code/version.json

# 检查安装包下载
curl.exe -s -o /dev/null -w "%{http_code}" https://vgoai.cn/downloads/vgo-code/VGO-CODE-Setup-1.3.3.exe

# 检查桌面端自动更新 (重启应用后)
# 或在设置中点击"检查更新"
```

## 更新网站版本号显示

网站前端 (teams/developers 页面) 的版本号是 Next.js 构建时写死在 JS chunk 中的。

**永久修复**: 修改 `app/app/teams/page.tsx` 源码中的版本号，重新构建 Docker 镜像。

**临时修复** (无需重建镜像):
```bash
# SSH 到服务器
ssh -i key root@38.181.42.161

# 修改 Docker 容器内的 JS chunk 文件
docker exec api-platform sed -i 's/v1.3.2/v1.3.3/g' \
  /app/frontend/.next/static/chunks/app/teams/page-*.js \
  /app/frontend/.next/static/chunks/app/developers/page-*.js \
  /app/frontend/.next/server/app/teams/page.js \
  /app/frontend/.next/server/app/developers/page.js

# 清除 Cloudflare 缓存 (必须!)
```

> **重要**: Next.js 的 `Cache-Control: immutable` 策略会把 JS chunk 缓存 1 年。
> 改了文件内容后**必须清除 Cloudflare 缓存**，否则用户看到的还是旧版本。

## 文件命名约定

构建产物有两种命名格式:
- **新格式**: `VGO-CODE-Setup-1.3.3.exe` (横线)
- **旧格式**: `VGO CODE Setup 1.3.3.exe` (空格)

服务器同时保存两种格式以兼容新旧链接。脚本会自动处理兼容。

## 下载链接

| 链接 | 说明 |
|------|------|
| `https://vgoai.cn/downloads/vgo-code/version.json` | 版本信息 (桌面端自动更新) |
| `https://vgoai.cn/downloads/vgo-code/VGO-CODE-Setup-{version}.exe` | 安装包 |
| `https://vgoai.cn/downloads/vgo-code/latest.yml` | electron-builder 更新元数据 |

## 服务器信息

| 项目 | 值 |
|------|-----|
| 服务器 IP | 38.181.42.161 |
| SSH 密钥 | `C:\Users\one\.ssh\id_ed25519_vgo_ai` |
| Docker 容器 | `api-platform` |
| nginx 端口 | 80 |
| Docker 映射端口 | 7860 |
| Cloudflare Zone ID | `4494936ec61e3da37615187189f99a57` |
| GitHub Repo | `sujay888999/vgo-code` |

## 常见问题

### Q: 桌面端检测不到新版本?
A: 检查 `version.json` 是否正确返回新版本号。桌面端每 6 小时自动检查一次，也可在设置中手动触发。

### Q: 下载链接 404?
A: 检查文件是否已上传到 `/var/www/html/downloads/vgo-code/`。nginx 的 `/downloads/` location 直接从这个目录静态服务。

### Q: 网站仍显示旧版本号?
A: Cloudflare 缓存未清除。执行 Cloudflare API 清除或在控制台手动 Purge All。

### Q: git push 卡住不动?
A: WSL 网络干扰。设置 `$env:NO_PROXY = "*"` 并使用 `-c credential.helper=` 参数。
