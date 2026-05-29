## Goal
- 对 VGO CODE v1.3.0 Electron 桌面应用进行完整代码审查并执行 P0/P1 级代码优化重构

## Constraints & Preferences
- TypeScript 类型检查必须通过 (`npx tsc --noEmit`)
- Vite 生产构建必须成功 (`npx vite build`)
- Node.js 语法检查必须通过 (`node -c`)

## Progress
### Done
- 提取共享 mojibake 工具函数: 删除 `src/App.tsx`, `src/store/appStore.ts`, `src/i18n.ts` 中 3 份重复的 `looksLikeMojibake` / `tryRecoverMojibakeText` 实现, 统一到 `src/utils/mojibake.ts`
- 清理 `electron/preload.js` 中 5 处生产环境 `console.log` 调试语句
- 从 `Sidebar.tsx` (960 行) 提取 `ModelSelector` 组件到 `src/components/ModelSelector.tsx` (310 行), 包含模型面板、收藏/搜索/家族折叠逻辑
- 从 `Sidebar.tsx` 提取 `AuthPanel` 组件到 `src/components/AuthPanel.tsx` (126 行), 包含浏览器登录/密码登录/登出流程
- `Sidebar.tsx` 从 960 行缩减至 ~340 行
- 拆分 `SettingsModal.tsx` (1186→70 行): 提取 `settings/AppearanceTab`, `LanguageTab`, `BehaviorTab`, `AgentTab`, `RuntimeTab`, `ToggleRow` 到 `src/components/settings/` 目录
- 提升上下文容量: `contextCompression.js` 中 `MAX_SUMMARY_CHARS` 从 3600→30000, `KEEP_RECENT_MESSAGES` 从 30→40, `MAX_CONTEXT_TOKENS` 从 32000→128000, 每条摘要截断 220→2000 chars
- 提升适配器限制: `vgoRemoteAdapter.js` / `ollamaAdapter.js` 中 `MAX_HISTORY_MESSAGES` 从 24→60, `MAX_MESSAGE_CHARS` 从 5000→20000, `MAX_TOTAL_CHARS` 从 60000→500000
- 提升会话历史 cap: `state.js` 中 `slice(-120)→slice(-200)`
- 修复 `contextCompression.js` 中 2 处中文乱码 (`既有摘要`、`本轮压缩追加摘要`)
- 重构 `ollamaAdapter.js` (1928→1623 行): 用 `agentLoop.js` 替换自闭环, 移除 ~300 行重复循环控制函数; 运行 `node -c` 通过
- 重构 `vgoRemoteAdapter.js` 中 `runRealVgoPrompt`: 用 `agentLoop.js` 替换自闭环, 保留上游重试/限流/模型 fallback/usage 追踪; 运行 `node -c` 通过
- 拆分 `electron/main.js` (3274→1933 行) 为 IPC 处理模块: 创建 `electron/ipc/` 目录, 按领域拆分为 `chat.js`、`settings.js`、`update.js`、`misc.js`; 通过 context DI 模式注入共享状态; 全部 `node -c` 通过
- agentLoop.js: 包裹 `buildMessages` 在 try/catch 中, 防止未捕获异常击穿
- agentLoop 调用站点加 try/catch: ollamaAdapter.js + vgoRemoteAdapter.js runAgentLoop 包裹
- 修复 chat:send/abort 竞态: 用 `completed` 标志防止异步 abort 覆盖有效结果
- 替换 blocking spawnSync → spawnAsync: toolRuntime.js 中 runCommand/transcribeMedia/stopBackgroundProcess 改用 spawn+Promise, 解锁事件循环和 abort 中断能力
- 清理 sessionEventCounters Map 泄漏: chat:deleteSession 时删除对应计数器
- 清理 pendingPermissionRequests: renderer 崩溃时清空 pending permissions 和 active controllers
- Settings 写队列串行化: 通过 Promise chain 避免并发 IPC handler 相互覆盖
- 创建 `electron/core/toolAliases.js`: 统一 `TOOL_ALIASES` / `normalizeToolName` 单一数据源, `toolRuntime.js` 和 `toolResilience.js` 均导入共享模块
- 提取 `autoDiscoverAndInstallSkills` 辅助函数: ollamaAdapter.js 消除 ~190 行重复技能发现逻辑
- 修复 auth 轮询 interval 泄漏: 用 `clearInterval` 代替自定义清除函数, 确保 180s 超时也清理 interval

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- 用组合优于内联: 大型功能块 (模型选择器、认证面板、设置页各 tab) 拆为独立组件, 通过 props/store 消费共享状态
- 三模型渠道 (Ollama / VGO Remote Cloud / Custom HTTP) 统一调用 `agentLoop.js` 作为执行链路, 渠道差异封装在 `sendRequest` / `buildMessages` 回调内
- 上下文容量参数适配现代 LLM (128K-200K context window), 而非旧 32K 默认值
- IPC 模块化: 采用 context DI 模式, main.js 构建共享上下文 ctx 后注入各模块, 避免循环依赖
- 异步化: 用 `spawnAsync` (spawn+Promise) 替换 `spawnSync`, 解锁事件循环并使 abort 信号可中断长时间运行的命令
- 序列化写队列: settings 写操作通过 Promise chain 串行化, 避免并发 IPC handler 相互覆盖
- 工具别名统一: 提取 `toolAliases.js` 作为 `TOOL_ALIASES` / `normalizeToolName` 单一数据源, `toolRuntime.js` 和 `toolResilience.js` 均导入共享模块
- 技能发现去重: 提取 `autoDiscoverAndInstallSkills` 辅助函数, 消除 ollamaAdapter.js 中 190 行重复逻辑

