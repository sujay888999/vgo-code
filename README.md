# VGO CODE

VGO CODE 是一个桌面端 Agent 工作台项目。
当前工程已完成前端主链路迁移，默认使用 React + Vite 构建产物作为 Electron 渲染层。

## 当前能力

- Electron 桌面应用
- 多会话管理
- 多引擎切换（含 VGO Remote）
- VGO AI 账号绑定与模型选择
- 本地 API 模板服务（`server/`）

## 工程结构

```text
E:\VGO-CODE
├─ build/
├─ docs/
├─ electron/
│  ├─ main.js
│  ├─ preload.js
│  └─ core/
├─ src/                  # 前端源码（开发入口）
├─ dist-web/             # 前端构建产物（运行入口）
├─ server/
├─ scripts/
├─ ui/                   # 旧版静态页面，仅兼容兜底
├─ vendor/
├─ package.json
└─ README.md
```

## 渲染层加载策略

Electron 主进程优先加载 `dist-web/index.html`。
仅在以下情况允许回退旧版 `ui/index.html`：

- 开发模式（`app.isPackaged === false`）
- 显式设置环境变量：`VGO_ALLOW_LEGACY_UI_FALLBACK=1`

如果缺少 `dist-web` 且未开启回退，会显示错误提示页，避免生产环境误回退旧 UI。

## 常用命令

开发运行：

```powershell
npm start
```

构建前端：

```powershell
npm run build:web
```

目录版打包：

```powershell
npm run pack
```

安装包打包：

```powershell
npm run dist
```

## 本地 API 服务

单独启动本地 API：

```powershell
cd E:\VGO-CODE\server
npm start
```

默认接口：

- `GET /health`
- `GET /models`
- `POST /auth/register`
- `POST /auth/login`
- `POST /chat`

## 相关文档

- `docs/ARCHITECTURE.md`
- `docs/VGO-CORE-ROADMAP.md`
