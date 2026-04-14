# VGO AI 本地执行器与数字员工执行链路

## 当前目标

让 `VGO AI` 的数字员工从“讨论和出方案”升级成“审批后可实际执行任务”。

这里采用的原则是：

- 云端负责：任务拆解、团队协作、审批、记忆、执行编排
- 本地负责：文件、脚本、日志、截图、操作系统级动作
- 云端不直接裸连本地电脑
- 高风险动作必须经过审批

## 推荐链路

1. 用户在站内工作台创建任务
2. 数字员工生成结构化执行计划
3. 系统把本地相关动作标记为待审批
4. 用户审批后，动作包发送给本地桥接器
5. 本地桥接器调用 Open Interpreter 执行
6. 执行结果、日志和产物回传 VGO AI
7. 工作台沉淀审计记录和最终交付

## 本地部署位置

- Python 3.12: `E:\Python312`
- Open Interpreter 虚拟环境: `E:\VGO-Local-Executor\oi312-env`
- 启动入口: `E:\VGO-Local-Executor\launch-open-interpreter.bat`
- 本地桥接器建议目录: `E:\VGO-Local-Executor\bridge`

## 第一阶段允许的动作

- 读取白名单目录
- 生成 Markdown / TXT / JSON 产物
- 执行白名单 PowerShell / Python 脚本
- 拉取指定日志并回传摘要
- 输出截图、日志、产物路径和执行状态

## 第一阶段禁止的动作

- 未审批直接删除文件
- 修改系统级配置
- 访问白名单外敏感目录
- 静默执行高风险命令
- 将本地系统权限直接暴露给云端

## 本地桥接器建议能力

- 轮询云端待执行任务
- 校验任务签名与审批状态
- 将动作映射到本地命令模板
- 调用 Open Interpreter
- 回传 stdout / stderr / 产物 / 截图 / 状态码

## 第一版接口

- 管理端
  - `GET /api/v1/chat/local-bridge/bridges`
  - `POST /api/v1/chat/local-bridge/bridges`
  - `GET /api/v1/chat/local-bridge/jobs`
  - `POST /api/v1/chat/local-bridge/bridges/:id/jobs`
  - `POST /api/v1/chat/workspace/deliverables/:id/queue-local`
- 本地桥接器
  - `POST /api/v1/chat/local-bridge/agent/heartbeat`
  - `GET /api/v1/chat/local-bridge/agent/jobs/next`
  - `POST /api/v1/chat/local-bridge/agent/jobs/:id/start`
  - `POST /api/v1/chat/local-bridge/agent/jobs/:id/complete`
  - `POST /api/v1/chat/local-bridge/agent/jobs/:id/fail`

## 当前下载产物

- Open Interpreter 安装脚本
  - `/downloads/vgo-open-interpreter-installer.ps1`
- 本地桥接脚本
  - `/downloads/vgo-local-bridge.py`
- 本地桥接配置模板
  - `/downloads/vgo-local-bridge.example.json`

## 最新进展：数字员工交付已可自动生成本地动作

现在工作台交付物会自动带上 `localActions`：

- 从领导计划生成动作
- 从最终总结生成动作
- 从成员产出生成动作

这些动作会显示在 `/workspace` 的最新交付物区域，并支持一键排队到 Local Bridge。

## 站内产品落地建议

- `workspace` 负责任务、审批、交付
- `teams` 负责团队协作与分工
- `developers/local-executor` 负责部署说明和下载入口
- 后续再新增 `bridge` 管理页，用于绑定本地设备、查看在线状态和最近执行记录

## 后续阶段

### 第二阶段

- 本地桥接器常驻
- 支持断点续跑
- 支持更细的执行状态回传
- 支持截图与产物打包上传

### 第三阶段

- 接入更强的本地执行器生态
- 支持浏览器自动化、桌面自动化
- 支持多台本地机器并行执行
- 支持本地与云端数字员工联合编排
