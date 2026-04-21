# 本地 Docker 切流状态（已执行）

执行时间：2026-04-21

## 已完成

1. 已创建 Cloudflare Tunnel：`vgo-local-docker`
2. 已将域名切到 Tunnel：
- `vgoai.cn`
- `www.vgoai.cn`
3. Tunnel 已连接并在线（Windows 本机 `cloudflared` 进程）
4. 本地转发目标已配置为 Docker 前端：`http://host.docker.internal:3100`
5. 联通验证通过：
- `https://vgoai.cn` 返回 200
- `https://www.vgoai.cn` 返回 200

## 本机关键文件

- Cloudflared 配置：`C:\Users\one\.cloudflared\config.yml`
- Tunnel 凭据：`C:\Users\one\.cloudflared\2c311b0b-c0a5-455d-8bd1-15f3f8658f5d.json`
- 启动脚本：`E:\VGO-CODE\scripts\start-local-tunnel.ps1`
- 自动启动项：`C:\Users\one\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\VGO-Local-Tunnel.cmd`
- 日志文件：
  - `E:\VGO-CODE\logs\cloudflared-vgo-out.log`
  - `E:\VGO-CODE\logs\cloudflared-vgo-err.log`

## 一键回滚到 Vultr IP

当前回滚脚本：

`E:\VGO-CODE\scripts\rollback-cloudflare-to-vultr.ps1`

示例：

```powershell
powershell -ExecutionPolicy Bypass -File E:\VGO-CODE\scripts\rollback-cloudflare-to-vultr.ps1 -CfApiToken "<NEW_CF_TOKEN>"
```

默认回滚到：`139.180.213.100`

## 你现在只需要做的一件事

删除旧的 Cloudflare API Token（已在聊天中暴露），重新创建新 token 仅用于后续变更。

