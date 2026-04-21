# VGO CODE 架构说明

## 当前架构（迁移后）

`VGO CODE` 已完成前端迁移，运行链路为：

1. 前端源码层：`src/`（React + Vite + TypeScript）
2. 前端构建产物：`dist-web/`（Electron 加载入口）
3. 桌面主进程层：`electron/main.js` + `electron/core/*`
4. 本地服务层：`server/`

## 关键目录

```text
E:\VGO-CODE
├─ electron
│  ├─ main.js
│  ├─ preload.js
│  └─ core/
├─ src/                  # 前端源码（开发入口）
├─ dist-web/             # 前端构建产物（运行入口）
├─ server/
├─ docs/
└─ ui/                   # 旧版静态页面（仅兼容兜底，不作为主链路）
```

## 加载策略

`electron/main.js` 的窗口加载逻辑：

1. 优先加载 `dist-web/index.html`
2. 仅在开发模式或显式设置 `VGO_ALLOW_LEGACY_UI_FALLBACK=1` 时，允许回退到 `ui/index.html`
3. 其它情况下，若缺少 `dist-web`，直接显示错误提示页，避免线上误回退到旧 UI

## 开发与发布

- 开发前端：在 `src/` 下进行组件与样式改动
- 生成运行产物：`npm run build:web`
- Electron 打包时依赖 `dist-web/**/*`

## 迁移约束

- 新功能默认落在 `src/`，不再向 `ui/renderer.js` 添加业务逻辑
- 自动分析/修复的前置检查文件统一指向 `src/*`
- `ui/` 目录仅用于短期兼容，后续可按发布节奏下线
