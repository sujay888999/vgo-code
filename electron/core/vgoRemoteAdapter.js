const fs = require("node:fs");
const { runAgentLoop } = require("./agentLoop");
const { appendEngineLog } = require("./engineLog");
const path = require("node:path");
const crypto = require("node:crypto");
const { executeToolCall } = require("./toolRuntime");
const protocol = require("./agentProtocol");
const modelAdapters = require("./modelAdapterRegistry");
const familyTools = require("./modelFamilyToolAdapters");
const skillRegistry = require("./skillRegistry");
const {
  executeToolCallWithResilience
} = require("./toolResilience");

const DEFAULT_MAX_AGENT_STEPS = 120;
const MIN_AGENT_STEPS = 20;
const MAX_AGENT_STEPS = 300;
const UPSTREAM_RETRYABLE_PATTERN = /Failed to connect to upstream channel/i;
const DEFAULT_REMOTE_REQUEST_TIMEOUT_MS = 90000;
const DEFAULT_REMOTE_NETWORK_RETRIES = 3;
const REMOTE_RETRY_BASE_DELAY_MS = 600;
const MAX_UPSTREAM_RATE_LIMIT_RETRIES = 4;
const DEFAULT_VGO_PROFILE_ID = "default";
const REMOTE_MAX_HISTORY_MESSAGES = 60;
const REMOTE_MAX_MESSAGE_CHARS = 20000;
const REMOTE_MAX_TOTAL_CHARS = 500000;
const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "agent.log");

