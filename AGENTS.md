## Goal
- 对 VGO CODE v1.3.0 Electron 桌面应用执行 P0/P1/P2 级代码优化：执行链稳定性、竞态修复、异步化、资源泄漏清理、本地与自定义模型配置统一、CSS 拆分、类型安全、ESLint/Prettier 配置、i18n 品牌文本迁移、死函数/死代码清理、共享函数集中化、白屏 bug 修复、任务面板移除、NVIDIA 模型渗透过滤、托盘图标修复、安全日志清理、构建优化（依赖瘦身/体积最小化/Vite 加速/DX 改进）、toolRuntime FS 全异步化、剩余模块 sync FS 迁移

## Constraints & Preferences
- TypeScript 类型检查必须通过 (`npx tsc --noEmit`)
- Vite 生产构建必须成功 (`npx vite build`)
- ESLint 必须 0 errors 0 warnings (`npx eslint . --max-warnings 0`)
- Node.js 语法检查必须通过 (`node -c`)
- 构建优化后 `npm run build` 产出必须正常

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
- 统一本地模型与自定义模型为一个地址配置: 废弃 `ollamaUrl` 字段, 全部使用 `baseUrl`;
  URL 自动检测协议 (Ollama / OpenAI 兼容 / Legacy),
  Profile 间切换改用 `resolveEngineIdForProfile` + URL 规则,
  `ollamaAdapter.js` / `vgoRemoteAdapter.js` / `settings.js` / `main.js` 全部移除 `ollamaUrl` 逻辑,
  IPC 的 `createRemoteProfile` / `updateRemoteProfile` / `selectRemoteProfile` / `deleteRemoteProfile` / `refreshRemoteProfileModels` 简化,
  `RuntimeTab.tsx` 重写为统一表单 (无 Ollama/Custom HTTP 切换),
  `ModelSelector.tsx` 合并本地模型与自定义模型为同一个 "本地/自定义模型" 区块,
  CSS 新增 `.endpoint-badge` / `.protocol-badge` / `.protocol-detect-row` 样式
- 拆分 `src/styles/global.css` (3816→27 行, import hub): 按组件/功能拆分为 26 个 CSS 文件 (`variables.css`, `sidebar.css`, `message-list.css`, `settings.css` 等), 零组件代码变更
- 统一 `any` 类型 (50→0 处):
  - `electron.d.ts`: `Promise<any>` → `Promise<DesktopResult | UpdateInfo | DesktopState>`, `payload: any` → `Record<string, unknown>`, `args: any[]` → `unknown[]`
  - `App.tsx`: `payload: any` → `Record<string, unknown>`, `skill: any` → `Record<string, unknown>`
  - `appStore.ts`: `state: any` → `Record<string, unknown>`, `entry: any` → `Record<string, unknown>`
  - 9 处 `catch (error: any)` → `catch (error: unknown)` + `error instanceof Error` 窄化
  - 3 处 `as any` 类型断言 → 具体联合类型断言
- 迁移硬编码品牌文本到 i18n: 新增 ~70 个 i18n 键 (zh-CN/en-US), 更新 Sidebar/ModelSelector/MainPanel/RuntimeTab/MessageList/AgentTracePanel/TaskPanel/App 中所有硬编码字符串
- 添加 ESLint + Prettier 配置:
  - 创建 `src/eslint.config.js` (flat config v9) + `src/.prettierrc`
  - 修复 31 个 lint 问题: 移除无用 React imports (11 处)、删除死代码函数 (5 个)、移除未使用变量 (6 个)、修复 set-state-in-effect (4 处)、补齐缺失依赖
  - `npx eslint . --max-warnings 0` ✅ | `npx tsc --noEmit` ✅ | `npx vite build` ✅
- 清理 main.js 中 6 个死函数: 移除 `mergeSettingsSection`, `installWhisperRuntime`, `resolveActualModelLabel`, `getSelectedModelId`, `resolveTaskRuntimeLimitMs`, `readAttachmentPreview`
- 移除 unused import: 删除 `https` 模块导入, 简化 `spawnSync` → `spawn`
- 统一 `syncRemoteProfileState` + `isVgoManagedCloudProfile` (3→1 共享):
  - 移至 `electron/core/settings.js` 并导出
  - main.js + ipc/settings.js 均从 `./core/settings` 导入
  - 修复 main.js 中 `syncRemoteProfileState` 调用参数顺序错误 (第 1 个参数应为完整 settings, 而非 remote 子对象)
  - 简化 `savePreferredModelIfChanged` (消除不必要的 `let`)
