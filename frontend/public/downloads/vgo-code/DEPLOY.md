# VGO CODE 部署指南

## 服务器部署

### 目录结构

```
/var/www/vgoai.cn/downloads/vgo-code/
├── VGO CODE Setup 1.0.0.exe    # 安装包
├── version.json                 # 版本信息
└── README.md                    # 用户说明
```

### 更新版本步骤

1. 上传新安装包到目录
2. 更新 `version.json` 中的版本号和下载地址
3. 用户端自动检测到新版本

### version.json 格式

```json
{
  "version": "1.0.1",
  "tag": "v1.0.1",
  "download_url": "https://vgoai.cn/downloads/vgo-code/VGO CODE Setup 1.0.1.exe",
  "release_notes": "Bug fixes and improvements",
  "published_at": "2026-04-15T12:00:00Z"
}
```

## Docker 部署网站

```bash
# 克隆代码
git clone https://github.com/sujay888999/vgo-code.git
cd vgo-code

# 配置环境变量
cp .env.production.example .env
# 编辑 .env 填入实际配置

# 启动服务
docker-compose up -d
```

## Nginx 配置

网站已配置 SSL/HTTPS，可直接使用提供的 `nginx/nginx.conf`。

## 技术架构

```
┌─────────────────────────────────────────────────────────┐
│                    VGO AI 平台                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  模型目录    │  │  用户管理    │  │  计费系统    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                   VGO CODE 桌面应用                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  Electron   │  │  Ollama     │  │  Agent      │    │
│  │  前端界面    │  │  本地模型    │  │  工具调用    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## 相关链接

- VGO AI 平台：https://vgoai.cn
- Ollama 下载：https://ollama.com/download
- GitHub 仓库：https://github.com/sujay888999/vgo-code
