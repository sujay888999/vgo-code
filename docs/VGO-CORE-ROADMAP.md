# VGO CORE Roadmap

当前桌面程序已经把“运行内核”从 UI 层抽离成了独立适配器：

- `electron/core/state.js`
  管理多会话、本地状态和序列化
- `electron/core/bundledCliAdapter.js`
  负责调用当前内置 CLI 包
- `electron/core/workspaceTools.js`
  负责目录分析等与引擎无关的本地能力

这意味着后续要继续去品牌化时，可以沿着下面的路径推进：

## 第一阶段

- 保留当前 UI
- 新增第二个引擎适配器，例如 `openaiAdapter.js` 或 `vgoRemoteAdapter.js`
- 让 UI 只依赖统一接口：
  - `runPrompt`
  - `runHealthCheck`
  - `openLoginShell`

## 第二阶段

- 将当前 `bundledCliAdapter` 降级为兼容模式
- 默认切换到你自己的 `VGO Engine`
- 把会话格式、登录方式、模型配置彻底改成自有协议

## 第三阶段

- 接入任务队列、流式输出、工具注册表
- 替换现有“外部 CLI 调用”模式
- 做成完全独立的 Agent Desktop

## 当前状态

当前工程已经具备“兼容层 + UI 层 + 状态层”的边界，可以继续往真正独立产品演进，而不需要重写整个桌面端。
