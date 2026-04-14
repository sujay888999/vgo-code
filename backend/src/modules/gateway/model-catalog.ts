export interface ModelPreset {
  label: string;
  summary: string;
  family: string;
  tags: string[];
  hidden?: boolean;
}

export const MODEL_PRESETS: Record<string, ModelPreset> = {
  "gpt-4o-mini": {
    label: "GPT-4o mini",
    summary: "适合高并发、低成本的通用对话与基础工作流。",
    family: "OpenAI",
    tags: ["chat", "text", "fast"],
  },
  "gpt-4.1": {
    label: "GPT-4.1",
    summary: "适合更复杂的指令理解、内容生成与工作流编排。",
    family: "OpenAI",
    tags: ["chat", "reasoning", "quality"],
  },
  "gpt-4.1-mini": {
    label: "GPT-4.1 mini",
    summary: "兼顾速度与质量，适合大多数日常 API 调用场景。",
    family: "OpenAI",
    tags: ["chat", "balanced"],
  },
  "claude-3-5-sonnet": {
    label: "Claude 3.5 Sonnet",
    summary: "适合长文本处理、总结、写作与企业场景问答。",
    family: "Anthropic",
    tags: ["chat", "writing", "analysis"],
  },
  "claude-3-5-haiku": {
    label: "Claude 3.5 Haiku",
    summary: "适合低延迟问答、轻量工作流与日常客服协作。",
    family: "Anthropic",
    tags: ["chat", "fast", "lightweight"],
  },
  "claude-3-7-sonnet": {
    label: "Claude 3.7 Sonnet",
    summary: "适合复杂问答、深度分析和高质量文本生成。",
    family: "Anthropic",
    tags: ["chat", "analysis", "quality"],
  },
  "claude-sonnet-4": {
    label: "Claude Sonnet 4",
    summary: "适合高质量分析、复杂问答与稳定企业协作场景。",
    family: "Anthropic",
    tags: ["chat", "analysis", "quality"],
  },
  "claude-haiku-4-5": {
    label: "Claude Haiku 4.5",
    summary: "适合快速响应、轻量自动化与大规模低成本调用。",
    family: "Anthropic",
    tags: ["chat", "fast", "economical"],
  },
  "gemini-1.5-pro": {
    label: "Gemini 1.5 Pro",
    summary: "适合多轮问答、内容理解和跨模态工作流。",
    family: "Google",
    tags: ["chat", "multimodal"],
  },
  "gemini-1.5-flash": {
    label: "Gemini 1.5 Flash",
    summary: "适合高速问答、轻量生成与高并发调用。",
    family: "Google",
    tags: ["chat", "fast", "multimodal"],
  },
  "gemini-2.0-flash": {
    label: "Gemini 2.0 Flash",
    summary: "适合低延迟多轮对话、多模态输入与高并发服务。",
    family: "Google",
    tags: ["chat", "multimodal", "fast"],
  },
  "gemini-2.5-pro": {
    label: "Gemini 2.5 Pro",
    summary: "适合更复杂的推理、分析和高质量内容生成。",
    family: "Google",
    tags: ["chat", "reasoning", "multimodal"],
  },
  "gpt-5.4": {
    label: "GPT 5.4",
    summary: "适合高质量通用对话、复杂任务理解与稳定输出。",
    family: "OpenAI",
    tags: ["chat", "quality", "stable"],
  },
  "gpt-5.4-pro": {
    label: "GPT 5.4 Pro",
    summary: "适合高端推理、企业级复杂任务与高质量交付。",
    family: "OpenAI",
    tags: ["chat", "premium", "reasoning"],
  },
  "gpt-5.4-mini": {
    label: "GPT 5.4 Mini",
    summary: "适合高性价比日常对话、办公与自动化任务。",
    family: "OpenAI",
    tags: ["chat", "balanced", "popular"],
  },
  "gpt-5.4-nano": {
    label: "GPT 5.4 Nano",
    summary: "适合低成本、高并发的轻量级对话与测试场景。",
    family: "OpenAI",
    tags: ["chat", "fast", "economical"],
  },
  "vgo-cs": {
    label: "VGO智能客服",
    summary: "VGO AI平台专属智能客服，7x24小时在线，解答平台使用、账户管理、充值续费等问题，完全免费。",
    family: "VGO",
    tags: ["chat", "customer-service", "free", "智能客服"],
    hidden: true,
  },
  "gpt-5.3-codex": {
    label: "GPT 5.3 Codex",
    summary: "适合代码生成、开发辅助与工程类任务。",
    family: "OpenAI",
    tags: ["code", "developer", "quality"],
  },
  "gpt-5.3-codex-spark": {
    label: "GPT 5.3 Codex Spark",
    summary: "适合高响应速度的开发协作与代码类任务。",
    family: "OpenAI",
    tags: ["code", "developer", "fast"],
  },
  "gpt-5.2": {
    label: "GPT 5.2",
    summary: "适合稳定通用文本生成、分析与问答任务。",
    family: "OpenAI",
    tags: ["chat", "stable"],
  },
  "gpt-5.2-codex": {
    label: "GPT 5.2 Codex",
    summary: "适合开发场景下的代码生成与问题排查。",
    family: "OpenAI",
    tags: ["code", "developer"],
  },
  "gpt-5.1": {
    label: "GPT 5.1",
    summary: "适合稳定的通用问答、内容处理与办公任务。",
    family: "OpenAI",
    tags: ["chat", "stable"],
  },
  "gpt-5.1-codex": {
    label: "GPT 5.1 Codex",
    summary: "适合中高强度开发协作与代码生成任务。",
    family: "OpenAI",
    tags: ["code", "developer"],
  },
  "gpt-5.1-codex-max": {
    label: "GPT 5.1 Codex Max",
    summary: "适合更复杂的开发任务、重构与工程分析。",
    family: "OpenAI",
    tags: ["code", "developer", "premium"],
  },
  "gpt-5.1-codex-mini": {
    label: "GPT 5.1 Codex Mini",
    summary: "适合轻量级代码补全与开发者日常场景。",
    family: "OpenAI",
    tags: ["code", "developer", "fast"],
  },
  "gpt-5": {
    label: "GPT 5",
    summary: "适合通用高质量对话与任务执行。",
    family: "OpenAI",
    tags: ["chat", "quality"],
  },
  "gpt-5-codex": {
    label: "GPT 5 Codex",
    summary: "适合代码编写、排障与开发者工作流。",
    family: "OpenAI",
    tags: ["code", "developer"],
  },
  "gpt-5-nano": {
    label: "GPT 5 Nano",
    summary: "适合极低成本的引流问答与简单自动化。",
    family: "OpenAI",
    tags: ["chat", "economical", "fast"],
  },
  "gemini-3-flash": {
    label: "Gemini 3 Flash",
    summary: "适合高并发、快速响应与多模态轻量任务。",
    family: "Google",
    tags: ["chat", "fast", "multimodal"],
  },
  "glm-5": {
    label: "GLM 5",
    summary: "适合中文通用问答、办公与稳定对话场景。",
    family: "Zhipu",
    tags: ["chat", "cn", "balanced"],
  },
  "kimi-k2.5": {
    label: "Kimi K2.5",
    summary: "适合中文长文本、办公与信息整理场景。",
    family: "Moonshot",
    tags: ["chat", "cn", "writing"],
  },
  "big-pickle": {
    label: "Big Pickle",
    summary: "适合作为低门槛体验模型与轻量问答入口。",
    family: "Custom",
    tags: ["chat", "free", "entry"],
  },
  "mimo-v2-pro-free": {
    label: "MiMo V2 Pro Free",
    summary: "适合作为免费体验模型与基础对话任务。",
    family: "Custom",
    tags: ["chat", "free", "entry"],
  },
  "mimo-v2-omni-free": {
    label: "MiMo V2 Omni Free",
    summary: "适合作为免费体验模型与轻量多模态场景。",
    family: "Custom",
    tags: ["chat", "free", "multimodal"],
  },
  "qwen3.6-plus-free": {
    label: "Qwen3.6 Plus Free",
    summary: "适合作为免费中文体验模型与基础办公场景。",
    family: "Qwen",
    tags: ["chat", "free", "cn"],
  },
  "nemotron-3-super-free": {
    label: "Nemotron 3 Super Free",
    summary: "适合作为免费体验模型与快速问答入口。",
    family: "NVIDIA",
    tags: ["chat", "free", "fast"],
  },
};

export const FALLBACK_INPUT_PRICE_PER_MILLION = 0.5;
export const FALLBACK_OUTPUT_PRICE_PER_MILLION = 1.5;

export function getModelPreset(modelId: string): ModelPreset {
  return (
    MODEL_PRESETS[modelId] || {
      label: modelId,
      summary: "适合通过统一 API 网关接入的通用模型。",
      family: "Custom",
      tags: ["chat"],
    }
  );
}
