# VGO CODE

VGO CODE 是一个桌面版 Agent 工作台。

当前开发目录已经整理为以源码、资源、文档和脚本分层的结构，便于继续做 Agent 能力开发、调试和打包。

## 当前能力

- Electron 桌面端
- 多会话管理
- 可切换运行内核
- `VGO AI` 一键绑定
- 本地 `VGO AI API` 样板服务
- 初版 Agent 工具运行时

## 工程结构

```text
E:\VGO-CODE
├─ build                # 打包资源，例如图标
├─ docs                 # 架构文档与路线文档
├─ electron
│  └─ core              # 桌面主进程与 Agent/引擎核心
├─ scripts              # 启动与调试脚本
├─ server
│  └─ lib               # 本地 API 样板服务
├─ ui
├─ vendor               # 内置兼容 CLI 资源
├─ README.md
└─ package.json
```

说明：

- `dist/` 是打包产物目录，已从开发目录中清理；需要时重新执行打包生成。
- `node_modules/` 是本地依赖，不属于源码结构本身。

## 运行方式

开发模式：

```powershell
npm start
```

目录版打包：

```powershell
npm run pack
```

打包后启动目录版：

```powershell
scripts\start-vgo-code.bat
```

调试启动目录版：

```powershell
scripts\debug-vgo-code.bat
```

独立本地 API 服务：

```powershell
cd E:\VGO-CODE\server
npm start
```

## 文档

- [ARCHITECTURE.md](E:\VGO-CODE\docs\ARCHITECTURE.md)
- [VGO-CORE-ROADMAP.md](E:\VGO-CODE\docs\VGO-CORE-ROADMAP.md)

## 本地 VGO AI API

`server/` 现在是一个独立的本地样板后端，接口包括：

- `GET /health`
- `GET /models`
- `POST /auth/register`
- `POST /auth/login`
- `POST /chat`

桌面端默认会自动拉起它，并把 `VGO Remote Engine` 指向该服务。

## VGO AI 绑定流程

在桌面端中可以：

1. 同步模型列表
2. 选择模型
3. 一键登录并绑定 `VGO AI`
4. 自动切换到 `VGO Remote Engine`

## 当前定位

现在的 `VGO CODE` 已经不是单纯的兼容壳，而是一个具备前后端边界、运行内核边界和品牌形态的本地产品样板。
