const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { executeToolCall } = require("./toolRuntime");
const protocol = require("./agentProtocol");
const modelAdapters = require("./modelAdapterRegistry");
const familyTools = require("./modelFamilyToolAdapters");
const skillRegistry = require("./skillRegistry");

const DEFAULT_MAX_AGENT_STEPS = 120;
const MIN_AGENT_STEPS = 20;
const MAX_AGENT_STEPS = 300;
const UPSTREAM_RETRYABLE_PATTERN = /Failed to connect to upstream channel/i;
const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 90000;
const DEFAULT_REMOTE_NETWORK_RETRIES = 3;
const DEFAULT_VGO_PROFILE_ID = "default";
const REMOTE_MAX_HISTORY_MESSAGES = 24;
const REMOTE_MAX_MESSAGE_CHARS = 5000;
const REMOTE_MAX_TOTAL_CHARS = 60000;
const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "vgo-remote.log");

function logRuntime(event, payload = {}) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(
      LOG_FILE,
      `${JSON.stringify({ ts: new Date().toISOString(), event, ...payload })}\n`,
      "utf8"
    );
  } catch {}
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { rawText: text };
  }
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function isBigModelHost(requestUrl = "") {
  const raw = String(requestUrl || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return /(^|\.)open\.bigmodel\.cn$/i.test(parsed.hostname);
  } catch {
    return /open\.bigmodel\.cn/i.test(raw);
  }
}

function looksLikeJwtToken(value = "") {
  return /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(String(value || "").trim());
}

function looksLikeBigModelApiKey(value = "") {
  const key = String(value || "").trim();
  return key.includes(".") && key.split(".").length === 2;
}

function buildBigModelJwtFromApiKey(apiKey = "") {
  const [apiKeyId, apiKeySecret] = String(apiKey || "").trim().split(".");
  if (!apiKeyId || !apiKeySecret) {
    return String(apiKey || "").trim();
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "HS256", sign_type: "SIGN" }));
  const payload = toBase64Url(
    JSON.stringify({
      api_key: apiKeyId,
      exp: nowSeconds + 300,
      timestamp: Date.now()
    })
  );
  const data = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", apiKeySecret)
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `${data}.${signature}`;
}

function resolveAuthorizationHeaderValue(remote = {}, requestUrl = "") {
  const rawApiKey = String(remote?.apiKey || "").trim();
  if (!rawApiKey) {
    return "";
  }

  if (!isBigModelHost(requestUrl)) {
    return `Bearer ${rawApiKey}`;
  }

  if (looksLikeBigModelApiKey(rawApiKey)) {
    return `Bearer ${buildBigModelJwtFromApiKey(rawApiKey)}`;
  }

  if (looksLikeJwtToken(rawApiKey)) {
    return `Bearer ${rawApiKey}`;
  }

  return `Bearer ${rawApiKey}`;
}

function isQuotaLikeFailure(status, errorText = "") {
  const text = String(errorText || "").toLowerCase();
  return (
    Number(status) === 429 &&
    (
      text.includes("余额不足") ||
      text.includes("无可用资源包") ||
      text.includes("quota") ||
      text.includes("insufficient") ||
      text.includes("balance")
    )
  );
}

function buildBigModelFallbackModels(primaryModel = "") {
  const preferred = String(primaryModel || "").trim();
  return ["glm-4.7-flash", "glm-4.5-air", "glm-4-flash-250414"].filter(
    (item) => item && item !== preferred
  );
}

function normalizeRemoteModelId(modelId = "") {
  const raw = String(modelId || "").trim();
  if (!raw) return raw;
  if (/^glm[-_.]/i.test(raw)) {
    return raw.replace(/_/g, "-").toLowerCase();
  }
  return raw;
}

function getMaxAgentSteps(settings) {
  const configured =
    Number(settings?.agent?.maxToolSteps) || Number(settings?.remote?.maxToolSteps) || DEFAULT_MAX_AGENT_STEPS;
  return Math.max(MIN_AGENT_STEPS, Math.min(MAX_AGENT_STEPS, Math.floor(configured)));
}