## Next Steps
- P1: 将 `src/styles/global.css` (3774 行) 按组件拆分 (CSS Modules 或改用 Tailwind)
- P1: 统一 `any` 类型为具体接口定义
- P2: 迁移硬编码品牌文本到 i18n
- P2: 添加 ESLint/Prettier 配置
- P2: 清理 main.js 中残余的死代码函数 (~30 个函数重复于 ipc 模块)

## Critical Context
- 项目版本号: 根目录 `package.json` v1.3.0, `src/package.json` v1.2.1, 版本不一致待修复
- 根目录 `electron ^36.3.0` 与 `src/` 内 `electron ^30.0.0` 版本不一致
- 构建产物输出到 `dist-web/` 目录 (outDir: `../dist-web`)
- `App.tsx:586-593` 仍有每 3 秒状态轮询, 建议改为 IPC 事件推送
- 三模型渠道统一执行链路后, VGO Remote Cloud 特有的工具协议/修复任务/受保护路径等 nudge 暂未迁移到 agentLoop
- `vgoRemoteAdapter.js` 中仍有部分重复函数 (extractRequestedFilePaths, collectCompletedReadPaths, 等), 待后续清理
- `toolRuntime.js` 中仍有 `fs.existsSync` / `readFileSync` 等同步 FS 调用 (~20 处), 非关键路径但长期建议迁移到 `fs.promises`

## Relevant Files
- `src/utils/mojibake.ts`: 共享乱码检测/恢复工具函数, 合并 3 份重复实现
- `src/components/ModelSelector.tsx`: 模型选择组件 (从 Sidebar 提取)
- `src/components/AuthPanel.tsx`: 登录/认证面板组件 (从 Sidebar 提取)
- `src/components/Sidebar.tsx`: 从 960→~340 行
- `src/components/SettingsModal.tsx`: 从 1186→70 行
- `src/components/settings/`: 新建目录, 含 `AppearanceTab.tsx` (68L), `LanguageTab.tsx` (46L), `BehaviorTab.tsx` (107L), `AgentTab.tsx` (130L), `RuntimeTab.tsx` (801L), `ToggleRow.tsx` (25L)
- `electron/core/contextCompression.js`: `MAX_SUMMARY_CHARS=30000`, `MAX_CONTEXT_TOKENS=128000`, `KEEP_RECENT_MESSAGES=40`, 每条摘要 2000 chars
- `electron/core/vgoRemoteAdapter.js`: `REMOTE_MAX_HISTORY_MESSAGES=60`, `REMOTE_MAX_TOTAL_CHARS=500000`; 改用 `agentLoop.js` 执行链路
- `electron/core/ollamaAdapter.js`: 1928→1623 行, 移除 ~300 行重复函数; `OLLAMA_MAX_HISTORY_MESSAGES=60`, `OLLAMA_MAX_TOTAL_CHARS=500000`; 改用 `agentLoop.js` 执行链路
- `electron/core/state.js`: 会话历史 cap `slice(-200)`
- `electron/core/agentLoop.js`: 统一执行入口 — Ollama / VGO Remote Cloud / Custom HTTP 三渠道均通过 `runAgentLoop` 执行
- `electron/core/toolAliases.js`: 共享工具别名映射, `toolRuntime.js` 和 `toolResilience.js` 共同导入
- `electron/main.js`: 3274→1933 行 — IPC 处理器已拆至 `electron/ipc/`
- `electron/ipc/`: IPC 模块目录
  - `chat.js`: 聊天 IPC 处理器 (chat:send/abort/resetSession 等 10 个 handler) + 会话总结/权限请求/事件格式等辅助函数
  - `settings.js`: 设置/认证/Profile 管理 IPC 处理器 (settings:* runtime:* 共 20+ handler) + VGO AI 登录/浏览器认证/Profile CRUD 等辅助函数
  - `update.js`: 更新 IPC 处理器 (update:* 共 6 个 handler) + 下载/安装/升级脚本等函数
  - `misc.js`: 杂项 IPC 处理器 (workspace:analyze, dialog:*, shell:*, history:export, auth:openLoginTerminal 等)
