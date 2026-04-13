const fs = require("node:fs");
const path = require("node:path");
const { executeToolCall } = require("./toolRuntime");
const protocol = require("./agentProtocol");
const modelAdapters = require("./modelAdapterRegistry");
const familyTools = require("./modelFamilyToolAdapters");
const skillRegistry = require("./skillRegistry");

const MAX_AGENT_STEPS = 30;
const UPSTREAM_RETRYABLE_PATTERN = /Failed to connect to upstream channel/i;
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
      "?? VGO Code ??????? Agent?",
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

function buildMessageHistory(history, systemPrompt, currentPrompt = "", attachments = []) {
  const trimmedHistory = (history || [])
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .map((item) => ({
      role: item.role,
      content: String(item.text || "").trim()
    }))
    .filter((item) => item.content)
    .slice(-20);

  const attachmentSummary = attachments.length
    ? `\n\n[Attachments]\n${attachments.map((item, index) => `${index + 1}. ${item.name} | ${item.path}`).join("\n")}`
    : "";

  const messages = [
    {
      role: "system",
      content: systemPrompt
    },
    ...trimmedHistory
  ];

  const normalizedPrompt = String(currentPrompt || "").trim();
  const hasUserMessage = messages.some((item) => item.role === "user" && String(item.content || "").trim());
  if (!hasUserMessage && normalizedPrompt) {
    messages.push({
      role: "user",
      content: normalizedPrompt + attachmentSummary
    });
  }

  return messages;
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
  const response = await fetch("https://vgoai.cn/api/v1/chat/send", {
    method: "POST",
    signal,
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
    return true;
  }

  if (finalPatterns.some((pattern) => pattern.test(normalized))) {
    if (unfinishedRequiredReads) {
      return true;
    }
    return false;
  }

  if (protocol.looksLikeContinuationIntent(normalized)) {
    return true;
  }

  if (unfinishedRequiredReads) {
    return true;
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

  for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
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

    let { response, payload: nextPayload } = await sendRealVgoRequest({
      token,
      model: usedModel,
      activeHistory,
      signal
    });
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
      ({ response, payload } = await sendRealVgoRequest({
        token,
        model: usedModel,
        activeHistory,
        signal
      }));
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
        ({ response, payload } = await sendRealVgoRequest({
          token,
          model: usedModel,
          activeHistory,
          signal
        }));
        messageText = formatRemoteServiceError(settings, response, payload);
      }
    }

    const fallbackModel = getCatalogModels(settings).find((item) => item.id !== usedModel)?.id;
    if (!response.ok && fallbackModel && /No available channel for this model/i.test(messageText)) {
      usedModel = fallbackModel;
      ({ response, payload } = await sendRealVgoRequest({
        token,
        model: usedModel,
        activeHistory,
        signal
      }));
      messageText = formatRemoteServiceError(settings, response, payload);
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

      if (hadToolResults && !latestText && !finalAnswerNudgeSent) {
        finalAnswerNudgeSent = true;
        activeHistory.push({ role: "assistant", content: rawText });
        activeHistory.push({ role: "user", content: toolNudges.finalAnswerNudge });
        continue;
      }

      if (shouldContinueAutonomously(latestText, rawEvents, prompt, workspace)) {
        const unfinishedReadPaths = getUnfinishedRequiredReadPaths(prompt, rawEvents, workspace);
        const nextRequiredPath = unfinishedReadPaths[0] || "";
        logRuntime("model:auto_continue", {
          step,
          textPreview: latestText.slice(0, 200),
          unfinishedRequiredReads: unfinishedReadPaths.length > 0,
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
      content: rawText
    });
    activeHistory.push({
      role: "user",
      content: protocol.buildToolResultMessage(results)
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
    text: latestText || "Agent reached the maximum tool-call steps without producing a final answer.",
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

async function runLocalPrompt({ workspace, sessionId, prompt, settings, history, sessionMeta, attachments = [] }) {
  const remote = settings?.remote || {};
  const baseUrl = (remote.baseUrl || "").trim().replace(/\/+$/, "");
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
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(remote.apiKey ? { Authorization: `Bearer ${remote.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: remote.model,
        systemPrompt: buildSafeSystemPrompt(settings, sessionMeta, activeSkills),
        workspace,
        sessionId,
        prompt: [prompt, skillPreflightNudge, skillWorkflowNudge, attachmentSummary].filter(Boolean).join("\n\n"),
        history
      })
    });

    const payload = await parseJsonResponse(response);
    const text =
      payload.output ||
      payload.text ||
      payload.message ||
      payload.rawText ||
      (response.ok ? "本地测试引擎已响应，但没有返回文本。" : "本地测试引擎调用失败。");

    return {
      ok: response.ok,
      exitCode: response.ok ? 0 : 1,
      sessionId,
      text,
      error: response.ok ? "" : payload.error || `http_${response.status}`,
      rawEvents: payload.events || [],
      usedModel: payload.model || remote.model,
      actualChannel: payload.channel || "local-mock",
      actualContextWindow: toNumber(payload?.contextWindow),
      usageInputTokens: toNumber(payload?.usage?.inputTokens),
      usageOutputTokens: toNumber(payload?.usage?.outputTokens),
      usageTotalTokens: toNumber(payload?.usage?.totalTokens)
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      sessionId,
      text: `无法连接远程引擎：${error.message}`,
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

  if (isRealVgoLogin(args.settings)) {
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
  if (isRealVgoLogin(settings)) {
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
  if (!baseUrl) {
    return {
      ok: false,
      title: "未配置接口",
      details: "请先在设置面板中填写远程接口地址。"
    };
  }

  try {
    const response = await fetch(`${baseUrl}/health`, {
      headers: {
        ...(remote.apiKey ? { Authorization: `Bearer ${remote.apiKey}` } : {})
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
          details: payload.error || payload.message || `HTTP ${response.status}`
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