function safeParseJson(value) {
  if (typeof value !== "string") {
    return value && typeof value === "object" ? value : null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeToolCalls(calls = []) {
  return calls
    .filter((call) => call && typeof call === "object" && call.name)
    .map((call) => ({
      name: String(call.name),
      arguments:
        call.arguments && typeof call.arguments === "object"
          ? call.arguments
          : safeParseJson(call.arguments) || {}
    }));
}

function extractTaggedToolCallPayloads(text) {
  if (typeof text !== "string" || !text.includes("<vgo_tool_call>")) {
    return [];
  }

  const payloads = [];
  const taggedPattern = /<vgo_tool_call>\s*([\s\S]*?)\s*<\/vgo_tool_call>/gi;
  let match = taggedPattern.exec(text);

  while (match) {
    const payload = String(match[1] || "").trim();
    if (payload) {
      payloads.push(payload);
    }
    match = taggedPattern.exec(text);
  }

  return payloads;
}

function extractUsage(payload) {
  const data = payload?.data || payload || {};
  const usage = data?.usage || payload?.usage || {};
  const inputTokens = toNumber(
    usage.inputTokens ||
      usage.promptTokens ||
      usage.prompt_tokens ||
      usage.input_tokens ||
      usage.prompt
  );
  const outputTokens = toNumber(
    usage.outputTokens ||
      usage.completionTokens ||
      usage.completion_tokens ||
      usage.output_tokens ||
      usage.completion
  );
  const totalTokens = toNumber(
    usage.totalTokens || usage.total_tokens || usage.total || inputTokens + outputTokens
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens
  };
}

function extractContextWindow(payload) {
  const data = payload?.data || payload || {};
  return toNumber(
    data.contextWindow ||
      data.contextTokens ||
      data.maxContextTokens ||
      data.max_input_tokens ||
      payload?.contextWindow ||
      payload?.contextTokens
  );
}

function isRealVgoLogin(settings) {
  return Boolean(settings?.vgoAI?.loggedIn && settings?.vgoAI?.accessToken);
}

function shouldUseRealVgoChannel(settings) {
  if (!isRealVgoLogin(settings)) {
    return false;
  }

  const activeProfileId = String(settings?.activeRemoteProfileId || "").trim();
  const provider = String(settings?.remote?.provider || "").toLowerCase();
  const isDefaultProfile = !activeProfileId || activeProfileId === DEFAULT_VGO_PROFILE_ID;
  const isOfficialProvider =
    provider.includes("vgo remote") || provider.includes("vgo ai") || provider.includes("official");

  return isDefaultProfile || isOfficialProvider;
}

function getCatalogModels(settings) {
  return Array.isArray(settings?.vgoAI?.modelCatalog) ? settings.vgoAI.modelCatalog : [];
}

function pickPreferredModel(settings) {
  const preferred = settings?.vgoAI?.preferredModel || settings?.remote?.model || "vgo-coder-pro";
  const catalog = getCatalogModels(settings);
  if (!catalog.length) {
    return preferred;
  }
  if (catalog.some((item) => item.id === preferred)) {
    return preferred;
  }
  return catalog[0]?.id || preferred;
}

function buildSafeSystemPrompt(settings, sessionMeta, activeSkills = []) {
  const appendix = skillRegistry.buildSkillSystemAppendix(activeSkills);
  try {
    const prompt = [modelAdapters.buildDesktopSystemPrompt(settings, sessionMeta), appendix]
      .filter(Boolean)
      .join("\n\n");
    logRuntime("system_prompt:build_ok", {
      model: settings?.vgoAI?.preferredModel || settings?.remote?.model || "",
      skills: activeSkills.map((skill) => skill.id)
    });
    return prompt;
  } catch (error) {
    logRuntime("system_prompt:build_fallback", {
      model: settings?.vgoAI?.preferredModel || settings?.remote?.model || "",
      error: error.message
    });
    return [
      "?? VGO CODE ??????? Agent?",
      "????????????????????????????",
      "???????????????????????????????",
      "??????????????????????????????",
      appendix,
      `?????????????${error.message}`
    ]
      .filter(Boolean)
      .join("\n\n");
  }
}

function extractAssistantRawText(payload) {
  const data = payload?.data || payload;
  return String(
    data?.message?.content ||
      data?.message?.displayContent ||
      data?.output ||
      data?.text ||
      data?.message ||
      payload?.rawText ||
      ""
  );
}

function extractToolCalls(rawText = "") {
  const fallbackCalls = normalizeToolCalls(protocol.parseToolCalls(rawText));
  if (fallbackCalls.length) {
    logRuntime("tool_calls:fallback_from_text", {
      count: fallbackCalls.length,
      preview: String(rawText || "").slice(0, 200)
    });
    return fallbackCalls;
  }

  const taggedPayloads = extractTaggedToolCallPayloads(rawText);
  const taggedCalls = [];
  for (const payload of taggedPayloads) {
    const parsed = safeParseJson(payload);
    const parsedCalls = normalizeToolCalls(
      Array.isArray(parsed?.calls) ? parsed.calls : parsed?.name ? [parsed] : []
    );
    if (parsedCalls.length) {
      taggedCalls.push(...parsedCalls);
    }
  }

  if (taggedCalls.length) {
    logRuntime("tool_calls:recovered_tagged_calls", {
      count: taggedCalls.length,
      preview: String(rawText || "").slice(0, 200)
    });
    return taggedCalls;
  }

  return [];
}

function clampText(text = "", maxChars = 0) {
  const source = String(text || "");
  if (!maxChars || source.length <= maxChars) {
    return source;
  }
  return `${source.slice(0, Math.max(0, maxChars - 64))}\n...[trimmed ${source.length - maxChars} chars]`;
}

function compactConversationMessages(messages = [], options = {}) {
  const maxMessages = Number(options.maxMessages) || REMOTE_MAX_HISTORY_MESSAGES;
  const maxMessageChars = Number(options.maxMessageChars) || REMOTE_MAX_MESSAGE_CHARS;
  const maxTotalChars = Number(options.maxTotalChars) || REMOTE_MAX_TOTAL_CHARS;
  const preserveSystem = options.preserveSystem !== false;

  if (!Array.isArray(messages) || !messages.length) {
    return [];
  }

  const normalized = messages
    .map((item) => ({
      role: item?.role || "user",
      content: clampText(item?.content || "", maxMessageChars)
    }))
    .filter((item) => String(item.content || "").trim());

  if (!normalized.length) {
    return [];
  }

  let systemMessage = null;
  let rest = normalized;
  if (preserveSystem && normalized[0]?.role === "system") {
    systemMessage = normalized[0];
    rest = normalized.slice(1);
  }

  if (rest.length > maxMessages) {
    rest = rest.slice(-maxMessages);
  }

  let compacted = systemMessage ? [systemMessage, ...rest] : [...rest];
  let totalChars = compacted.reduce((sum, item) => sum + String(item.content || "").length, 0);

  while (compacted.length > (systemMessage ? 2 : 1) && totalChars > maxTotalChars) {
    const dropIndex = systemMessage ? 1 : 0;
    compacted.splice(dropIndex, 1);
    totalChars = compacted.reduce((sum, item) => sum + String(item.content || "").length, 0);
  }

  if (totalChars > maxTotalChars) {
    const targetIndex = systemMessage ? compacted.length - 1 : Math.max(0, compacted.length - 1);
    if (targetIndex >= 0) {
      const overflow = totalChars - maxTotalChars;
      const current = String(compacted[targetIndex].content || "");
      compacted[targetIndex].content = clampText(current, Math.max(1200, current.length - overflow - 64));
    }
  }

  return compacted;
}

function compactActiveHistoryInPlace(activeHistory = [], options = {}) {
  const compacted = compactConversationMessages(activeHistory, options);
  activeHistory.splice(0, activeHistory.length, ...compacted);
}

function buildMessageHistory(history, systemPrompt, currentPrompt = "", attachments = []) {
  const trimmedHistory = (history || [])
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .map((item) => ({
      role: item.role,
      content: clampText(String(item.text || "").trim(), REMOTE_MAX_MESSAGE_CHARS)
    }))
    .filter((item) => item.content)
    .slice(-REMOTE_MAX_HISTORY_MESSAGES);

  const attachmentSummary = attachments.length
    ? `\n\n[Attachments]\n${attachments.map((item, index) => `${index + 1}. ${item.name} | ${item.path}`).join("\n")}`
    : "";

  const messages = [
    {
      role: "system",
      content: clampText(systemPrompt, REMOTE_MAX_MESSAGE_CHARS)
    },
    ...trimmedHistory
  ];

  const normalizedPrompt = String(currentPrompt || "").trim();
  const hasUserMessage = messages.some((item) => item.role === "user" && String(item.content || "").trim());
  if (!hasUserMessage && normalizedPrompt) {
    messages.push({
      role: "user",
      content: clampText(normalizedPrompt + attachmentSummary, REMOTE_MAX_MESSAGE_CHARS)
    });
  }

  return compactConversationMessages(messages);
}

function buildSkillPreflightNudge(skills = []) {
  const required = [];
  for (const skill of skills) {
    for (const file of skill.requiredInspectionPaths || []) {
      if (!required.includes(file)) {
        required.push(file);
      }
    }
  }

  if (!required.length) {
    return "";
  }

  return [
    "Before giving conclusions, inspect these project files first if they exist:",
    ...required.map((file, index) => `${index + 1}. ${file}`),
    "",
    "If the task is a diagnosis or architecture review, do not answer from assumptions. Read the files first, then conclude."
  ].join("\n");
}

async function sendRealVgoRequest({ token, model, activeHistory, signal }) {
  logRuntime("request:start", {
    model,
    conversationId: "",
    messageCount: Array.isArray(activeHistory) ? activeHistory.length : 0
  });

  const timeoutController = new AbortController();
  const abortRelay = () => timeoutController.abort(new Error("aborted_by_user"));
  if (signal) {
    signal.addEventListener("abort", abortRelay, { once: true });
  }
  const timer = setTimeout(
    () => timeoutController.abort(new Error("remote_request_timeout")),
    DEFAULT_REMOTE_REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch("https://vgoai.cn/api/v1/chat/send", {
      method: "POST",
      signal: timeoutController.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        model,
        messages: activeHistory
      })
    });

    const payload = await parseJsonResponse(response);
    logRuntime("request:end", {
      model,
      ok: response.ok,
      status: response.status,
      message: String(payload?.message || payload?.error || payload?.rawText || "").slice(0, 500)
    });
    return { response, payload };
  } catch (error) {
    logRuntime("request:error", {
      model,
      message: String(error?.message || error || "").slice(0, 500)
    });
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener("abort", abortRelay);
    }
  }
}

function isNetworkFetchFailure(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("enotfound") ||
    message.includes("eai_again")
  );
}

function resolveLocalProviderEndpoint(baseUrl = "", provider = "") {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  const lower = normalized.toLowerCase();
  const providerLower = String(provider || "").toLowerCase();

  if (providerLower.includes("ollama") || /localhost:11434|127\.0\.0\.1:11434/.test(lower)) {
    return {
      mode: "ollama",
      requestUrl: /\/api\/chat$/.test(lower) ? normalized : `${normalized}/api/chat`
    };
  }

  if (/\/chat\/completions$/.test(lower)) {
    return {
      mode: "openai",
      requestUrl: normalized
    };
  }

  if (/\/api\/paas\/v4$/.test(lower)) {
    return {
      mode: "openai",
      requestUrl: `${normalized}/chat/completions`
    };
  }

  if (/\/v1$/.test(lower) || /\/openai\/v1$/.test(lower)) {
    return {
      mode: "openai",
      requestUrl: `${normalized}/chat/completions`
    };
  }

  return {
    mode: "legacy",
    requestUrl: `${normalized}/chat`
  };
}

function normalizeHistoryMessages(history = []) {
  if (!Array.isArray(history) || !history.length) {
    return [];
  }

  return history
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      role: String(item.role || "").trim().toLowerCase(),
      content: typeof item.content === "string" ? item.content : String(item.content || "")
    }))
    .filter((item) => ["system", "user", "assistant"].includes(item.role) && item.content.trim());
}

function extractOpenAiMessageText(payload = {}) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          return part.text || part.content || "";
        }
        return "";
      })
      .join("")
      .trim();
  }

  return String(payload?.output_text || payload?.text || "");
}

function isRetryableUpstreamFailure(response, payload) {
  if (!response || response.ok) {
    return false;
  }
  const messageText = String(payload?.message || payload?.error || payload?.rawText || "");
  return UPSTREAM_RETRYABLE_PATTERN.test(messageText);
}