function logRuntime(event, payload = {}) {
  appendEngineLog(LOG_FILE, event, { channel: "vgo-remote", ...payload });
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
      text.includes("浣欓涓嶈冻") ||
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
  const CALL_NAME_ALIASES = {
    "vgo-music": "run_command",
    "vgo_music": "run_command",
    "vgomusic": "run_command",
    "cli-mcp-server_run_command": "run_command",
    "shell_command": "run_command",
    "bash": "run_command",
    "powershell": "run_command",
    "exec": "run_command",
    "execute": "run_command",
    "copy": "copy_file",
    "move": "move_file",
    "rename": "rename_file",
    "mkdir": "make_dir",
    "create_directory": "make_dir",
    "create_dir": "make_dir",
    "rm": "delete_file",
    "remove_file": "delete_file",
    "rmdir": "delete_dir",
    "remove_dir": "delete_dir",
    "ls": "list_dir",
    "dir": "list_dir",
    "cat": "read_file",
    "open": "open_path",
    "browse": "fetch_web",
    "get_url": "fetch_web",
    "http_get": "fetch_web",
    "transcribe": "transcribe_media",
    "speech_to_text": "transcribe_media"
  };
  const pathLikeTools = new Set([
    "read_file",
    "list_dir",
    "open_path",
    "delete_file",
    "delete_dir",
    "make_dir"
  ]);
  const normalizeKnownArgumentAliases = (name, args = {}) => {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return {};
    }
    const normalized = { ...args };
    const assignFirstString = (targetKey, candidateKeys = []) => {
      const current = normalized[targetKey];
      if (typeof current === "string" && current.trim()) {
        return;
      }
      for (const key of candidateKeys) {
        if (typeof normalized[key] === "string" && normalized[key].trim()) {
          normalized[targetKey] = normalized[key];
          return;
        }
      }
    };
    if (["write_file", "append_file"].includes(name)) {
      assignFirstString("path", ["filePath", "filepath", "file", "filename", "target", "output", "destination"]);
      assignFirstString("content", ["contents", "conten", "text", "body", "value", "data", "code"]);
    }
    if (pathLikeTools.has(name) || name === "search_code") {
      assignFirstString("path", ["filePath", "filepath", "file", "filename", "target", "input", "dir", "directory"]);
    }
    if (name === "run_command") {
      assignFirstString("command", ["cmdline", "cmdLine", "shell", "script", "text", "body", "value", "content",
        "song", "music", "play", "track", "query", "input"]);
      if (
        (normalized.command === undefined || String(normalized.command || "").trim() === "") &&
        typeof normalized.cmd === "string"
      ) {
        normalized.command = normalized.cmd;
      }
      if (
        (normalized.command === undefined || String(normalized.command || "").trim() === "") &&
        typeof normalized.shell_command === "string"
      ) {
        normalized.command = normalized.shell_command;
      }
      if (
        (normalized.command === undefined || String(normalized.command || "").trim() === "") &&
        typeof normalized.arguments === "string"
      ) {
        normalized.command = normalized.arguments;
      }
      if (
        (normalized.timeoutMs === undefined || normalized.timeoutMs === null) &&
        normalized.timeout_ms !== undefined
      ) {
        normalized.timeoutMs = normalized.timeout_ms;
      }
    }
    if (["copy_file", "move_file"].includes(name)) {
      assignFirstString("source", ["src", "from", "origin", "input", "file", "path"]);
      assignFirstString("destination", ["dest", "dst", "to", "target", "output", "newPath"]);
    }
    if (name === "rename_file") {
      assignFirstString("path", ["filePath", "filepath", "file", "filename", "source", "from", "input"]);
      assignFirstString("newName", ["new_name", "newname", "name", "to", "target", "rename_to", "renameTo"]);
    }
    if (name === "fetch_web") {
      assignFirstString("url", ["link", "href", "uri", "address", "website", "site", "page"]);
    }
    if (name === "search_code") {
      assignFirstString("query", ["keyword", "pattern", "text", "search", "term", "find", "input"]);
    }
    if (name === "transcribe_media") {
      assignFirstString("path", ["filePath", "filepath", "file", "filename", "media", "audio", "video", "input"]);
    }
    return normalized;
  };
  const coerceToolArguments = (name, call) => {
    const normalizedName = String(name || "").toLowerCase();
    const rawArguments = call?.arguments ?? call?.args;
    if (rawArguments && typeof rawArguments === "object" && !Array.isArray(rawArguments)) {
      return normalizeKnownArgumentAliases(normalizedName, rawArguments);
    }

    if (typeof rawArguments === "string") {
      const trimmed = rawArguments.trim();
      const parsed = safeParseJson(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return normalizeKnownArgumentAliases(normalizedName, parsed);
      }

      if (trimmed && normalizedName === "run_command") {
        return { command: trimmed };
      }

      if (trimmed && pathLikeTools.has(normalizedName)) {
        return { path: trimmed };
      }
    }

    const fallback = {};
    const knownTopLevelKeys = [
      "path",
      "content",
      "command",
      "cwd",
      "query",
      "url",
      "format",
      "source",
      "destination",
      "newName",
      "title",
      "maxLines",
      "maxEntries",
      "maxResults",
      "maxChars",
      "timeoutMs",
      "timeout_ms"
    ];
    for (const key of knownTopLevelKeys) {
      if (call && call[key] !== undefined) {
        fallback[key] = call[key];
      }
    }
    return normalizeKnownArgumentAliases(normalizedName, fallback);
  };

  return calls
    .filter((call) => call && typeof call === "object" && call.name)
    .map((call) => {
      const resolvedName = CALL_NAME_ALIASES[String(call.name).trim().toLowerCase()] || String(call.name);
      return {
        name: resolvedName,
        arguments: coerceToolArguments(resolvedName, call)
      };
    });
}

function isRateLimitLikeFailure(status, errorText = "") {
  const code = Number(status || 0);
  const text = String(errorText || "").toLowerCase();
  return (
    code === 429 ||
    /http\s*429/i.test(String(errorText || "")) ||
    text.includes("too many requests") ||
    text.includes("rate limit") ||
    text.includes("rate_limit") ||
    text.includes("限流") ||
    text.includes("请求过于频繁")
  );
}

function isRateLimitUpstreamFailure(response, payload) {
  if (!response || response.ok) {
    return false;
  }
  const status = Number(response?.status || 0);
  const messageText = String(payload?.message || payload?.error || payload?.rawText || "");
  if (!isRateLimitLikeFailure(status, messageText)) {
    return false;
  }
  // Distinguish hard quota exhaustion from transient throttling.
  if (isQuotaLikeFailure(status, messageText)) {
    return false;
  }
  return true;
}

