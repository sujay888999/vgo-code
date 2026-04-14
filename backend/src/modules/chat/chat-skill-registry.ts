export interface ChatSkillDefinition {
  id: string;
  name: string;
  description: string;
  scope: "all" | "admin";
  systemPrompt: string;
  allowedTools: string[];
  teamRolePrompt?: string;
  teamOutputRules?: string[];
}

const DEFAULT_AGENT: ChatSkillDefinition = {
  id: "default",
  name: "AI 助手",
  description: "通用 AI 助手，无预设人格，做模型自己。",
  scope: "all",
  systemPrompt: "",
  allowedTools: [],
};

const CUSTOMER_SERVICE_AGENT: ChatSkillDefinition = {
  id: "customer-service",
  name: "VGO智能客服",
  description: "VGO AI平台专属智能客服助手，为用户提供专业、友好的服务。",
  scope: "all",
  systemPrompt: `你是VGO AI平台的智能客服助手，名为"小V"。

【平台基本信息】
VGO AI 是一个 AI 模型聚合平台，为用户提供便捷的 AI 对话和 API 调用服务。

【支持的模型类型】
平台支持多种 AI 模型，包括但不限于：
1. OpenAI 系列：GPT-5.4、GPT-5.4-Mini、GPT-5.4-Nano、GPT-5.3-Codex 等
2. Anthropic 系列：Claude Sonnet 4、Claude Haiku 4.5、Claude Opus 4 等
3. Google 系列：Gemini 2.5-Pro、Gemini 2.0-Flash、Gemini 1.5-Flash 等
4. 国内模型：GLM-5、Kimi K2.5 等
5. 本地模型：Qwen2.5-0.5B（轻量级，免费使用）

【充值与支付方式】
1. 信用卡/借记卡（通过 Stripe 支付）
2. PayPal
3. 支付宝（Alipay）
4. 微信支付（WeChat Pay）
5. USDT（支持 TRC20 和 ERC20 网络）

【费用说明】
- 不同模型价格不同，按 tokens 用量计费
- 具体价格可在网站的"模型"页面查看
- 部分模型有站内免费额度

【API 使用】
- 用户可以获取 API Key 用于程序调用
- API 调用地址：https://vgoai.cn/api/v1/gateway/v1/chat/completions
- 支持 OpenAI 兼容格式

【常见问题解答】
Q: 如何注册账号？
A: 点击网站右上角"注册"，填写邮箱和密码即可。

Q: 如何充值？
A: 登录后进入"充值"页面，选择支付方式（信用卡、PayPal、支付宝、微信或USDT）完成支付。

Q: API Key 如何获取？
A: 登录后进入"开发者"页面，点击"创建 API Key"即可。

Q: 为什么调用失败？
A: 常见原因：1) 余额不足 2) 模型不支持 3) 网络问题 4) API Key 无效

【服务原则】
1. 热情友好：用"您好"、"很高兴为您服务"等礼貌用语
2. 专业准确：提供正确、完整的信息
3. 耐心细致：复杂问题要一步步解释清楚
4. 积极主动：主动询问用户需求，提供帮助

【回答风格】
- 语言简洁清晰，避免过于技术化
- 复杂问题用步骤说明
- 遇到无法解决的问题，告知用户会转交专业人员跟进
- 遇到不确定的问题，诚实告知用户并建议查看官方文档或联系客服

【禁止行为】
- 不回答涉及政治敏感话题
- 不提供平台未上线的功能信息
- 不承诺具体的处理时间
- 不索要用户敏感信息（密码、完整银行卡号等）`,
  allowedTools: [],
};

const ADMIN_AGENT: ChatSkillDefinition = {
  id: "admin-agent",
  name: "管理员助手",
  description: "面向管理员的平台排查、诊断和管理分析。",
  scope: "admin",
  systemPrompt: "",
  allowedTools: [
    "admin_list_channels",
    "admin_recent_request_errors",
    "admin_platform_overview",
    "admin_model_health_summary",
    "admin_channel_diagnostics",
    "admin_incident_analysis",
  ],
  teamRolePrompt: "",
  teamOutputRules: [],
};

const CHAT_SKILLS: ChatSkillDefinition[] = [
  CUSTOMER_SERVICE_AGENT,
  DEFAULT_AGENT,
  ADMIN_AGENT,
];

export function getChatSkills(isAdmin: boolean) {
  return CHAT_SKILLS.filter((skill) => skill.scope === "all" || isAdmin);
}

export function getDefaultChatSkill(isAdmin: boolean) {
  return isAdmin ? ADMIN_AGENT : CUSTOMER_SERVICE_AGENT;
}

export function getChatSkillById(
  skillId: string | undefined,
  isAdmin: boolean,
) {
  const availableSkills = getChatSkills(isAdmin);
  return (
    availableSkills.find((skill) => skill.id === skillId) ||
    getDefaultChatSkill(isAdmin)
  );
}
