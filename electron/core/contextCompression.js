const MAX_CONTEXT_TOKENS = 32000;
const COMPRESSION_TRIGGER_RATIO = 0.9;
const KEEP_RECENT_MESSAGES = 12;
const MAX_SUMMARY_CHARS = 3600;
const MODEL_CONTEXT_DEFAULTS = {
  "claude-haiku-4-5": 200000,
  "claude-sonnet-4": 200000,
  "claude-opus-4": 200000,
  "gpt-4o": 128000,
  "gpt-4.1": 128000,
  "gpt-4.1-mini": 128000,
  "kimi-k2.5": 128000,
  "minimax-m2.5": 128000,
  "vgo-coder-pro": 32000,
  "vgo-coder-fast": 32000,
  "vgo-architect-max": 64000
};

function normalizeText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

function estimateTokens(text = "") {
  return Math.ceil(normalizeText(text).length / 4);
}

function estimateSessionTokens(session) {
  const summaryTokens = estimateTokens(session?.contextSummary || "");
  const historyTokens = (session?.history || []).reduce((total, item) => {
    return total + estimateTokens(item.text || "");
  }, 0);
  return summaryTokens + historyTokens + 600;
}

function normalizeModelId(modelId = "") {
  return String(modelId || "").trim().toLowerCase();
}

function readCatalogContextWindow(settings, modelId) {
  const normalizedId = normalizeModelId(modelId);
  const catalog = Array.isArray(settings?.vgoAI?.modelCatalog) ? settings.vgoAI.modelCatalog : [];
  const match = catalog.find((item) => normalizeModelId(item.id) === normalizedId);
  if (!match) {
    return 0;
  }

  return Number(
    match.contextWindow ||
      match.contextTokens ||
      match.maxContextTokens ||
      match.max_input_tokens ||
      match.maxTokens ||
      0
  );
}

function resolveModelContextWindow(settings, modelId) {
  const normalizedId = normalizeModelId(modelId);
  const catalogValue = readCatalogContextWindow(settings, normalizedId);
  if (catalogValue > 0) {
    return catalogValue;
  }

  return MODEL_CONTEXT_DEFAULTS[normalizedId] || MAX_CONTEXT_TOKENS;
}

function resolveCompressionThresholdRatio(settings) {
  const configured = Number(settings?.agent?.contextCompressionThreshold);
  if (Number.isFinite(configured)) {
    return Math.min(0.98, Math.max(0.5, configured));
  }
  return COMPRESSION_TRIGGER_RATIO;
}

function truncate(text, maxChars = 180) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
}

function mergeSummary(existingSummary, entries) {
  const lines = [];

  if (existingSummary) {
    lines.push("既有摘要：");
    lines.push(existingSummary.trim());
    lines.push("");
  }

  lines.push("本轮压缩追加摘要：");
  for (const entry of entries) {
    const prefix =
      entry.role === "user"
        ? "用户"
        : entry.role === "assistant"
          ? "助手"
          : "系统";
    lines.push(`- ${prefix}: ${truncate(entry.text, 220)}`);
  }

  const combined = lines.join("\n").trim();
  if (combined.length <= MAX_SUMMARY_CHARS) {
    return combined;
  }
  return combined.slice(combined.length - MAX_SUMMARY_CHARS);
}

function compressSessionContext(session, options = {}) {
  const contextWindow = Number(options.contextWindow) || MAX_CONTEXT_TOKENS;
  const thresholdRatio =
    Number.isFinite(Number(options.thresholdRatio)) && Number(options.thresholdRatio) > 0
      ? Number(options.thresholdRatio)
      : COMPRESSION_TRIGGER_RATIO;
  const estimatedBefore = estimateSessionTokens(session);
  const thresholdTokens = Math.floor(contextWindow * thresholdRatio);

  if (estimatedBefore < thresholdTokens || (session.history || []).length <= KEEP_RECENT_MESSAGES) {
    return {
      compressed: false,
      estimatedBefore,
      estimatedAfter: estimatedBefore,
      thresholdTokens,
      contextWindow,
      thresholdRatio,
      usagePercent: thresholdTokens > 0 ? Math.min(100, Math.round((estimatedBefore / thresholdTokens) * 100)) : 0,
      remainingTokens: Math.max(0, thresholdTokens - estimatedBefore)
    };
  }

  const keepCount = Math.min(KEEP_RECENT_MESSAGES, session.history.length);
  const compressibleEntries = session.history.slice(0, session.history.length - keepCount);
  const keptHistory = session.history.slice(-keepCount);
  const contextSummary = mergeSummary(session.contextSummary || "", compressibleEntries);
  const estimatedAfter =
    estimateTokens(contextSummary) +
    keptHistory.reduce((total, item) => total + estimateTokens(item.text || ""), 0) +
    600;

  return {
    compressed: true,
    history: keptHistory,
    contextSummary,
    compressionCount: (session.compressionCount || 0) + 1,
    lastCompressionAt: new Date().toISOString(),
    estimatedBefore,
    estimatedAfter,
    thresholdTokens,
    contextWindow,
    thresholdRatio,
    usagePercent: thresholdTokens > 0 ? Math.min(100, Math.round((estimatedAfter / thresholdTokens) * 100)) : 0,
    remainingTokens: Math.max(0, thresholdTokens - estimatedAfter)
  };
}

module.exports = {
  COMPRESSION_TRIGGER_RATIO,
  MAX_CONTEXT_TOKENS,
  compressSessionContext,
  estimateSessionTokens,
  resolveCompressionThresholdRatio,
  resolveModelContextWindow
};