function getMissingRequiredToolArgument(call = {}) {
  const name = String(call?.name || "").trim().toLowerCase();
  const args =
    call?.arguments && typeof call.arguments === "object"
      ? call.arguments
      : call?.args && typeof call.args === "object"
        ? call.args
        : {};
  if (name === "run_command") {
    const action = String(args.processAction || args.action || "").trim().toLowerCase();
    if (action === "list") {
      return "";
    }
    if (action === "status" || action === "stop") {
      const pid = Number(args.pid);
      return Number.isInteger(pid) && pid > 0 ? "" : "pid";
    }
  }
  const requiredByTool = {
    read_file: ["path"],
    write_file: ["path", "content"],
    append_file: ["path", "content"],
    run_command: ["command"],
    copy_file: ["source", "destination"],
    move_file: ["source", "destination"],
    rename_file: ["path", "newName"],
    make_dir: ["path"],
    delete_file: ["path"],
    delete_dir: ["path"],
    open_path: ["path"],
    fetch_web: ["url"],
    generate_word_doc: ["path"]
  };
  const required = requiredByTool[name] || [];
  if (!required.length) {
    return "";
  }
  for (const key of required) {
    if (args[key] === undefined || args[key] === null || String(args[key]).trim() === "") {
      return key;
    }
  }
  return "";
}

