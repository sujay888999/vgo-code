# VGO CODE 架构分析

## 当前工程定位

`VGO CODE` 现在已经不是单纯的 Electron 壳，而是一个带有运行内核抽象层的桌面 Agent 工作台。

当前结构被拆成三层：

1. UI 层
2. 状态层
3. 运行内核适配层

这样做的目的，是为了把现有内置 CLI 先作为兼容模式保留，同时为以后替换成你自己的引擎留出明确边界。

## 当前目录结构

```text
E:\VGO-CODE
├─ build
│  ├─ icon.ico
│  └─ icon.png
├─ dist
│  └─ win-unpacked
├─ electron
│  ├─ core
│  │  ├─ bundledCliAdapter.js
│  │  ├─ state.js
│  │  └─ workspaceTools.js
│  ├─ main.js
│  └─ preload.js
├─ ui
│  ├─ index.html
│  ├─ logo.png
│  ├─ renderer.js
│  └─ styles.css
├─ vendor
│  └─ package
├─ ARCHITECTURE.md
├─ README.md
├─ VGO-CORE-ROADMAP.md
└─ package.json
```

## 各层职责

### 1. UI 层

文件：

- `ui/index.html`
- `ui/renderer.js`
- `ui/styles.css`

职责：

- 多会话列表展示
- 当前会话消息展示
- 工作台操作入口
- 品牌视觉呈现

UI 层不直接操作 CLI，只通过预加载暴露的接口调用主进程。

### 2. 状态层

文件：

- `electron/core/state.js`

职责：

- 会话创建、切换、删除
- 当前活跃会话管理
- 历史记录持久化
- 会话标题自动命名
- 全局运行状态序列化

这层已经把“会话管理”从主进程杂糅逻辑中抽离出来了。

### 3. 运行内核适配层

文件：

- `electron/core/bundledCliAdapter.js`

职责：

- 调用当前打包好的 CLI
- 解析 `stream-json` 输出
- 执行健康检查
- 打开登录终端

这层是当前最关键的去耦点。现在它只是一个适配器，不再和 UI 或状态逻辑强绑定。

### 4. 工作区工具层

文件：

- `electron/core/workspaceTools.js`

职责：

- 分析当前目录
- 生成目录树摘要

这类能力未来可以保留，不依赖具体模型或后端。

## 当前运行模式

当前版本仍然使用：

- `vendor/package/cli.js`

作为底层兼容运行内核。

也就是说，`VGO CODE` 现在的真实模式是：

`自有桌面端 + 自有状态层 + 兼容型内核适配器`

而不是：

`完全自研 Agent 内核`

## 已经完成的产品化能力

- 多会话管理
- 当前会话导出
- 当前会话清空
- 健康检查
- 目录分析
- 品牌图标与桌面视觉
- 目录版打包产物输出

## 下一步最合理的演进路线

### 路线 A：继续兼容层增强

- 增加更多桌面能力
- 做会话搜索、标签、排序
- 加任务面板和文件面板

### 路线 B：替换底层引擎

- 新增 `openaiAdapter.js` 或 `vgoRemoteAdapter.js`
- 保持 UI 不变
- 逐步弱化对 `bundledCliAdapter` 的依赖

### 路线 C：完全独立 Agent 内核

- 自己定义会话协议
- 自己定义工具协议
- 自己定义模型接入层
- 把当前兼容内核变成可选模式

## 结论

当前工程已经完成了最重要的一步：把“桌面产品形态”和“底层运行内核”拆开了。

这意味着你后续继续做 `VGO CODE`，不需要推翻整个桌面端，而是可以围绕适配器层逐步把底层替换成你自己的 Agent 系统。