- main.js 从 1930→1788 行 (移除 ~142 行死代码)
- **构建优化 Phase 1 — 依赖清理**：移除根 devDeps 中 `icon-gen`/`playwright`/`png-to-ico`/`to-ico`/`sharp`；移除根 `dependencies` 中 `app-builder-bin`（transitive dep）；移除 `src/package.json` 中重复的 `electron`/`electron-builder`；`npm install` 后净省 271 MB 磁盘
- **构建优化 Phase 2 — vendor 瘦身**：重写 `scripts/afterPack.js`，打包时删除 `cli.js.map`（58 MB）、跨平台 ripgrep/audio-capture 二进制（保留当前平台）、元数据文件（bun.lock/LICENSE/README/sdk-tools.d.ts）；净省 ~68 MB ASAR 体积
- **构建优化 Phase 3 — Vite 加速**：`build.reportCompressedSize: false`（跳过 gzip 计算），`build.sourcemap: false`，`build.target: es2020`；移除无效的 `ui-vendor` manualChunk（lucide-react 已自动合并）
- **构建优化 Phase 4 — DX 改进**：根 `dev`/`start` 脚本改为 `npm run build:web && electron .`（避免白屏）；`src/package.json` 版本 `1.2.1` → `1.3.0` 与根统一
- **剩余模块 sync FS → async 迁移**：
  - `electron/core/engineLog.js`：`appendEngineLog` + `normalizeEngineLogFile` 改为 async（fsp.mkdir/access/writeFile/appendFile/readFile替换对应sync调用）；fire-and-forget `catch(() => {})` 保留异常安全
  - `electron/ipc/misc.js`：`readAttachmentPreview` + `exportHistory` 改为 async（fsp.stat/readFile/writeFile替换statSync/readFileSync/writeFileSync）；`dialog:pickFiles` IPC handler 同步 map → Promise.all
  - `electron/ipc/update.js`：`downloadInstallerFile` async（fsp.mkdir前置到Promise外）、`launchWindowsUpgradeScript` async（fsp.mkdir/readFile/writeFile/appendFile替换同步调用）、`installUpdatePackage` 中 fsp.stat 替换 statSync
  - `electron/main.js`：移除死函数 `exportHistory`（1647-1679行，从未被调用，含writeFileSync）；`normalizeEngineLogFile` 调用加 await
  - `electron/core/ollamaAdapter.js` + `vgoRemoteAdapter.js`：`logRuntime` 中 `appendEngineLog` 返回的 Promise 加 `.catch(() => {})` 确保 fire-and-forget
- main.js 从 1788→1748 行 (再移除 ~40 行死代码)
- **修复 NVIDIA 模型残留（第三轮 - 持久化路径）**：NVIDIA 过滤之前只在 `fetchRealVgoModels`（API 拉取路径）生效，但磁盘缓存的 stale 数据在 `loadSettings` → `normalizeModelCatalog` 路径中不经过滤；现已在 `settings.js` 的 `normalizeModelCatalog` 和 `dedupeModelCatalog` 中均添加 `/^nvidia\//i` 过滤，确保所有数据路径（API 拉取 + 磁盘加载 + 前端 UI）三层过滤 NVIDIA 模型

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
- 模型配置统一: 废弃 `ollamaUrl`/provider 双重路由, URL 自动检测协议
- 共享函数集中化: 将跨模块共享的 `syncRemoteProfileState` / `isVgoManagedCloudProfile` 移至 `electron/core/settings.js` 作为单一数据源
- FS 全异步化策略: toolRuntime.js 全部 37 处 sync FS 调用已整模块迁移；engineLog/misc/update 等剩余模块的 sync FS 也已迁移（12 处 → async）；settings/state/versionChecker/localSkillDiscovery 因混合 sync/async 调用方保持 sync（小文件+非关键路径）
- vendor 清理策略: 在 `afterPack.js`（electron-builder hook）中按平台过滤二进制并删除 source map，而非修改 `files` 配置

## Next Steps
- P2: App.tsx:586-593 每 3 秒状态轮询 → IPC 事件推送
- 待办: vgoRemoteAdapter.js 中 `extractRequestedFilePaths`/`collectCompletedReadPaths` 等重复函数清理
- 待办: `electron/preload.js` 中确认 `looksLikeMojibake` 导入路径存在 (verify 导入来自 `src/utils/mojibake.ts`)