function formatRemoteServiceError(settings, response, payload) {
  const status = Number(response?.status || 0);
  const rawMessage = String(payload?.message || payload?.error || payload?.rawText || "").trim();
  const balance = Number(settings?.vgoAI?.profile?.balance || 0);
  const isAdmin = Boolean(settings?.vgoAI?.profile?.isAdmin);

  if (status === 400 && /HTTP\s*402/i.test(rawMessage)) {
    if (isAdmin) {
      return "当前云端模型调用失败：服务端返回 HTTP 402。当前账号已是管理员，这更像是该模型通道暂不可用、账号权限未正确下发，或云端路由配置异常，请检查服务端模型通道。";
    }
    if (balance <= 0) {
      return "当前云端模型调用失败：账号可用余额/额度为 0，已被服务端拒绝（HTTP 402）。请先充值或切换到其他可用模型。";
    }
    return "当前云端模型调用失败：服务端返回 HTTP 402，当前账号或模型通道不可用。请稍后重试，或切换到其他云端模型。";
  }

  return rawMessage || `HTTP ${status || 500}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickFallbackModelForUpstream(settings, currentModel) {
  const catalog = getCatalogModels(settings).map((item) => item.id).filter(Boolean);
  if (!catalog.length) {
    return "";
  }

  const configuredFallback = String(settings?.agent?.fallbackModel || "").trim();
  if (configuredFallback && configuredFallback !== currentModel && catalog.includes(configuredFallback)) {
    return configuredFallback;
  }

  const currentFamily = modelAdapters.getModelFamily(currentModel);
  const sameFamily = catalog.find(
    (modelId) => modelId !== currentModel && modelAdapters.getModelFamily(modelId) === currentFamily
  );
  if (sameFamily) {
    return sameFamily;
  }

  return catalog.find((modelId) => modelId !== currentModel) || "";
}

function emitEvent(onEvent, rawEvents, event) {
  rawEvents.push(event);
  if (typeof onEvent === "function") {
    onEvent(event);
  }
}

function emitVerificationEvent(onEvent, rawEvents, status, detail, extras = {}) {
  emitEvent(onEvent, rawEvents, {
    type: "verification",
    status,
    detail,
    ...extras
  });
}

function extractToolResultSummaries(rawEvents) {
  return rawEvents
    .filter((event) => event.type === "tool_result")
    .map((event) => ({
      name: event.tool,
      ok: event.ok,
      summary: event.summary
    }));
}

function extractRequestedFilePaths(prompt = "", workspace = "") {
  const source = String(prompt || "");
  const absolutePathMatches =
    source.match(/[A-Za-z]:\\[A-Za-z0-9._-]+(?:\\[A-Za-z0-9._-]+)*/g) || [];
  const relativePathMatches =
    source.match(/(?:src|electron|ui)[\\/][A-Za-z0-9._/\\-]+|package\.json/gi) || [];
  const matches = [...absolutePathMatches, ...relativePathMatches];
  const paths = new Set();
  const normalizedWorkspace = workspace ? path.resolve(workspace).toLowerCase() : "";

  for (const rawMatch of matches) {
    const cleaned = String(rawMatch || "")
      .trim()
      .replace(/[，。、；：,.;:？?！!）)\]】]+$/, "");
    if (!cleaned) {
      continue;
    }

    const resolved = path.isAbsolute(cleaned)
      ? path.resolve(cleaned)
      : workspace
        ? path.resolve(workspace, cleaned.replace(/\//g, path.sep))
        : cleaned.replace(/\//g, path.sep);
    const normalizedResolved = resolved.toLowerCase();
    const basename = path.basename(normalizedResolved);
    const likelyFile =
      basename === "package.json" ||
      /\.(tsx|ts|js|jsx|json|css|md|html)$/i.test(normalizedResolved);

    if (normalizedResolved === normalizedWorkspace || !likelyFile) {
      continue;
    }

    paths.add(normalizedResolved);
  }

  return [...paths];
}

function collectCompletedReadPaths(rawEvents = []) {
  const completed = new Set();

  for (const event of rawEvents) {
    if (event?.type !== "tool_result" || event.tool !== "read_file" || !event.ok) {
      continue;
    }

    const summary = String(event.summary || "");
    const match = summary.match(/^Read\s+(.+?)\s+lines\s+\d+-\d+\./i);
    if (match?.[1]) {
      completed.add(path.resolve(match[1]).toLowerCase());
    }
  }

  return completed;
}

function getUnfinishedRequiredReadPaths(prompt = "", rawEvents = [], workspace = "") {
  const requestedPaths = extractRequestedFilePaths(prompt, workspace);
  if (!requestedPaths.length) {
    return [];
  }

  const completedReadPaths = collectCompletedReadPaths(rawEvents);
  return requestedPaths.filter((requestedPath) => !completedReadPaths.has(requestedPath));
}

function hasUnfinishedRequiredReads(prompt = "", rawEvents = [], workspace = "") {
  return getUnfinishedRequiredReadPaths(prompt, rawEvents, workspace).length > 0;
}

function promptAllowsAutonomousContinuation(prompt = "") {
  const normalized = String(prompt || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const autonomyPatterns = [
    /继续/,
    /自动/,
    /自行/,
    /完整落地/,
    /完整方案/,
    /直到完成/,
    /修复完/,
    /排查并修复/,
    /持续执行/,
    /continue/,
    /keep going/,
    /autonom/i,
    /end[- ]to[- ]end/
  ];
  return autonomyPatterns.some((pattern) => pattern.test(normalized));
}

function shouldContinueAutonomously(text = "", rawEvents = [], prompt = "", workspace = "") {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return false;
  }

  const hasToolResults = rawEvents.some((event) => event && event.type === "tool_result");
  const unfinishedRequiredReads = hasUnfinishedRequiredReads(prompt, rawEvents, workspace);
  const continuationPatterns = [
    /下一步/i,
    /下一步行动/i,
    /继续/i,
    /接下来/i,
    /然后/i,
    /现在我将/i,
    /先读取/i,
    /先检查/i,
    /先列出/i,
    /我将读取/i,
    /我将继续/i,
    /需要先/i,
    /需要继续/i
  ];
  const finalPatterns = [
    /最终结论/i,
    /简短结论/i,
    /总结/i,
    /分析如下/i,
    /优化建议/i,
    /检查结果汇总/i,
    /所有要求的文件均已检查完毕/i,
    /所有请求的文件.*已检查完/i
  ];

  if (!hasToolResults && continuationPatterns.some((pattern) => pattern.test(normalized))) {
    return unfinishedRequiredReads || promptAllowsAutonomousContinuation(prompt);
  }

  if (finalPatterns.some((pattern) => pattern.test(normalized))) {
    if (unfinishedRequiredReads) {
      return true;
    }
    return false;
  }

  if (protocol.looksLikeContinuationIntent(normalized)) {
    return unfinishedRequiredReads || promptAllowsAutonomousContinuation(prompt);
  }

  if (unfinishedRequiredReads) {
    return true;
  }

  if (!promptAllowsAutonomousContinuation(prompt)) {
    return false;
  }

  return false;
}

function hasSuccessfulMutatingTool(rawEvents = []) {
  return rawEvents.some(
    (event) =>
      event.type === "tool_result" &&
      ["write_file", "copy_file", "move_file", "rename_file", "make_dir", "delete_file", "delete_dir"].includes(event.tool) &&
      event.ok
  );
}

function hasVerificationAfterLastMutation(rawEvents = []) {
  let lastMutationIndex = -1;
  for (let index = 0; index < rawEvents.length; index += 1) {
    const event = rawEvents[index];
    if (
      event.type === "tool_result" &&
      ["write_file", "copy_file", "move_file", "rename_file", "make_dir", "delete_file", "delete_dir"].includes(event.tool) &&
      event.ok
    ) {
      lastMutationIndex = index;
    }
  }

  if (lastMutationIndex < 0) {
    return false;
  }

  return rawEvents.slice(lastMutationIndex + 1).some(
    (event) =>
      event.type === "tool_result" &&
      ["read_file", "list_dir", "search_code", "open_path"].includes(event.tool) &&
      event.ok
  );
}

function collectMutatedFilePaths(rawEvents = []) {
  const mutated = new Set();

  for (const event of rawEvents) {
    if (event?.type !== "tool_result" || event.tool !== "write_file" || !event.ok) {
      continue;
    }

    const summary = String(event.summary || "");
    const match = summary.match(/^Wrote\s+(.+?)\.$/i);
    if (match?.[1]) {
      mutated.add(path.resolve(match[1]).toLowerCase());
    }
  }

  return mutated;
}

function collectVerifiedReadPathsAfterLastMutation(rawEvents = []) {
  let lastMutationIndex = -1;
  for (let index = 0; index < rawEvents.length; index += 1) {
    const event = rawEvents[index];
    if (
      event?.type === "tool_result" &&
      ["write_file", "copy_file", "move_file", "rename_file", "make_dir", "delete_file", "delete_dir"].includes(event.tool) &&
      event.ok
    ) {
      lastMutationIndex = index;
    }
  }

  if (lastMutationIndex < 0) {
    return new Set();
  }

  const verified = new Set();
  for (const event of rawEvents.slice(lastMutationIndex + 1)) {
    if (event?.type !== "tool_result" || event.tool !== "read_file" || !event.ok) {
      continue;
    }

    const summary = String(event.summary || "");
    const match = summary.match(/^Read\s+(.+?)\s+lines\s+\d+-\d+\./i);
    if (match?.[1]) {
      verified.add(path.resolve(match[1]).toLowerCase());
    }
  }

  return verified;
}

function getUnverifiedMutatedPaths(rawEvents = []) {
  const mutated = collectMutatedFilePaths(rawEvents);
  if (!mutated.size) {
    return [];
  }

  const verified = collectVerifiedReadPathsAfterLastMutation(rawEvents);
  return [...mutated].filter((filePath) => !verified.has(filePath));
}

function hasPackageManifestMutation(rawEvents = []) {
  return rawEvents.some(
    (event) =>
      event.type === "tool_result" &&
      event.tool === "write_file" &&
      event.ok &&
      /package\.json/i.test(String(event.summary || ""))
  );
}

function hasDependencyVerification(rawEvents = []) {
  return rawEvents.some((event) => {
    if (event.type !== "tool_result" || !event.ok) {
      return false;
    }
    if (event.tool === "run_command" && /npm\s+(install|ci)|pnpm\s+install|yarn\s+install/i.test(String(event.summary || "") + " " + String(event.output || ""))) {
      return true;
    }
    if (event.tool === "read_file" && /package-lock\.json|pnpm-lock\.yaml|yarn\.lock/i.test(String(event.summary || ""))) {
      return true;
    }
    return false;
  });
}

const PROTECTED_RUNTIME_PATHS = [
  "electron/core/toolRuntime.js",
  "electron/core/vgoRemoteAdapter.js",
  "electron/main.js"
];

function normalizePromptPathText(text = "") {
  return String(text || "").replace(/\\/g, "/").toLowerCase();
}

function isMutatingToolName(name = "") {
  return [
    "write_file",
    "copy_file",
    "move_file",
    "rename_file",
    "make_dir",
    "delete_file",
    "delete_dir"
  ].includes(String(name || ""));
}

function getProtectedPathViolation(call = {}, prompt = "", workspace = "") {
  if (!isMutatingToolName(call.name)) {
    return "";
  }

  const args = call.arguments && typeof call.arguments === "object" ? call.arguments : {};
  const candidatePaths = [
    args.path,
    args.source,
    args.from,
    args.destination,
    args.to
  ]
    .filter(Boolean)
    .map((value) => normalizePromptPathText(value));

  if (!candidatePaths.length) {
    return "";
  }

  const normalizedPrompt = normalizePromptPathText(prompt);
  const normalizedWorkspace = normalizePromptPathText(workspace);

  for (const protectedPath of PROTECTED_RUNTIME_PATHS) {
    const normalizedProtected = normalizePromptPathText(protectedPath);
    const promptExplicitlyTargetsProtected =
      normalizedPrompt.includes(normalizedProtected) ||
      normalizedPrompt.includes(normalizedProtected.split("/").pop());

    if (promptExplicitlyTargetsProtected) {
      continue;
    }

    const hit = candidatePaths.some((candidate) => {
      if (candidate.endsWith(normalizedProtected)) {
        return true;
      }
      if (normalizedWorkspace && candidate === `${normalizedWorkspace}/${normalizedProtected}`) {
        return true;
      }
      return false;
    });

    if (hit) {
      return protectedPath;
    }
  }

  return "";
}

function getProtectedInspectionViolation(call = {}, prompt = "", workspace = "") {
  const allowedNames = ["read_file", "search_code", "list_dir"];
  if (!allowedNames.includes(String(call.name || ""))) {
    return "";
  }

  const args = call.arguments && typeof call.arguments === "object" ? call.arguments : {};
  const candidatePaths = [args.path]
    .filter(Boolean)
    .map((value) => normalizePromptPathText(value));

  if (!candidatePaths.length) {
    return "";
  }

  const normalizedPrompt = normalizePromptPathText(prompt);
  const normalizedWorkspace = normalizePromptPathText(workspace);

  for (const protectedPath of PROTECTED_RUNTIME_PATHS) {
    const normalizedProtected = normalizePromptPathText(protectedPath);
    const promptExplicitlyTargetsProtected =
      normalizedPrompt.includes(normalizedProtected) ||
      normalizedPrompt.includes(normalizedProtected.split("/").pop());

    if (promptExplicitlyTargetsProtected) {
      continue;
    }

    const hit = candidatePaths.some((candidate) => {
      if (candidate.endsWith(normalizedProtected)) {
        return true;
      }
      if (normalizedWorkspace && candidate === `${normalizedWorkspace}/${normalizedProtected}`) {
        return true;
      }
      return false;
    });

    if (hit) {
      return protectedPath;
    }
  }

  return "";
}

function looksLikePlatformPersona(text = "") {
  const source = String(text || "");
  return /VGO\s*AI|工作区助手|账户信息|账单|充值|渠道|网站运营|平台功能限制|可以为您提供以下方面的帮助/.test(
    source
  );
}

async function runRealVgoPrompt({
  sessionId,
  settings,
  history,
  sessionMeta,
  workspace,
  requestToolPermission,
  onEvent,
  prompt,
  attachments = [],
  signal
}) {
  const token = settings.vgoAI.accessToken;
  const initialModel = pickPreferredModel(settings);
  const activeSkills = skillRegistry.detectRelevantSkills(prompt);
  const isRepairTask =
    protocol.promptRequiresRepair(prompt) || activeSkills.some((skill) => skill.id === "self-heal");
  const skillPreflightNudge = buildSkillPreflightNudge(activeSkills);
  const skillWorkflowNudge = skillRegistry.buildSkillWorkflowNudge(activeSkills);
  const systemPrompt = buildSafeSystemPrompt(settings, sessionMeta, activeSkills);
  const activeHistory = buildMessageHistory(history, systemPrompt, prompt, attachments);
  if (skillPreflightNudge) {
    activeHistory.push({
      role: "user",
      content: skillPreflightNudge
    });
  }
  if (skillWorkflowNudge) {
    activeHistory.push({
      role: "user",
      content: skillWorkflowNudge
    });
  }
  let usedModel = initialModel;
  let payload;
  let latestText = "";
  let usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
  let contextWindow = 0;
  const rawEvents = [];
  let writeNudgeSent = false;
  let writeArgumentRetrySent = false;
  let finalAnswerNudgeSent = false;
  let didCallWriteTool = false;
  let toolProtocolNudgeSent = false;
  let repairActionNudgeSent = false;
  let verificationNudgeSent = false;
  let dependencyVerificationNudgeSent = false;
  let upstreamRetryUsed = false;
  let upstreamFallbackModelUsed = false;
  let payloadTooLargeRetryCount = 0;
  let autoContinueNudgeCount = 0;
  let networkRetryUsed = 0;

  const requestWithRetry = async (targetModel) => {
    let attempt = 0;
    let lastError = null;
    while (attempt < DEFAULT_REMOTE_NETWORK_RETRIES) {
      attempt += 1;
      try {
        return await sendRealVgoRequest({
          token,
          model: targetModel,
          activeHistory,
          signal
        });
      } catch (error) {
        lastError = error;
        if (signal?.aborted || error?.name === "AbortError" || error?.message === "aborted_by_user") {
          throw error;
        }
        if (!isNetworkFetchFailure(error) || attempt >= DEFAULT_REMOTE_NETWORK_RETRIES) {
          throw error;
        }
        networkRetryUsed += 1;
        emitEvent(onEvent, rawEvents, {
          type: "task_status",
          status: "retrying",
          message: `网络波动，正在自动重试（${attempt}/${DEFAULT_REMOTE_NETWORK_RETRIES}）...`
        });
        await wait(500 * attempt);
      }
    }
    throw lastError || new Error("remote_request_failed");
  };

  const maxAgentSteps = getMaxAgentSteps(settings);
  for (let step = 0; step < maxAgentSteps; step += 1) {
    if (signal?.aborted) {
      return {
        ok: false,
        exitCode: 130,
        sessionId,
        text: "本轮任务已手动停止。",
        error: "aborted_by_user",
        rawEvents,
        remoteConversationId: "",
        remoteTitle: "",
        usedModel,
        actualChannel: "real-remote-agent",
        actualContextWindow: contextWindow,
        usageInputTokens: usage.inputTokens,
        usageOutputTokens: usage.outputTokens,
        usageTotalTokens: usage.totalTokens
      };
    }

    emitEvent(onEvent, rawEvents, {
      type: "task_status",
      status: step === 0 ? "thinking" : "continuing",
      message: step === 0 ? "正在请求远程模型..." : `正在继续第 ${step + 1} 轮推理...`
    });

    compactActiveHistoryInPlace(activeHistory, {
      maxMessages: REMOTE_MAX_HISTORY_MESSAGES,
      maxMessageChars: REMOTE_MAX_MESSAGE_CHARS,
      maxTotalChars: REMOTE_MAX_TOTAL_CHARS
    });

    let response;
    let nextPayload;
    try {
      ({ response, payload: nextPayload } = await requestWithRetry(usedModel));
    } catch (error) {
      if (rawEvents.some((event) => event?.type === "tool_result")) {
        return {
          ok: true,
          exitCode: 0,
          sessionId,
          text: [
            "远程网络中断，已基于本轮已执行结果先输出可用结论。",
            protocol.buildFallbackCompletionFromResults(prompt, extractToolResultSummaries(rawEvents)),
            "建议：网络恢复后可继续同一任务做补充验证。"
          ].join("\n\n"),
          error: "",
          rawEvents,
          remoteConversationId: "",
          remoteTitle: "",
          usedModel,
          actualChannel: "real-remote-agent-degraded",
          actualContextWindow: contextWindow,
          usageInputTokens: usage.inputTokens,
          usageOutputTokens: usage.outputTokens,
          usageTotalTokens: usage.totalTokens
        };
      }
      throw error;
    }
    payload = nextPayload;

    let messageText = formatRemoteServiceError(settings, response, payload);
    if (isRetryableUpstreamFailure(response, payload) && !upstreamRetryUsed) {
      upstreamRetryUsed = true;
      emitEvent(onEvent, rawEvents, {
        type: "task_status",
        status: "retrying",
        message: "上游通道连接失败，正在自动重试..."
      });
      await wait(1200);
      ({ response, payload } = await requestWithRetry(usedModel));
      messageText = formatRemoteServiceError(settings, response, payload);
    }

    if (isRetryableUpstreamFailure(response, payload) && !upstreamFallbackModelUsed) {
      const fallbackUpstreamModel = pickFallbackModelForUpstream(settings, usedModel);
      if (fallbackUpstreamModel) {
        upstreamFallbackModelUsed = true;
        emitEvent(onEvent, rawEvents, {
          type: "task_status",
          status: "fallback_model",
          message: `上游通道仍不可用，正在切换备用模型：${fallbackUpstreamModel}`
        });
        usedModel = fallbackUpstreamModel;
        ({ response, payload } = await requestWithRetry(usedModel));
        messageText = formatRemoteServiceError(settings, response, payload);
      }
    }

    const fallbackModel = getCatalogModels(settings).find((item) => item.id !== usedModel)?.id;
    if (!response.ok && fallbackModel && /No available channel for this model/i.test(messageText)) {
      usedModel = fallbackModel;
      ({ response, payload } = await requestWithRetry(usedModel));
      messageText = formatRemoteServiceError(settings, response, payload);
    }

    if (!response.ok && Number(response.status) === 413) {
      if (payloadTooLargeRetryCount < 2) {
        payloadTooLargeRetryCount += 1;
        emitEvent(onEvent, rawEvents, {
          type: "task_status",
          status: "retrying",
          message: "上下文过长，正在自动压缩并重试..."
        });
        compactActiveHistoryInPlace(activeHistory, {
          maxMessages: 12,
          maxMessageChars: 2200,
          maxTotalChars: 22000
        });
        activeHistory.push({
          role: "user",
          content:
            "Context limit reached. Continue with concise reasoning and minimal output. Use only essential tool results."
        });
        continue;
      }
    }

    const data = payload?.data || payload;
    usage = extractUsage(payload);
    contextWindow = extractContextWindow(payload);

    const rawText = extractAssistantRawText(payload);
    logRuntime("model:raw_response", {
      model: usedModel,
      rawTextPreview: String(rawText || "").slice(0, 500),
      hasToolCall: /<\w+[\s\S]*?>[\s\S]*?\{[\s\S]*?\}[\s\S]*?<\/\w+>|```[\s\S]*?```/.test(rawText || "")
    });
    latestText = modelAdapters.stripCustomerServiceBoilerplate(
      protocol.sanitizeAssistantText(rawText),
      prompt
    );
    const plan = protocol.parsePlanBlock(rawText);
    const toolCalls = extractToolCalls(rawText);
    const toolNudges = familyTools.getToolProtocolTemplates(usedModel);
    const hasPlatformPersona = looksLikePlatformPersona(rawText) || looksLikePlatformPersona(latestText);

    if (plan) {
      emitEvent(onEvent, rawEvents, {
        type: "plan",
        step: step + 1,
        summary: plan.summary,
        steps: plan.steps
      });
    }

    if (step === 0 && activeSkills.length) {
      emitEvent(onEvent, rawEvents, {
        type: "skill_selection",
        step: step + 1,
        skills: activeSkills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          category: skill.category
        }))
      });
    }

    emitEvent(onEvent, rawEvents, {
      type: "model_response",
      step: step + 1,
      model: usedModel,
      text: latestText,
      toolCalls
    });

    if (latestText) {
      emitEvent(onEvent, rawEvents, {
        type: "model_stream_delta",
        step: step + 1,
        model: usedModel,
        text: latestText,
        done: true
      });
    }

    if (!response.ok) {
      return {
        ok: false,
        exitCode: 1,
        sessionId,
        text: latestText || messageText || `HTTP ${response.status}`,
        error: messageText || `http_${response.status}`,
        rawEvents,
        remoteConversationId: "",
        remoteTitle: "",
        usedModel,
        actualChannel: "real-remote",
        actualContextWindow: contextWindow,
        usageInputTokens: usage.inputTokens,
        usageOutputTokens: usage.outputTokens,
        usageTotalTokens: usage.totalTokens
      };
    }

    if (!toolCalls.length) {
      const hadToolResults = rawEvents.some((event) => event.type === "tool_result");
      const hadMutatingToolResults = hasSuccessfulMutatingTool(rawEvents);
      const hadVerificationAfterMutation = hasVerificationAfterLastMutation(rawEvents);
      const unverifiedMutatedPaths = getUnverifiedMutatedPaths(rawEvents);
      const changedPackageManifest = hasPackageManifestMutation(rawEvents);
      const hadDependencyVerification = hasDependencyVerification(rawEvents);

      if (
        !hadToolResults &&
        protocol.promptRequiresTools(prompt) &&
        (protocol.looksLikeGenericAcknowledgement(latestText) || hasPlatformPersona) &&
        !toolProtocolNudgeSent
      ) {
        toolProtocolNudgeSent = true;
        activeHistory.push({ role: "assistant", content: rawText });
        activeHistory.push({ role: "user", content: toolNudges.genericAcknowledgementNudge });
        continue;
      }

      if (!hadToolResults && protocol.promptRequiresTools(prompt) && !toolProtocolNudgeSent) {
        toolProtocolNudgeSent = true;
        activeHistory.push({ role: "assistant", content: rawText });
        activeHistory.push({ role: "user", content: toolNudges.missingToolsNudge });
        continue;
      }

      if (!hadToolResults && protocol.promptRequiresTools(prompt) && toolProtocolNudgeSent) {
        return {
          ok: false,
          exitCode: 1,
          sessionId,
          text:
            "当前模型没有按 Agent 工具协议执行任务：它没有真正调用任何本地工具，所以这轮任务被中止。请切换到更稳定的 Agent 模型，或继续让我为这个模型单独做工具协议适配。",
          error: "model_did_not_call_tools",
          rawEvents,
          remoteConversationId: "",
          remoteTitle: "",
          usedModel,
          actualChannel: "real-remote-noncompliant",
          actualContextWindow: contextWindow,
          usageInputTokens: usage.inputTokens,
          usageOutputTokens: usage.outputTokens,
          usageTotalTokens: usage.totalTokens
        };
      }

      if (hadToolResults && protocol.promptRequiresWrite(prompt) && !didCallWriteTool && !writeNudgeSent) {
        writeNudgeSent = true;
        activeHistory.push({ role: "assistant", content: rawText });
        activeHistory.push({ role: "user", content: toolNudges.writeFollowupNudge });
        continue;
      }

      if (isRepairTask && !hadMutatingToolResults && !repairActionNudgeSent) {
        repairActionNudgeSent = true;
        activeHistory.push({ role: "assistant", content: rawText });
        activeHistory.push({
          role: "user",
          content:
            "This is a repair task. You must not claim success unless you actually modify at least one real project file using a mutating tool such as write_file, move_file, rename_file, make_dir, delete_file, or delete_dir. Read-only inspection is not a repair. Perform the smallest concrete fix now."
        });
        continue;
      }

      if (
        isRepairTask &&
        hadMutatingToolResults &&
        (!hadVerificationAfterMutation || unverifiedMutatedPaths.length > 0) &&
        !verificationNudgeSent
      ) {
        verificationNudgeSent = true;
        emitVerificationEvent(
          onEvent,
          rawEvents,
          "pending",
          "已检测到修复动作，但修改后还没有复检。正在要求模型继续执行至少一步验证。"
        );
        activeHistory.push({ role: "assistant", content: rawText });
        activeHistory.push({
          role: "user",
          content:
            "Before finalizing a repair task, run at least one verification step after the modification. Read the modified file, inspect the affected directory, or verify the changed artifact now, then give the final answer."
        });
        continue;
      }

      if (changedPackageManifest && !hadDependencyVerification && !dependencyVerificationNudgeSent) {
        dependencyVerificationNudgeSent = true;
        emitVerificationEvent(
          onEvent,
          rawEvents,
          "dependency_pending",
          "已修改 package.json，但还没有验证 package-lock.json 或依赖安装状态。"
        );
        activeHistory.push({ role: "assistant", content: rawText });
        activeHistory.push({
          role: "user",
          content:
            "You changed package.json. Before claiming the dependency repair is complete, verify the dependency state by reading package-lock.json or running an install verification step. Then report whether the manifest and lockfile are aligned."
        });
        continue;
      }

      if (hadToolResults && protocol.looksLikeGenericAcknowledgement(latestText) && !finalAnswerNudgeSent) {
        finalAnswerNudgeSent = true;
        activeHistory.push({ role: "assistant", content: rawText });
        activeHistory.push({
          role: "user",
          content:
            "Do not output generic completion text. Based on the tool results in this round, provide concrete findings and conclusions: what you checked, what you found, what is still unresolved, and your next actionable step."
        });
        continue;
      }

      if (hadToolResults && !latestText && !finalAnswerNudgeSent) {
        finalAnswerNudgeSent = true;
        activeHistory.push({ role: "assistant", content: rawText });
        activeHistory.push({ role: "user", content: toolNudges.finalAnswerNudge });
        continue;
      }

      if (hadToolResults && protocol.looksLikeGenericAcknowledgement(latestText) && finalAnswerNudgeSent) {
        return {
          ok: true,
          exitCode: 0,
          sessionId,
          text: protocol.buildFallbackCompletionFromResults(prompt, extractToolResultSummaries(rawEvents)),
          error: "",
          rawEvents,
          remoteConversationId: "",
          remoteTitle: "",
          usedModel,
          actualChannel: rawEvents.some((event) => Array.isArray(event.toolCalls) && event.toolCalls.length)
            ? "real-remote-agent"
            : "real-remote",
          actualContextWindow: contextWindow,
          usageInputTokens: usage.inputTokens,
          usageOutputTokens: usage.outputTokens,
          usageTotalTokens: usage.totalTokens
        };
      }

      if (shouldContinueAutonomously(latestText, rawEvents, prompt, workspace)) {
        if (autoContinueNudgeCount >= 4) {
          return {
            ok: true,
            exitCode: 0,
            sessionId,
            text:
              latestText ||
              protocol.buildFallbackCompletionFromResults(
                prompt,
                extractToolResultSummaries(rawEvents)
              ),
            error: "",
            rawEvents,
            remoteConversationId: "",
            remoteTitle: "",
            usedModel,
            actualChannel: rawEvents.some((event) => Array.isArray(event.toolCalls) && event.toolCalls.length)
              ? "real-remote-agent"
              : "real-remote",
            actualContextWindow: contextWindow,
            usageInputTokens: usage.inputTokens,
            usageOutputTokens: usage.outputTokens,
            usageTotalTokens: usage.totalTokens
          };
        }
        autoContinueNudgeCount += 1;
        const unfinishedReadPaths = getUnfinishedRequiredReadPaths(prompt, rawEvents, workspace);
        const nextRequiredPath = unfinishedReadPaths[0] || "";
        logRuntime("model:auto_continue", {
          step,
          textPreview: latestText.slice(0, 200),
          unfinishedRequiredReads: unfinishedReadPaths.length > 0,
          autoContinueNudgeCount,
          nextRequiredPath
        });

        activeHistory.push({ role: "assistant", content: rawText });
        activeHistory.push({
          role: "user",
          content:
            unfinishedReadPaths.length > 0
              ? [
                  "Continue autonomously.",
                  "Do not stop at a partial progress summary.",
                  "The task is not complete yet because these required files have not been inspected:",
                  ...unfinishedReadPaths.map((filePath, index) => `${index + 1}. ${filePath}`),
                  `Call the next required tool now for ${nextRequiredPath}.`,
                  "Use the exact absolute file paths listed above.",
                  "Do not switch to a different workspace and do not use relative paths like package.json or src/App.tsx by themselves.",
                  "Respond with tool calls first. Do not only describe the next action.",
                  "Only give the final answer after every required file above has been inspected or a concrete blocker prevents completion."
                ].join("\n")
              : [
                  "Continue autonomously.",
                  "Do not stop at a partial progress summary.",
                  "If there are unfinished requested files, checks, or steps, keep calling tools until they are done.",
                  "Respond with tool calls first when more execution is needed.",
                  "Only give the final answer when the full requested task has actually been completed or a concrete blocker prevents completion."
                ].join("\n")
        });
        continue;
      }

      if (isRepairTask && unverifiedMutatedPaths.length > 0) {
        activeHistory.push({ role: "assistant", content: rawText });
        activeHistory.push({
          role: "user",
          content: [
            "The repair task is still not complete.",
            "You already modified files, but these modified files still have not been explicitly re-read after the final write step:",
            ...unverifiedMutatedPaths.map((filePath, index) => `${index + 1}. ${filePath}`),
            "Read them now before giving the final answer."
          ].join("\n")
        });
        continue;
      }

      if (
        isRepairTask &&
        hadMutatingToolResults &&
        hadVerificationAfterMutation &&
        unverifiedMutatedPaths.length === 0
      ) {
        const detail =
          changedPackageManifest && hadDependencyVerification
            ? "修复后的文件与依赖状态已完成复检。"
            : changedPackageManifest
              ? "修复后的文件已复检；依赖文件也已参与校验。"
              : "修复后的文件已完成至少一步复检。";
        emitVerificationEvent(onEvent, rawEvents, "passed", detail);
      }

      return {
        ok: true,
        exitCode: 0,
        sessionId,
        text:
          latestText ||
          protocol.buildFallbackCompletionFromResults(
            prompt,
            extractToolResultSummaries(rawEvents)
          ),
        error: "",
        rawEvents,
        remoteConversationId: "",
        remoteTitle: "",
        usedModel,
        actualChannel: rawEvents.some((event) => Array.isArray(event.toolCalls) && event.toolCalls.length)
          ? "real-remote-agent"
          : "real-remote",
        actualContextWindow: contextWindow,
        usageInputTokens: usage.inputTokens,
        usageOutputTokens: usage.outputTokens,
        usageTotalTokens: usage.totalTokens
      };
    }

    const results = [];
    for (const call of toolCalls) {
      if (signal?.aborted) {
        return {
          ok: false,
          exitCode: 130,
          sessionId,
          text: "本轮任务已手动停止。",
          error: "aborted_by_user",
          rawEvents,
          remoteConversationId: "",
          remoteTitle: "",
          usedModel,
          actualChannel: "real-remote-agent",
          actualContextWindow: contextWindow,
          usageInputTokens: usage.inputTokens,
          usageOutputTokens: usage.outputTokens,
          usageTotalTokens: usage.totalTokens
        };
      }

      if (call.name === "write_file") {
        didCallWriteTool = true;
      }

      const protectedInspectionViolation =
        isRepairTask ? getProtectedInspectionViolation(call, prompt, workspace) : "";
      if (protectedInspectionViolation) {
        const blockedResult = {
          ok: false,
          name: call.name,
          summary: `Protected runtime inspection blocked: ${protectedInspectionViolation}`,
          output:
            "Self-heal mode should diagnose user-facing project files first. Core Agent runtime files are excluded unless the user explicitly asked to inspect that file."
        };
        results.push(blockedResult);
        emitEvent(onEvent, rawEvents, {
          type: "tool_result",
          step: step + 1,
          tool: call.name,
          ok: false,
          summary: blockedResult.summary,
          output: blockedResult.output
        });
        continue;
      }

      const protectedPathViolation =
        isRepairTask ? getProtectedPathViolation(call, prompt, workspace) : "";
      if (protectedPathViolation) {
        const blockedResult = {
          ok: false,
          name: call.name,
          summary: `Protected core runtime file blocked: ${protectedPathViolation}`,
          output:
            "Self-heal mode may not modify protected Agent runtime files unless the user explicitly asked to repair that file."
        };
        results.push(blockedResult);
        emitEvent(onEvent, rawEvents, {
          type: "tool_result",
          step: step + 1,
          tool: call.name,
          ok: false,
          summary: blockedResult.summary,
          output: blockedResult.output
        });
        continue;
      }

      emitEvent(onEvent, rawEvents, {
        type: "task_status",
        status: "tool_running",
        message: `正在执行工具：${call.name}`
      });

      const result = await executeToolCall(workspace, call, {
        accessScope: settings?.access?.scope || "workspace-and-desktop",
        confirm: (toolCall) =>
          requestToolPermission(toolCall, (permissionEvent) => {
            emitEvent(onEvent, rawEvents, {
              ...permissionEvent,
              step: step + 1
            });
          })
      });

      results.push(result);
      logRuntime("tool:executed", {
        tool: call.name,
        ok: result.ok,
        summary: result.summary,
        args: JSON.stringify(call.arguments || call.args || {}).slice(0, 500),
        outputPreview: String(result.output || "").slice(0, 300)
      });
      emitEvent(onEvent, rawEvents, {
        type: "tool_result",
        step: step + 1,
        tool: call.name,
        ok: result.ok,
        summary: result.summary,
        output: result.output
      });
    }

    const hasWriteArgumentFailure = results.some(
      (result) =>
        result.name === "write_file" &&
        !result.ok &&
        /Missing required argument: (path|content)/i.test(String(result.summary || ""))
    );

    activeHistory.push({
      role: "assistant",
      content: clampText(rawText, 4000)
    });
    activeHistory.push({
      role: "user",
      content: clampText(protocol.buildToolResultMessage(results), 5000)
    });

    if (protocol.promptRequiresWrite(prompt) && hasWriteArgumentFailure && !writeArgumentRetrySent) {
      writeArgumentRetrySent = true;
      activeHistory.push({
        role: "user",
        content:
          "你刚才已经调用了 write_file，但参数不完整。下一条请重新调用 write_file，并至少提供 path 和 content。若用户要求放到桌面，请把 path 写成 Desktop/notes.txt 这种明确路径。不要解释，只输出工具调用。"
      });
    }
  }

  return {
    ok: false,
    exitCode: 1,
    sessionId,
    text: latestText || `Agent reached the maximum tool-call steps (${maxAgentSteps}) without producing a final answer.`,
    error: "agent_step_limit_reached",
    rawEvents,
    remoteConversationId: "",
    remoteTitle: "",
    usedModel,
    actualChannel: "real-remote-agent",
    actualContextWindow: contextWindow,
    usageInputTokens: usage.inputTokens,
    usageOutputTokens: usage.outputTokens,
    usageTotalTokens: usage.totalTokens
  };
}

async function runLocalPrompt({
  workspace,
  sessionId,
  prompt,
  settings,
  history,
  sessionMeta,
  attachments = [],
  onEvent
}) {
  const remote = settings?.remote || {};
  const normalizedModelId = normalizeRemoteModelId(remote.model);
  const baseUrl = (remote.baseUrl || "").trim().replace(/\/+$/, "");
  const endpointPlan = resolveLocalProviderEndpoint(baseUrl, remote.provider);
  const activeSkills = skillRegistry.detectRelevantSkills(prompt);
  const skillPreflightNudge = buildSkillPreflightNudge(activeSkills);
  const skillWorkflowNudge = skillRegistry.buildSkillWorkflowNudge(activeSkills);

  const attachmentSummary = attachments.length
    ? `\n\n[Attachments]\n${attachments.map((item, index) => `${index + 1}. ${item.name} | ${item.path}`).join("\n")}`
    : "";

  if (!baseUrl) {
    return {
      ok: false,
      exitCode: 1,
      sessionId,
      text: "未配置远程接口地址。",
      error: "missing_base_url",
      rawEvents: []
    };
  }

  try {
    const finalPrompt = [prompt, skillPreflightNudge, skillWorkflowNudge, attachmentSummary].filter(Boolean).join("\n\n");
    const systemPrompt = buildSafeSystemPrompt(settings, sessionMeta, activeSkills);
    const requestPayload = {
      model: normalizedModelId,
      systemPrompt,
      workspace,
      sessionId,
      prompt: finalPrompt,
      history
    };
    const openAiPayload = {
      model: normalizedModelId,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        ...normalizeHistoryMessages(history),
        {
          role: "user",
          content: finalPrompt
        }
      ],
      stream: false
    };
    const ollamaPayload = {
      model: normalizedModelId,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        ...normalizeHistoryMessages(history),
        {
          role: "user",
          content: finalPrompt
        }
      ],
      stream: false
    };
    const authorizationHeader = resolveAuthorizationHeaderValue(remote, endpointPlan.requestUrl);
    let response = null;
    let lastError = null;
    for (let attempt = 1; attempt <= DEFAULT_REMOTE_NETWORK_RETRIES; attempt += 1) {
      const timeoutController = new AbortController();
      const timer = setTimeout(
        () => timeoutController.abort(new Error("remote_local_prompt_timeout")),
        DEFAULT_REMOTE_REQUEST_TIMEOUT_MS
      );
      try {
        response = await fetch(endpointPlan.requestUrl, {
          method: "POST",
          signal: timeoutController.signal,
          headers: {
            "Content-Type": "application/json",
            ...(authorizationHeader ? { Authorization: authorizationHeader } : {})
          },
          body: JSON.stringify(
            endpointPlan.mode === "openai"
              ? openAiPayload
              : endpointPlan.mode === "ollama"
                ? ollamaPayload
                : requestPayload
          )
        });
        clearTimeout(timer);
        break;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (!isNetworkFetchFailure(error) || attempt >= DEFAULT_REMOTE_NETWORK_RETRIES) {
          throw error;
        }
        await wait(350 * attempt);
      }
    }

    if (!response) {
      throw lastError || new Error("remote_local_prompt_failed");
    }

    const payload = await parseJsonResponse(response);
    const text =
      extractOpenAiMessageText(payload) ||
      payload?.message?.content ||
      payload.output ||
      payload.text ||
      payload.message ||
      payload.rawText ||
      (response.ok ? "本地测试引擎已响应，但没有返回文本。" : "本地测试引擎调用失败。");

    const normalizedText = protocol.tryRecoverMojibake(String(text || ""));
    const errorDetail = payload?.error?.message || payload?.error || payload?.message || `http_${response.status}`;
    const errorText = String(errorDetail || "");
    const isAuthFailure =
      !response.ok &&
      (response.status === 401 ||
        response.status === 403 ||
        /token|api[\s_-]?key|auth|unauthor|forbidden|令牌|鉴权|验证/i.test(errorText));
    let resolvedResponse = response;
    let resolvedPayload = payload;
    let resolvedText = normalizedText || text;
    let resolvedErrorDetail = errorDetail;
    let resolvedErrorText = errorText;
    let resolvedUsedModel = payload.model || normalizedModelId;

    if (
      !response.ok &&
      endpointPlan.mode === "openai" &&
      isBigModelHost(endpointPlan.requestUrl) &&
      isQuotaLikeFailure(response.status, errorText)
    ) {
      const fallbackModels = buildBigModelFallbackModels(normalizedModelId);
      for (const fallbackModel of fallbackModels) {
        try {
          const fallbackOpenAiPayload = {
            ...openAiPayload,
            model: fallbackModel
          };
          const fallbackResponse = await fetch(endpointPlan.requestUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(authorizationHeader ? { Authorization: authorizationHeader } : {})
            },
            body: JSON.stringify(fallbackOpenAiPayload)
          });
          const fallbackPayload = await parseJsonResponse(fallbackResponse);
          const fallbackText =
            extractOpenAiMessageText(fallbackPayload) ||
            fallbackPayload?.message?.content ||
            fallbackPayload.output ||
            fallbackPayload.text ||
            fallbackPayload.message ||
            fallbackPayload.rawText ||
            "";
          const fallbackErrorDetail =
            fallbackPayload?.error?.message ||
            fallbackPayload?.error ||
            fallbackPayload?.message ||
            `http_${fallbackResponse.status}`;

          if (fallbackResponse.ok) {
            resolvedResponse = fallbackResponse;
            resolvedPayload = fallbackPayload;
            resolvedText = `[Auto fallback] ${normalizedModelId} quota/resource unavailable, switched to ${fallbackModel}.\n\n${fallbackText}`.trim();
            resolvedErrorDetail = "";
            resolvedErrorText = "";
            resolvedUsedModel = fallbackPayload.model || fallbackModel;
            break;
          }

          if (!isQuotaLikeFailure(fallbackResponse.status, fallbackErrorDetail)) {
            resolvedResponse = fallbackResponse;
            resolvedPayload = fallbackPayload;
            resolvedText = fallbackText;
            resolvedErrorDetail = fallbackErrorDetail;
            resolvedErrorText = String(fallbackErrorDetail || "");
            resolvedUsedModel = fallbackPayload.model || fallbackModel;
            break;
          }
        } catch {}
      }
    }

    const finalAuthFailure =
      !resolvedResponse.ok &&
      (resolvedResponse.status === 401 ||
        resolvedResponse.status === 403 ||
        /token|api[\s_-]?key|auth|unauthor|forbidden|令牌|鉴权|验证/i.test(resolvedErrorText));
    const failureText = finalAuthFailure
      ? `Custom HTTP Provider auth failed (${endpointPlan.requestUrl}): ${resolvedErrorText}`
      : `Custom HTTP Provider request failed (${endpointPlan.requestUrl}): ${resolvedErrorText}`;
    let finalText = resolvedResponse.ok ? resolvedText : failureText;
    const localRawEvents = Array.isArray(resolvedPayload?.events) ? [...resolvedPayload.events] : [];

    // 轻量 Agent 循环：本地/自定义通道若输出了工具调用标签，立即真实执行并回填结果，避免只显示 <vgo_tool_call> 文本。
    if (resolvedResponse.ok) {
      const extractedToolCalls = extractToolCalls(extractAssistantRawText(resolvedPayload));
      if (extractedToolCalls.length) {
        for (const call of extractedToolCalls) {
          emitEvent(onEvent, localRawEvents, {
            type: "task_status",
            status: "tool_running",
            message: `正在执行工具：${call.name}`
          });
          const toolResult = await executeToolCall(workspace, call, {
            accessScope: settings?.access?.scope || "workspace-and-desktop"
          });
          emitEvent(onEvent, localRawEvents, {
            type: "tool_result",
            tool: call.name,
            ok: toolResult.ok,
            summary: toolResult.summary,
            output: toolResult.output
          });
        }

        const toolMessage = protocol.buildToolResultMessage(
          localRawEvents
            .filter((event) => event?.type === "tool_result")
            .map((event) => ({
              ok: event.ok,
              name: event.tool,
              summary: event.summary,
              output: event.output
            }))
        );

        if (endpointPlan.mode === "openai" || endpointPlan.mode === "ollama") {
          try {
            const followupPayload = {
              model: resolvedUsedModel || normalizedModelId,
              messages: [
                { role: "system", content: systemPrompt },
                ...normalizeHistoryMessages(history),
                { role: "user", content: finalPrompt },
                { role: "assistant", content: clampText(extractAssistantRawText(resolvedPayload), 4000) },
                { role: "user", content: clampText(toolMessage, 5000) },
                {
                  role: "user",
                  content:
                    "Based on the tool results above, provide a concrete final answer with key findings and direct conclusion. Do not output tool tags. Do not reply with generic completion text."
                },
                {
                  role: "user",
                  content:
                    "基于以上工具结果，直接给出最终结论与关键发现，不要输出工具调用标签，不要只说已完成。"
                }
              ],
              stream: false
            };
            const followupResponse = await fetch(endpointPlan.requestUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(authorizationHeader ? { Authorization: authorizationHeader } : {})
              },
              body: JSON.stringify(followupPayload)
            });
            const followupData = await parseJsonResponse(followupResponse);
            if (followupResponse.ok) {
              const followupText =
                extractOpenAiMessageText(followupData) ||
                followupData?.message?.content ||
                followupData?.output ||
                followupData?.text ||
                "";
              const cleanedFollowup = modelAdapters.stripCustomerServiceBoilerplate(
                protocol.sanitizeAssistantText(followupText),
                prompt
              );
              finalText =
                cleanedFollowup ||
                protocol.buildFallbackCompletionFromResults(
                  prompt,
                  extractToolResultSummaries(localRawEvents)
                );
            } else {
              finalText = protocol.buildFallbackCompletionFromResults(
                prompt,
                extractToolResultSummaries(localRawEvents)
              );
            }
          } catch {
            finalText = protocol.buildFallbackCompletionFromResults(
              prompt,
              extractToolResultSummaries(localRawEvents)
            );
          }
        } else {
          finalText = protocol.buildFallbackCompletionFromResults(
            prompt,
            extractToolResultSummaries(localRawEvents)
          );
        }
      }
    }

    return {
      ok: resolvedResponse.ok,
      exitCode: resolvedResponse.ok ? 0 : 1,
      sessionId,
      text: finalText,
      error:
        resolvedResponse.ok
          ? ""
          : resolvedErrorDetail,
      rawEvents: localRawEvents,
      usedModel: resolvedUsedModel,
      actualChannel:
        resolvedPayload.channel ||
        (endpointPlan.mode === "openai"
          ? "custom-openai-agent"
          : endpointPlan.mode === "ollama"
            ? "custom-ollama-agent"
            : "local-mock"),
      actualContextWindow: toNumber(resolvedPayload?.contextWindow),
      usageInputTokens: toNumber(resolvedPayload?.usage?.inputTokens || resolvedPayload?.usage?.prompt_tokens),
      usageOutputTokens: toNumber(resolvedPayload?.usage?.outputTokens || resolvedPayload?.usage?.completion_tokens),
      usageTotalTokens: toNumber(resolvedPayload?.usage?.totalTokens || resolvedPayload?.usage?.total_tokens)
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      sessionId,
      text: `无法连接远程引擎：${error.message}`,
      text: `Unable to reach remote provider: ${error.message}`,
      error: error.message,
      rawEvents: []
    };
  }
}

async function runPrompt(args) {
  if (args.settings?.vgoAI?.loggedIn && !args.settings?.vgoAI?.accessToken) {
    return {
      ok: false,
      exitCode: 1,
      sessionId: args.sessionId,
      text: "当前界面显示已登录，但 accessToken 不可用，所以还没有真正进入远程模型通道。",
      error: "missing_access_token",
      rawEvents: []
    };
  }

  if (shouldUseRealVgoChannel(args.settings)) {
    try {
      return await runRealVgoPrompt(args);
    } catch (error) {
      if (error?.name === "AbortError" || error?.message === "aborted_by_user") {
        return {
          ok: false,
          exitCode: 130,
          sessionId: args.sessionId,
          text: "本轮任务已手动停止。",
          error: "aborted_by_user",
          rawEvents: []
        };
      }
      return {
        ok: false,
        exitCode: 1,
        sessionId: args.sessionId,
        text: `真实 VGO 远程调用失败：${error.message}`,
        error: error.message,
        rawEvents: []
      };
    }
  }

  return runLocalPrompt(args);
}

async function runHealthCheck(_workspace, settings) {
  if (shouldUseRealVgoChannel(settings)) {
    try {
      const response = await fetch("https://vgoai.cn/api/v1/user/profile", {
        headers: {
          Authorization: `Bearer ${settings.vgoAI.accessToken}`
        }
      });
      const payload = await parseJsonResponse(response);

      if (response.ok) {
        return {
          ok: true,
          title: "真实 VGO 账户在线",
          details: `当前已绑定真实账户：${payload?.user?.email || settings.vgoAI.email || settings.vgoAI.displayName}`
        };
      }

      return {
        ok: false,
        title: "真实账户状态异常",
        details: payload?.message || payload?.error || `HTTP ${response.status}`
      };
    } catch (error) {
      return {
        ok: false,
        title: "真实账户连接失败",
        details: error.message
      };
    }
  }

  const remote = settings?.remote || {};
  const baseUrl = (remote.baseUrl || "").trim().replace(/\/+$/, "");
  const endpointPlan = resolveLocalProviderEndpoint(baseUrl, remote.provider);
  if (!baseUrl) {
    return {
      ok: false,
      title: "未配置接口",
      details: "请先在设置面板中填写远程接口地址。"
    };
  }

  if (endpointPlan.mode === "openai") {
    const apiKey = String(remote.apiKey || "").trim();
    if (!apiKey) {
      return {
        ok: false,
        exitCode: 1,
        sessionId,
        text: "Custom HTTP Provider 缺少 API Key。",
        error: "missing_api_key",
        rawEvents: []
      };
    }
    if (apiKey === "********") {
      return {
        ok: false,
        exitCode: 1,
        sessionId,
        text: "Custom HTTP Provider 的 API Key 被占位符覆盖，请在设置页重新填写真实 Key。",
        error: "masked_api_key_placeholder",
        rawEvents: []
      };
    }
  }

  if (endpointPlan.mode === "openai") {
    const apiKey = String(remote.apiKey || "").trim();
    if (!apiKey) {
      return {
        ok: false,
        exitCode: 1,
        sessionId,
        text: "Custom HTTP Provider API key is missing.",
        error: "missing_api_key",
        rawEvents: []
      };
    }
    if (apiKey === "********") {
      return {
        ok: false,
        exitCode: 1,
        sessionId,
        text: "Custom HTTP Provider API key is a masked placeholder. Re-enter the real key in Settings.",
        error: "masked_api_key_placeholder",
        rawEvents: []
      };
    }
  }

  const healthAuthHeader = resolveAuthorizationHeaderValue(
    remote,
    endpointPlan.mode === "openai" ? endpointPlan.requestUrl : `${baseUrl}/health`
  );

  try {
    const response =
      endpointPlan.mode === "openai"
        ? await fetch(endpointPlan.requestUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(healthAuthHeader ? { Authorization: healthAuthHeader } : {})
            },
            body: JSON.stringify({
              model: normalizeRemoteModelId(remote.model),
              messages: [{ role: "user", content: "ping" }],
              max_tokens: 1,
              stream: false
            })
          })
        : await fetch(`${baseUrl}/health`, {
            headers: {
              ...(healthAuthHeader ? { Authorization: healthAuthHeader } : {})
            }
          });
    const payload = await parseJsonResponse(response);
    return response.ok
      ? {
          ok: true,
          title: "本地测试引擎在线",
          details: payload.message || payload.status || `已成功连接到 ${baseUrl}`
        }
      : {
          ok: false,
          title: "本地测试引擎异常",
          details: payload?.error?.message || payload.error || payload.message || `HTTP ${response.status}`
        };
  } catch (error) {
    return {
      ok: false,
      title: "连接失败",
      details: `无法连接到 ${baseUrl}：${error.message}`
    };
  }
}

function openLoginShell() {
  return;
}

module.exports = {
  engineId: "vgo-remote",
  engineLabel: "VGO Remote Engine",
  providerLabel: "VGO AI Cloud",
  runPrompt,
  runHealthCheck,
  openLoginShell
};