function extractWriteFileFallbackFromCommand(command = "") {
  const source = String(command || "");
  if (!source) {
    return null;
  }

  const catWriteMatch =
    source.match(/cat\s*>\s*(['"]?)([^'"\r\n]+)\1\s*<<\s*['"]?EOF['"]?\s*\r?\n([\s\S]*?)\r?\nEOF/i) ||
    source.match(/cat\s*<<\s*['"]?EOF['"]?\s*>\s*(['"]?)([^'"\r\n]+)\1\s*\r?\n([\s\S]*?)\r?\nEOF/i);
  if (catWriteMatch) {
    const filePath = String(catWriteMatch[2] || "").trim();
    const content = String(catWriteMatch[3] || "");
    if (filePath && content) {
      return {
        name: "write_file",
        arguments: {
          path: filePath,
          content
        }
      };
    }
  }

  return null;
}

function buildToolFallbackCall(call = {}, result = {}) {
  const name = String(call?.name || "").trim().toLowerCase();
  const args =
    call?.arguments && typeof call.arguments === "object"
      ? call.arguments
      : call?.args && typeof call.args === "object"
        ? call.args
        : {};
  const summary = String(result?.summary || "");

  if (name === "run_command" && /Command exited with code/i.test(summary)) {
    const fallback = extractWriteFileFallbackFromCommand(String(args.command || ""));
    if (fallback) {
      return fallback;
    }
  }

  return null;
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
      "VGO CODE 桌面 Agent",
      "你是一个专业的桌面 AI 助手。",
      "你是一个专业的桌面 AI 助手。???",
      "你是一个专业的桌面 AI 助手。??",
      appendix,
      `技能附录：${error.message}`
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

function resolveSkillRequiredInspectionPaths(skills = [], workspace = "") {
  const normalizedWorkspace = String(workspace || "").trim();
  if (!normalizedWorkspace) {
    return skills;
  }

  return skills.map((skill) => {
    const requiredInspectionPaths = (skill.requiredInspectionPaths || []).filter((relativePath) => {
      try {
        const absolutePath = path.resolve(normalizedWorkspace, relativePath);
        return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
      } catch (_error) {
        return false;
      }
    });

    return {
      ...skill,
      requiredInspectionPaths
    };
  });
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
  const message = payload?.choices?.[0]?.message;
  const content = message?.content;
  // DeepSeek and similar models put reasoning in reasoning_content separately
  // Reconstruct the full text with <think> wrapper so sanitizeAssistantText can strip it
  const reasoningContent = String(message?.reasoning_content || "").trim();

  let mainText = "";
  if (typeof content === "string") {
    mainText = content;
  } else if (Array.isArray(content)) {
    mainText = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") return part.text || part.content || "";
        return "";
      })
      .join("")
      .trim();
  } else {
    mainText = String(payload?.output_text || payload?.text || "");
  }

  // If reasoning_content exists, prepend it as <think>...</think>
  if (reasoningContent) {
    // Strip any stray </think> from mainText since we're reconstructing it
    const cleanMain = mainText.replace(/<\/think>/gi, "").trim();
    return `<think>${reasoningContent}</think>${cleanMain ? "\n" + cleanMain : ""}`;
  }

  return mainText;
}

function isRetryableUpstreamFailure(response, payload) {
  if (!response || response.ok) {
    return false;
  }
  const status = Number(response?.status || 0);
  const messageText = String(payload?.message || payload?.error || payload?.rawText || "");

  // Service-side transient errors should be retried/fallback-switched automatically.
  if (status >= 500 && status <= 599) {
    return true;
  }

  // Some upstream failures are wrapped as 400 with message containing HTTP 500 style text.
  if (/HTTP\s*50[0-9]/i.test(messageText)) {
    return true;
  }

  if (/upstream\s*channel|No available channel for this model/i.test(messageText)) {
    return true;
  }

  if (isRateLimitUpstreamFailure(response, payload)) {
    return true;
  }

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

  if (status === 429 || (status === 400 && /HTTP\s*429/i.test(rawMessage))) {
    if (isQuotaLikeFailure(status, rawMessage)) {
      return "当前云端模型调用失败：账号额度不足或配额耗尽（HTTP 429）。请补充额度或切换其他可用模型。";
    }
    return "当前云端模型触发限流（HTTP 429）。系统已自动退避重试；若仍失败，请稍后再试或切换模型。";
  }

  return rawMessage || `HTTP ${status || 500}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeRetryDelayMs(attempt = 1) {
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  const base = REMOTE_RETRY_BASE_DELAY_MS * Math.pow(2, safeAttempt - 1);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(4000, base + jitter);
}

function computeRateLimitRetryDelayMs(attempt = 1) {
  // 限速专用退避：1次→8s, 2次→16s, 3次→30s, 4次→60s，给服务端足够的冷却时间
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  const base = 8000 * Math.pow(2, safeAttempt - 1);
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(60000, base + jitter);
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

function buildFallbackModelCandidates(settings, currentModel) {
  const catalog = getCatalogModels(settings)
    .map((item) => String(item.id || "").trim())
    .filter(Boolean);
  if (!catalog.length) return [];

  const preferred = String(settings?.vgoAI?.preferredModel || "").trim();
  const seen = new Set([String(currentModel || "").trim()]);
  const candidates = [];

  const pushCandidate = (id) => {
    const value = String(id || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };

  // 1) Explicit fallback model in settings.
  const configuredFallback = String(settings?.agent?.fallbackModel || "").trim();
  pushCandidate(configuredFallback);

  // 2) Same-family alternative first (keeps behavior continuity).
  const currentFamily = modelAdapters.getModelFamily(currentModel);
  for (const modelId of catalog) {
    if (modelAdapters.getModelFamily(modelId) === currentFamily) {
      pushCandidate(modelId);
    }
  }

  // 3) Preferred model if different.
  pushCandidate(preferred);

  // 4) Non-NVIDIA/Gemma models first when upstream is unstable for that family.
  const nonNvidiaLike = catalog.filter(
    (id) => !/^google\/gemma-/i.test(id) && !/^nvidia\//i.test(id)
  );
  for (const modelId of nonNvidiaLike) {
    pushCandidate(modelId);
  }

  // 5) Remaining models.
  for (const modelId of catalog) {
    pushCandidate(modelId);
  }

  return candidates;
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
      .replace(/[，。；,.;:!?、]+$/, "");
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

function promptAllowsAutonomousContinuation(prompt) {
  const n = String(prompt || "").trim().toLowerCase();
  if (!n) return false;
  return (/继续|自动|完整|直到完成|修复完|排查并修复/.test(n) ||
    /continue|keep going|autonom|end-to-end/.test(n) ||
    /检查|查看|分析|扫描|诊断|排查|帮我/.test(n) ||
    /是否|能否|可以|有没有|是什么|怎么样/.test(n) ||
    /check|inspect|analyz|diagnos|scan|review|audit|find|look/i.test(n));
}
function shouldContinueAutonomously(text, rawEvents, prompt, workspace) {
  const normalized = String(text || "").trim();
  if (!normalized) { return false; }

  const hasToolResults = rawEvents.some((e) => e && e.type === "tool_result");
  const unfinishedRequiredReads = hasUnfinishedRequiredReads(prompt, rawEvents, workspace);
  const successfulWrite = rawEvents.some((e) => e && e.type === "tool_result" && e.tool === "write_file" && e.ok);
  const allReadsFailed = rawEvents.some((e) => e && e.type === "tool_result" && e.tool === "read_file" && !e.ok);

  if (successfulWrite && allReadsFailed) { return false; }

  const finalPatterns = [
    /agent\s*\u5df2\u5b8c\u6210\u672c\u8f6e\u4efb\u52a1/i,
    /\u4efb\u52a1\u5b8c\u6210/i, /\u5904\u7406\u5b8c\u6210/i,
    /\u7ed3\u8bba[::\uff1a]/i, /final answer/i, /done/i, /completed/i
  ];
  if (finalPatterns.some((p) => p.test(normalized))) {
    return unfinishedRequiredReads && !allReadsFailed;
  }

  // If there are unfinished reads and reads haven't all failed, keep going
  if (unfinishedRequiredReads && !allReadsFailed) { return true; }
  if (allReadsFailed && successfulWrite) { return false; }

  const continuationPatterns = [
    /\u7ee7\u7eed\u601d\u8003/i, /\u7ee7\u7eed\u5904\u7406/i, /\u7ee7\u7eed\u6267\u884c/i,
    /\u6b63\u5728\u601d\u8003/i, /thinking/i, /continue/i, /keep going/i,
    /next step/i, /step\s*\d+\s*\/\s*\d+/i,
    /\u8ba9\u6211\u8fdb\u4e00\u6b65/i, /\u8ba9\u6211\u68c0\u67e5/i, /\u8ba9\u6211\u67e5\u770b/i,
    /\u8ba9\u6211\u5148/i, /\u6211\u5c06\u8fdb\u4e00\u6b65/i, /\u6211\u9700\u8981\u68c0\u67e5/i,
    /\u6211\u9700\u8981\u67e5\u770b/i, /\u6211\u5c06\u68c0\u67e5/i, /\u6211\u5c06\u67e5\u770b/i,
    // "让我更广泛地搜索" / "搜索不够深入" type patterns
    /\u8ba9\u6211\u66f4/i, /\u8ba9\u6211\u5c1d\u8bd5/i, /\u8ba9\u6211\u641c\u7d22/i,
    /\u8ba9\u6211\u6df1\u5165/i, /\u8ba9\u6211\u5e7f\u6cdb/i, /\u8ba9\u6211\u76f4\u63a5/i,
    /\u641c\u7d22\u4e0d\u591f/i, /\u4e0d\u591f\u6df1\u5165/i, /\u9700\u8981\u66f4\u5e7f/i,
    /\u66f4\u5e7f\u6cdb\u5730/i, /\u91cd\u65b0\u641c\u7d22/i, /\u6df1\u5165\u67e5\u770b/i,
    /let me.*check/i, /let me.*inspect/i, /let me.*look/i, /let me.*read/i,
    /let me.*search/i, /let me.*try/i, /let me.*broader/i, /let me.*deeper/i,
    /i will.*check/i, /i will.*inspect/i, /i need to.*check/i, /next.*i will/i,
    /need.*deeper/i, /not.*enough/i, /try.*different/i, /search.*more/i, /look.*further/i
  ];
  // Always nudge when model expresses intent — don't gate on prompt keywords
  if (continuationPatterns.some((p) => p.test(normalized))) {
    return true;
  }

  const pendingActionPatterns = [
    /\u6b63\u5728\u6267\u884c\u5de5\u5177/i, /\u6b63\u5728\u8c03\u7528\u5de5\u5177/i,
    /\u51c6\u5907\u6267\u884c/i, /\u5373\u5c06\u6267\u884c/i,
    /running tool/i, /executing/i
  ];
  if (!hasToolResults && pendingActionPatterns.some((p) => p.test(normalized))) {
    return unfinishedRequiredReads || promptAllowsAutonomousContinuation(prompt);
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
  return /VGO\s*AI|账户信息|账单|渠道|网站运营|平台功能限制|我可以为您提供以下方面的帮助/i.test(
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
  const detectedSkills = skillRegistry.detectRelevantSkills(prompt);
  const activeSkills = resolveSkillRequiredInspectionPaths(detectedSkills, workspace);
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
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let contextWindow = 0;

  const emitRealEvent = (event) => {
    if (typeof onEvent === "function") onEvent(event);
  };

  const finalPrompt = [prompt, skillPreflightNudge, skillWorkflowNudge].filter(Boolean).join("\n\n");

  const buildMessages = (hist, sysPr, pr) => {
    const msgs = buildMessageHistory(hist, sysPr, pr, attachments);
    return msgs;
  };

  let currentModel = initialModel;
  let upstreamRetryUsed = false;
  let upstreamFallbackModelUsed = false;
  let upstreamRateLimitRetryUsed = 0;

  const sendRequest = async (messages) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      let payload;

      try {
        ({ response, payload: payload } = await (async (targetModel) => {
          for (let netAttempt = 0; netAttempt < DEFAULT_REMOTE_NETWORK_RETRIES; netAttempt++) {
            try {
              return await sendRealVgoRequest({ token, model: targetModel, activeHistory: messages, signal });
            } catch (error) {
              if (signal?.aborted || error?.name === "AbortError") throw error;
              if (!isNetworkFetchFailure(error) || netAttempt >= DEFAULT_REMOTE_NETWORK_RETRIES - 1) throw error;
              emitRealEvent({ type: "task_status", status: "retrying", message: "网络波动，正在自动重试..." });
              await wait(computeRetryDelayMs(netAttempt + 1));
            }
          }
        })(currentModel));
      } catch (error) {
        throw error;
      }
      payload = payload;

      let messageText = formatRemoteServiceError(settings, response, payload);

      if (isRateLimitUpstreamFailure(response, payload) && upstreamRateLimitRetryUsed < MAX_UPSTREAM_RATE_LIMIT_RETRIES) {
        upstreamRateLimitRetryUsed += 1;
        emitRealEvent({ type: "task_status", status: "retrying", message: `上游模型限流，${Math.round(computeRateLimitRetryDelayMs(upstreamRateLimitRetryUsed) / 1000)}秒后自动重试...` });
        await wait(computeRateLimitRetryDelayMs(upstreamRateLimitRetryUsed));
        continue;
      }

      if (isRetryableUpstreamFailure(response, payload) && !upstreamRetryUsed) {
        upstreamRetryUsed = true;
        emitRealEvent({ type: "task_status", status: "retrying", message: "上游通道连接失败，正在自动重试..." });
        await wait(1200);
        continue;
      }

      if (isRetryableUpstreamFailure(response, payload) && !upstreamFallbackModelUsed) {
        upstreamFallbackModelUsed = true;
        const fallbackCandidates = buildFallbackModelCandidates(settings, currentModel);
        for (const candidateModel of fallbackCandidates) {
          emitRealEvent({ type: "task_status", status: "fallback_model", message: `正在切换备用模型：${candidateModel}` });
          currentModel = candidateModel;
          try {
            ({ response, payload } = await sendRealVgoRequest({ token, model: currentModel, activeHistory: messages, signal }));
          } catch (e) { continue; }
          messageText = formatRemoteServiceError(settings, response, payload);
          if (!isRetryableUpstreamFailure(response, payload)) break;
        }
        if (!isRetryableUpstreamFailure(response, payload)) break;
      }

      usage = extractUsage(payload);
      contextWindow = extractContextWindow(payload);

      if (!response.ok) {
        throw new Error(messageText || `HTTP ${response.status}`);
      }

      const rawText = extractAssistantRawText(payload);
      const cleanText = modelAdapters.stripCustomerServiceBoilerplate(protocol.sanitizeAssistantText(rawText), prompt);
      const toolCalls = extractToolCalls(rawText);

      return { text: cleanText, toolCalls, raw: payload };
    }

    throw new Error("remote_request_failed");
  };

  let loopResult;
  try {
    loopResult = await runAgentLoop({
      sendRequest,
      prompt: finalPrompt,
      sessionId,
      workspace,
      history,
      settings,
      signal,
      emitEvent: emitRealEvent,
      logRuntime: (ev, data) => logRuntime(ev, { channel: "real-remote", ...data }),
      buildMessages,
      systemPrompt,
      usedModel: currentModel,
      channelId: "real-remote-agent",
      requestToolPermission
    });
  } catch (err) {
    emitRealEvent({ type: "task_status", status: "failed", message: "Agent 循环异常: " + err.message });
    return { ok: false, exitCode: 1, sessionId, text: "Agent 循环异常: " + err.message, error: "agent_loop_error: " + err.message, rawEvents: [], usedModel: currentModel, actualChannel: "real-remote-agent", actualContextWindow: contextWindow, usageInputTokens: usage.inputTokens, usageOutputTokens: usage.outputTokens, usageTotalTokens: usage.totalTokens };
  }

  return {
    ok: loopResult.ok,
    exitCode: loopResult.exitCode,
    sessionId,
    text: loopResult.text,
    error: loopResult.error || "",
    rawEvents: loopResult.rawEvents,
    usedModel: currentModel,
    actualChannel: loopResult.actualChannel,
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
  const detectedSkills = skillRegistry.detectRelevantSkills(prompt);
  const activeSkills = resolveSkillRequiredInspectionPaths(detectedSkills, workspace);
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
    const authorizationHeader = resolveAuthorizationHeaderValue(remote, endpointPlan.requestUrl);

    // Build messages in OpenAI/Ollama format for the initial request
    const buildMsgs = (hist, sysPr, pr) => {
      if (endpointPlan.mode === "openai" || endpointPlan.mode === "ollama") {
        return [
          { role: "system", content: sysPr },
          ...normalizeHistoryMessages(hist),
          { role: "user", content: pr }
        ];
      }
      // Generic/VGO format — wrap as user message
      return [{ role: "user", content: pr }];
    };

    // sendRequest: one HTTP call, returns { text, toolCalls }
    const sendRequest = async (messages) => {
      const body = (endpointPlan.mode === "openai" || endpointPlan.mode === "ollama")
        ? JSON.stringify({ model: normalizedModelId, messages, stream: false })
        : JSON.stringify({ model: normalizedModelId, systemPrompt, workspace, sessionId, prompt: finalPrompt, history });

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
            body
          });
          clearTimeout(timer);
          break;
        } catch (error) {
          clearTimeout(timer);
          lastError = error;
          if (!isNetworkFetchFailure(error) || attempt >= DEFAULT_REMOTE_NETWORK_RETRIES) throw error;
          await wait(computeRetryDelayMs(attempt));
        }
      }
      if (!response) throw lastError || new Error("remote_local_prompt_failed");

      const payload = await parseJsonResponse(response);
      const text =
        extractOpenAiMessageText(payload) ||
        payload?.message?.content ||
        payload?.output ||
        payload?.text ||
        payload?.message ||
        payload?.rawText ||
        (response.ok ? "" : "Custom HTTP Provider request failed.");

      const rawText = extractAssistantRawText(payload) || text;
      const toolCalls = extractToolCalls(rawText);
      const cleanText = protocol.sanitizeAssistantText(rawText);
      // Extract think content for intent detection (shouldContinueAutonomously needs it)
      // but don't show it to the user
      const thinkMatch = rawText.match(/<think>([\s\S]*?)<\/think>/i);
      const thinkContent = thinkMatch ? thinkMatch[1].trim() : "";
      return {
        text: cleanText,           // display text — think stripped
        intentText: cleanText || thinkContent,  // for continuation detection
        rawForHistory: rawText,    // full raw text for message history (keeps think for context)
        toolCalls,
        raw: payload
      };
    };

    // Run the unified agent loop
    const loopResult = await runAgentLoop({
      sendRequest,
      prompt: finalPrompt,
      sessionId,
      workspace,
      history,
      settings,
      emitEvent: (ev) => emitEvent(onEvent, [], ev),
      logRuntime: (event, data) => logRuntime(event, { channel: "custom-http", ...data }),
      buildMessages: buildMsgs,
      systemPrompt,
      usedModel: normalizedModelId,
      channelId: endpointPlan.mode === "openai" ? "custom-openai-agent" : endpointPlan.mode === "ollama" ? "custom-ollama-agent" : "local-agent"
    });

    return {
      ok: loopResult.ok,
      exitCode: loopResult.exitCode,
      sessionId,
      text: loopResult.text,
      error: loopResult.error || "",
      rawEvents: loopResult.rawEvents,
      usedModel: normalizedModelId,
      actualChannel: loopResult.actualChannel
    };
} catch (error) {
    return {
      ok: false,
      exitCode: 1,
      sessionId,
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
          title: "鏈湴娴嬭瘯寮曟搸鍦ㄧ嚎",
          details: payload.message || payload.status || `已成功连接到 ${baseUrl}`
        }
      : {
          ok: false,
          title: "鏈湴娴嬭瘯寮曟搸寮傚父",
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