## Critical Context
- 项目版本号: 根目录 `package.json` v1.3.3, `src/package.json` v1.3.3（已统一）
- 根目录 `electron ^36.3.0` 与 `src/` 之前 `electron ^30.0.0` 版本不一致已解决（src 中已移除 electron）
- 构建产物输出到 `dist-web/` 目录（`outDir: ../dist-web`）；`electron .` 直接加载 `dist-web/index.html`
- `npm run build:web` 在 `src/` 下运行 `tsc && vite build`
- 修改前端文件后必须执行 `npm run build:web` 才能反映到 `electron .` 启动的应用中
- `npm run dev` / `start` 现在自动先执行 `npm run build:web` 再启动 Electron
- `App.tsx:586-593` 仍有每 3 秒状态轮询, 建议改为 IPC 事件推送
- 三模型渠道统一执行链路后, VGO Remote Cloud 特有的工具协议/修复任务/受保护路径等 nudge 暂未迁移到 agentLoop
- `toolRuntime.js` 已全部异步化（零同步 FS 调用），17 个导出函数均为 async
- `engineLog.js`、`misc.js`、`update.js` 的 sync FS 调用已迁移到 async；`settings.js`/`state.js`/`versionChecker.js`/`localSkillDiscovery.js` 保持 sync（混合调用方或非关键路径）
- `normalizeEngineLogFile` 调用在 main.js 和 ipc/settings.js 均已加 await
- `update.js` 的 `downloadInstallerFile`/`launchWindowsUpgradeScript` 已 async，`installUpdatePackage` 中用 fsp.stat 替代 statSync
- 构建优化节省：磁盘 271 MB + ASAR ~68 MB
- 构建安全验证：所有变更通过 `tsc --noEmit` + `vite build` + `node -c` + `eslint --max-warnings 0`

## Relevant Files
- `src/utils/mojibake.ts`: 共享乱码检测/恢复工具函数, 合并 3 份重复实现
- `src/types/electron.d.ts`: IPC API 类型定义, 已移除 `any`, 使用 `DesktopResult | UpdateInfo | DesktopState` + `Record<string, unknown>`
- `src/components/ModelSelector.tsx`: 模型选择组件 (从 Sidebar 提取)
- `src/components/AuthPanel.tsx`: 登录/认证面板组件 (从 Sidebar 提取)
- `src/components/Sidebar.tsx`: 从 960→~340 行
- `src/components/SettingsModal.tsx`: 从 1186→70 行
- `src/components/settings/`: 新建目录, 含 `AppearanceTab.tsx` (68L), `LanguageTab.tsx` (46L), `BehaviorTab.tsx` (107L), `AgentTab.tsx` (130L), `RuntimeTab.tsx` (710L), `ToggleRow.tsx` (25L)
- `src/styles/`: 26 个 CSS 文件, 从 global.css 拆分 (`variables.css`, `sidebar.css`, `message-list.css`, `settings.css` 等)
- `src/store/appStore.ts`: zustand store, hydrate/entry 已替换 `any` 为 `Record<string, unknown>`
- `electron/core/contextCompression.js`: `MAX_SUMMARY_CHARS=30000`, `MAX_CONTEXT_TOKENS=128000`, `KEEP_RECENT_MESSAGES=40`, 每条摘要 2000 chars
- `electron/core/vgoRemoteAdapter.js`: `REMOTE_MAX_HISTORY_MESSAGES=60`, `REMOTE_MAX_TOTAL_CHARS=500000`; 改用 `agentLoop.js` 执行链路
- `electron/core/ollamaAdapter.js`: 1928→1623 行, 移除 ~300 行重复函数; `OLLAMA_MAX_HISTORY_MESSAGES=60`, `OLLAMA_MAX_TOTAL_CHARS=500000`; 改用 `agentLoop.js` 执行链路
- `electron/core/state.js`: 会话历史 cap `slice(-200)`
- `electron/core/agentLoop.js`: 统一执行入口 — Ollama / VGO Remote Cloud / Custom HTTP 三渠道均通过 `runAgentLoop` 执行
- `electron/core/toolAliases.js`: 共享工具别名映射, `toolRuntime.js` 和 `toolResilience.js` 共同导入
- `electron/core/settings.js`: 共享函数中心 — 含 `isVgoManagedCloudProfile`、`syncRemoteProfileState`、`DEFAULT_SETTINGS`、`loadSettings`、`saveSettings` 等
- `electron/main.js`: 3274→1788 行 — IPC 处理器已拆至 `electron/ipc/`, 移除 6 个死函数, 清理 unused imports
- `electron/ipc/`: IPC 模块目录
  - `chat.js`: 聊天 IPC 处理器 (chat:send/abort/resetSession 等 10 个 handler) + 会话总结/权限请求/事件格式等辅助函数
  - `settings.js`: 设置/认证/Profile 管理 IPC 处理器 (settings:* runtime:* 共 20+ handler) + VGO AI 登录/浏览器认证/Profile CRUD 等辅助函数
  - `update.js`: 更新 IPC 处理器 (update:* 共 6 个 handler) + 下载/安装/升级脚本等函数
  - `misc.js`: 杂项 IPC 处理器 (workspace:analyze, dialog:*, shell:*, history:export, auth:openLoginTerminal 等)
