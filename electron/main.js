const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { BrowserWindow, app, dialog, ipcMain, shell, session, Tray, Menu, nativeImage } = require("electron");
const { createStore } = require("./core/state");
const {
  compressSessionContext,
  estimateSessionTokens,
  resolveCompressionThresholdRatio,
  resolveModelContextWindow
} = require("./core/contextCompression");
const { getEngine, listEngines } = require("./core/engineRegistry");
const { isVgoManagedCloudProfile, loadSettings, saveSettings, syncRemoteProfileState, DEFAULT_PROFILE_ID, buildGuestModelCatalog } = require("./core/settings");
const { startMockServer } = require("./core/vgoMockServer");
const { normalizeEngineLogFile } = require("./core/engineLog");
const { listInstalledSkills } = require("./core/localSkillDiscovery");

const store = createStore();
let settings = loadSettings();
let pendingAuthServer = null;
let authWindow = null;
let authCheckInFlight = false;
const pendingPermissionRequests = new Map();
const activePromptControllers = new Map();
const userAbortedSessions = new Set();
const PERMISSION_REQUEST_TTL = 300000;
const DEFAULT_MAX_TASK_RUNTIME_MINUTES = 240;
const MIN_TASK_RUNTIME_MINUTES = 30;
const MAX_TASK_RUNTIME_MINUTES = 720;
let browserAuthState = {
  status: "idle",
  message: "",
  loginUrl: "",
  redirectUri: ""
};
let mockServerInfo = {
  baseUrl: settings.remote.baseUrl,
  status: "starting"
};
let lastDetectedUpdate = null;
const AUTH_PARTITION = "persist:vgo-auth";
let tray = null;
const sessionEventCounters = new Map();
const MAIN_LOG_DIR = path.join(process.cwd(), "logs");
const MAIN_LOG_FILE = path.join(MAIN_LOG_DIR, "main-process.log");

try {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("in-process-gpu");
} catch {}

if (process.platform === "win32") {
  try {
    app.setAppUserModelId("com.vgo.code");
  } catch {}
}
try {
  app.setName("VGO CODE");
} catch {}
try {
  process.title = "VGO CODE";
} catch {}

process.on("unhandledRejection", (reason, promise) => {
  try {
    const message = reason instanceof Error ? reason.message : String(reason || "unknown");
    logMainEvent("unhandled_rejection", { message: message.slice(0, 2000) });
  } catch {}
});

process.on("uncaughtException", (error) => {
  try {
    const message = String(error?.message || error || "unknown");
    logMainEvent("uncaught_exception", { message: message.slice(0, 2000), stack: String(error?.stack || "").slice(0, 4000) });
  } catch {}
  // Clean up active controllers before exit
  for (const [, data] of activePromptControllers) {
    try { data.controller.abort(new Error("process_crash")); } catch {}
  }
  activePromptControllers.clear();
  pendingPermissionRequests.clear();
  userAbortedSessions.clear();
});

function logMainEvent(event, payload = {}) {
  try {
    fs.mkdirSync(MAIN_LOG_DIR, { recursive: true });
    fs.appendFileSync(
      MAIN_LOG_FILE,
      `${JSON.stringify({ ts: new Date().toISOString(), event, ...payload })}\n`,
      "utf8"
    );
  } catch {}
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

function resolveCustomProviderAuthHeader(apiKey = "", requestUrl = "") {
  const rawApiKey = String(apiKey || "").trim();
  if (!rawApiKey || rawApiKey === "********") {
    return "";
  }
  if (!isBigModelHost(requestUrl)) {
    return `Bearer ${rawApiKey}`;
  }
  return `Bearer ${looksLikeBigModelApiKey(rawApiKey) ? buildBigModelJwtFromApiKey(rawApiKey) : rawApiKey}`;
}

function normalizeExternalModelId(modelId = "") {
  const raw = String(modelId || "").trim();
  if (!raw) return raw;
  if (/^glm[-_.]/i.test(raw)) {
    return raw.replace(/_/g, "-").toLowerCase();
  }
  return raw;
}

function normalizeModelCatalogCandidates(baseUrl = "", modelListUrl = "") {
  const candidates = [];
  const append = (url) => {
    const cleaned = String(url || "").trim().replace(/\/+$/, "");
    if (!cleaned || candidates.includes(cleaned)) return;
    candidates.push(cleaned);
  };

  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  const normalizedModelListUrl = String(modelListUrl || "").trim().replace(/\/+$/, "");

  if (normalizedModelListUrl) {
    if (!/\/chat\/completions$/i.test(normalizedModelListUrl)) {
      append(normalizedModelListUrl);
    }
    if (/\/chat\/completions$/i.test(normalizedModelListUrl) || /\/v1\/chat\/completions$/i.test(normalizedModelListUrl)) {
      append(normalizedModelListUrl.replace(/\/chat\/completions$/i, "/models"));
    }
  }

  if (normalizedBaseUrl) {
    if (/\/chat\/completions$/i.test(normalizedBaseUrl)) {
      const parent = normalizedBaseUrl.replace(/\/chat\/completions$/i, "");
      append(`${parent}/models`);
      append(`${parent}/v1/models`);
    } else if (/\/v1$/i.test(normalizedBaseUrl)) {
      append(`${normalizedBaseUrl}/models`);
    } else {
      append(`${normalizedBaseUrl}/v1/models`);
      append(`${normalizedBaseUrl}/models`);
    }
  }

  return candidates;
}

function normalizeUrlForCompare(input = "") {
  return String(input || "").trim().replace(/\/+$/, "").toLowerCase();
}

function cleanupExpiredMapEntries() {
  const now = Date.now();
  for (const [key, data] of activePromptControllers) {
    if (data.completed) continue;
    const maxRuntimeMs = Number(data.maxRuntimeMs) > 0 ? Number(data.maxRuntimeMs) : DEFAULT_MAX_TASK_RUNTIME_MINUTES * 60000;
    const lastActive = data.lastTouchedAt || data.createdAt;
    if (now - lastActive > maxRuntimeMs) {
      data.controller.abort(new Error("task_runtime_limit_reached"));
      // Do NOT delete the entry here — let chat:send's finally block clean it up,
      // so completed flag and error message can be set correctly.
    }
  }
  for (const [key, data] of pendingPermissionRequests) {
    if (now - data.createdAt > PERMISSION_REQUEST_TTL) {
      pendingPermissionRequests.delete(key);
    }
  }
}

setInterval(cleanupExpiredMapEntries, 60000);
let mainWindow = null;

ipcMain.on("renderer:error", (_event, payload = {}) => {
  try {
    const source = String(payload?.source || "renderer");
    const message = String(payload?.message || "");
    logMainEvent("renderer_error", { source, message: message.slice(0, 8000) });
  } catch {}
});

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".css",
  ".html",
  ".xml",
  ".yml",
  ".yaml",
  ".py",
  ".java",
  ".cs",
  ".go",
  ".rs",
  ".sh",
  ".ps1",
  ".bat",
  ".env"
]);

function activeEngine() {
  return getEngine(store.getState().runtime.engineId);
}

function getWindowIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "build", "icon.ico")
    : path.join(app.getAppPath(), "build", "icon.ico");
}

function saveAllSettings(nextSettings) {
  settings = nextSettings;
  saveSettings(settings);
}

function isRealVgoLogin() {
  return Boolean(settings.vgoAI?.loggedIn && settings.vgoAI?.accessToken);
}

function serializeSettings() {
  return {
    permissions: {
      ...settings.permissions
    },
    access: {
      ...settings.access
    },
    appearance: {
      ...settings.appearance
    },
    localization: {
      ...settings.localization
    },
    behavior: {
      ...settings.behavior
    },
    agent: {
      ...settings.agent
    },
    skills: {
      ...settings.skills
    },
    remote: {
      ...settings.remote,
      apiKey: settings.remote.apiKey ? "********" : ""
    },
    remoteProfiles: (settings.remoteProfiles || []).map((profile) => ({
      ...profile,
      apiKey: profile.apiKey ? "********" : ""
    })),
    activeRemoteProfileId: settings.activeRemoteProfileId,
    vgoAI: {
      ...settings.vgoAI,
      accessToken: settings.vgoAI.accessToken ? "********" : "",
      hasAccessToken: Boolean(settings.vgoAI.accessToken)
    }
  };
}

function serializeState() {
  const state = store.serialize();
  state.engines = listEngines();
  state.settings = serializeSettings();
  state.mockServer = mockServerInfo;
  state.skills = listInstalledSkills(settings);
  const activeSession = store.getActiveSession();
  const preferredModel =
    activeSession?.actualModel || settings.vgoAI?.preferredModel || settings.remote?.model;
  const contextWindow =
    activeSession?.actualContextWindow || resolveModelContextWindow(settings, preferredModel);
  const estimatedTokens = activeSession?.usageTotalTokens || (activeSession ? estimateSessionTokens(activeSession) : 0);
  const thresholdRatio = resolveCompressionThresholdRatio(settings);
  const thresholdTokens = Math.floor(contextWindow * thresholdRatio);
  const usagePercent =
    thresholdTokens > 0 ? Math.min(100, Math.round((estimatedTokens / thresholdTokens) * 100)) : 0;
  state.contextStats = {
    estimatedTokens,
    thresholdTokens,
    contextWindow,
    usageSource: activeSession?.usageTotalTokens ? "provider" : "estimated",
    thresholdRatio,
    usagePercent,
    remainingTokens: Math.max(0, thresholdTokens - estimatedTokens),
    compressionCount: Number(activeSession?.compressionCount) || 0,
    lastCompressionAt: activeSession?.lastCompressionAt || ""
  };
  return state;
}

function maybeCompressActiveSession() {
  const activeSession = store.getActiveSession();
  if (!activeSession) {
    return null;
  }

  if (settings.agent?.autoSummarizeContext === false) {
    const modelId =
      activeSession.actualModel || settings.vgoAI?.preferredModel || settings.remote?.model || "";
    const contextWindow =
      activeSession.actualContextWindow || resolveModelContextWindow(settings, modelId);
    const thresholdRatio = resolveCompressionThresholdRatio(settings);
    const estimatedBefore = estimateSessionTokens(activeSession);
    const thresholdTokens = Math.floor(contextWindow * thresholdRatio);
    return {
      compressed: false,
      estimatedBefore,
      estimatedAfter: estimatedBefore,
      thresholdTokens,
      contextWindow,
      thresholdRatio,
      usagePercent:
        thresholdTokens > 0 ? Math.min(100, Math.round((estimatedBefore / thresholdTokens) * 100)) : 0,
      remainingTokens: Math.max(0, thresholdTokens - estimatedBefore)
    };
  }

  const modelId =
    activeSession.actualModel || settings.vgoAI?.preferredModel || settings.remote?.model || "";
  const result = compressSessionContext(activeSession, {
    contextWindow:
      activeSession.actualContextWindow || resolveModelContextWindow(settings, modelId),
    thresholdRatio: resolveCompressionThresholdRatio(settings)
  });
  if (!result.compressed) {
    return result;
  }

  store.replaceSessionHistory(activeSession.id, result.history);
  store.updateSessionMeta(activeSession.id, {
    contextSummary: result.contextSummary,
    compressionCount: result.compressionCount,
    lastCompressionAt: result.lastCompressionAt
  });

  return result;
}

function resolveEngineIdForProfile(profile = {}) {
  const baseUrl = String(profile.baseUrl || "").toLowerCase();

  if (/localhost:11434|127\.0\.0\.1:11434/.test(baseUrl)) return "ollama";

  const provider = String(profile.provider || "").toLowerCase();
  if (provider.includes("ollama")) return "ollama";

  return "vgo-remote";
}

function setRuntimeEngine(engineId) {
  const nextEngine = getEngine(engineId);
  store.setRuntime({
    engineId: nextEngine.engineId,
    engineLabel: nextEngine.engineLabel,
    providerLabel: nextEngine.providerLabel
  });
}

function isPathWithinWorkspace(filePath, workspace) {
  try {
    const resolved = path.resolve(filePath);
    const workspaceResolved = path.resolve(workspace);
    return resolved.startsWith(workspaceResolved + path.sep) || resolved === workspaceResolved;
  } catch {
    return false;
  }
}

function extractAbsolutePathsFromPrompt(prompt = "", workspace = "") {
  const text = String(prompt || "");
  const matches =
    text.match(/[A-Za-z]:\\[^\s"'""''<>|?*\r\n]+(?:\\[^\s"'""''<>|?*\r\n]+)*/g) || [];

  const validPaths = [...new Set(matches.map((item) => String(item || "").trim()).filter(Boolean))];
  
  if (!workspace) {
    return validPaths;
  }
  
  return validPaths.filter(filePath => isPathWithinWorkspace(filePath, workspace));
}

function commonDirectory(paths = []) {
  if (!paths.length) {
    return "";
  }

  const splitPaths = paths.map((item) => path.resolve(item).split(path.sep));
  const first = splitPaths[0];
  const shared = [];

  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index];
    if (splitPaths.every((parts) => parts[index] === segment)) {
      shared.push(segment);
      continue;
    }
    break;
  }

  if (!shared.length) {
    return "";
  }

  return shared.join(path.sep) || "";
}

function deriveTaskWorkspace(prompt = "", currentWorkspace = "", sessionDirectory = "") {
  const preferredRoots = [sessionDirectory, currentWorkspace]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => fs.existsSync(item));

  const workspace = currentWorkspace || sessionDirectory || "";
  const absolutePaths = extractAbsolutePathsFromPrompt(prompt, workspace)
    .map((item) => path.resolve(item))
    .filter((item) => fs.existsSync(item));

  const anchors = absolutePaths.map((item) => {
    try {
      return fs.statSync(item).isDirectory() ? item : path.dirname(item);
    } catch {
      return "";
    }
  }).filter(Boolean);

  if (anchors.length === 1) {
    return anchors[0];
  }

  if (anchors.length > 1) {
    const shared = commonDirectory(anchors);
    if (shared && fs.existsSync(shared)) {
      return shared;
    }
  }

  if (preferredRoots.length) {
    return path.resolve(preferredRoots[0]);
  }

  return path.resolve(currentWorkspace || process.cwd());
}

function applyRuntimeForProfile(profile = {}) {
  setRuntimeEngine(resolveEngineIdForProfile(profile));
}

function sendAgentEvent(payload = {}) {
  const sessionId = String(payload?.sessionId || "global");
  const previousSeq = Number(sessionEventCounters.get(sessionId) || 0);
  const requestedSeq = Number(payload?.eventSeq || 0);
  const nextSeq = requestedSeq > 0 ? Math.max(previousSeq, requestedSeq) : previousSeq + 1;
  sessionEventCounters.set(sessionId, nextSeq);

  const eventType = String(payload?.type || payload?.event || "unknown");
  const eventAt = Number(payload?.eventAt) > 0 ? Number(payload.eventAt) : Date.now();
  const eventId =
    String(payload?.eventId || "").trim() || `${sessionId}:${nextSeq}:${eventType}:${eventAt}`;
  const normalizedPayload = {
    ...payload,
    sessionId,
    eventSeq: nextSeq,
    eventAt,
    eventId
  };

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("agent:event", normalizedPayload);
    }
  }
}

function sendAuthStateUpdate() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("auth:stateUpdate", browserAuthState);
    }
  }
}

function sendStateRefresh() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("app:stateRefresh", serializeState());
    }
  }
}

function touchActivePromptController(sessionId) {
  const key = String(sessionId || "").trim();
  if (!key) {
    return;
  }
  const entry = activePromptControllers.get(key);
  if (!entry) {
    return;
  }
  entry.lastTouchedAt = Date.now();
}

function sendUpdateEvent(channel, payload = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(channel, payload);
}

function createTrayIcon() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "build", "icon.png")
    : path.join(app.getAppPath(), "build", "icon.png");
  
  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    trayIcon = nativeImage.createEmpty();
  }
  
  tray = new Tray(trayIcon);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "打开 VGO CODE",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip("VGO CODE");
  tray.setContextMenu(contextMenu);
  
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 1020,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#08111d",
    title: "VGO CODE",
    icon: getWindowIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  
  mainWindow = win;
  
  win.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
      return false;
    }
  });

  const distWebPath = path.join(app.getAppPath(), "dist-web", "index.html");
  if (fs.existsSync(distWebPath)) {
    win.loadFile(distWebPath);
  } else {
    logMainEvent("renderer_missing_dist_web", { distWebPath });
    win.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          "<!doctype html><html><head><meta charset='utf-8'><title>VGO CODE</title></head>" +
            "<body style='font-family:Segoe UI,Arial,sans-serif;padding:24px;background:#0b1220;color:#f5f7fb;'>" +
            "<h2>Renderer bundle is missing</h2>" +
            "<p>Cannot find dist-web/index.html. Please run <code>npm run build:web</code> and restart.</p>" +
            "</body></html>"
        )
    );
  }

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logMainEvent("renderer_did_fail_load", {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    });
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    logMainEvent("renderer_process_gone", {
      reason: details?.reason || "",
      exitCode: details?.exitCode || 0
    });
    pendingPermissionRequests.clear();
    activePromptControllers.clear();
    userAbortedSessions.clear();
  });

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level <= 1) {
      logMainEvent("renderer_console_error", {
        level,
        message: String(message || "").slice(0, 4000),
        line,
        sourceId: String(sourceId || "")
      });
    }
  });

  return win;
}

function createAuthWindow(loginUrl) {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.focus();
    return authWindow;
  }

  authWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 860,
    minHeight: 640,
    title: "登录 VGO AI",
    modal: false,
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    webPreferences: {
      partition: AUTH_PARTITION + "-" + Date.now(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  authWindow.on("closed", () => {
    const wasSuccess = browserAuthState.status === "success";
    authWindow = null;
    if (!wasSuccess && (browserAuthState.status === "waiting" || browserAuthState.status === "starting")) {
      setBrowserAuthState({
        status: "idle",
        message: "登录窗口已关闭。"
      });
    }
  });

  authWindow.loadURL(loginUrl);
  return authWindow;
}

function createRemoteProfileState(payload = {}, { activate = true } = {}) {
  const profileId = `profile-${Date.now()}`;
  const normalizedProvider = (payload.provider || "").trim() || "VGO Remote";
  const incomingApiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
  const currentApiKey = String(settings.remote.apiKey || "").trim();
  const resolvedApiKey =
    incomingApiKey === "********"
      ? (currentApiKey === "********" ? "" : currentApiKey)
      : incomingApiKey;
  const profile = {
    id: profileId,
    name: (payload.name || "").trim() || `远程配置 ${(settings.remoteProfiles || []).length + 1}`,
    provider: normalizedProvider,
    baseUrl: payload.baseUrl || settings.remote.baseUrl,
    modelListUrl: payload.modelListUrl || "",
    modelCatalog: Array.isArray(payload.modelCatalog) ? payload.modelCatalog : [],
    model: normalizeExternalModelId(payload.model || settings.remote.model),
    apiKey: resolvedApiKey,
    systemPrompt: payload.systemPrompt || settings.remote.systemPrompt
  };

  saveAllSettings({
    ...settings,
    remote: activate
      ? {
          provider: profile.provider || "VGO Remote",
          baseUrl: profile.baseUrl,
          modelListUrl: profile.modelListUrl || "",
          model: profile.model,
          apiKey: profile.apiKey,
          systemPrompt: profile.systemPrompt
        }
      : settings.remote,
    remoteProfiles: [...(settings.remoteProfiles || []), profile],
    activeRemoteProfileId: activate ? profileId : settings.activeRemoteProfileId
  });

  if (activate) {
    applyRuntimeForProfile(profile);
  }

  return serializeState();
}

function selectRemoteProfileState(profileId) {
  const profile = (settings.remoteProfiles || []).find((item) => item.id === profileId);
  if (!profile) {
    return serializeState();
  }
  saveAllSettings({
    ...settings,
    activeRemoteProfileId: profileId,
    remote: {
      provider: profile.provider || "VGO Remote",
      baseUrl: profile.baseUrl,
      modelListUrl: profile.modelListUrl || "",
      model: profile.model,
      apiKey: profile.apiKey,
      systemPrompt: profile.systemPrompt
    }
  });
  applyRuntimeForProfile(profile);
  return serializeState();
}

function updateRemoteProfileState(profileId, payload = {}, { activate = false } = {}) {
  const profile = (settings.remoteProfiles || []).find((item) => item.id === profileId);
  if (!profile) {
    return serializeState();
  }

  const incomingApiKey = typeof payload.apiKey === "string" ? payload.apiKey : null;
  const nextApiKey =
    incomingApiKey === null
      ? profile.apiKey
      : incomingApiKey.trim() === "********"
        ? profile.apiKey
        : incomingApiKey;
  const nextProvider = (payload.provider || "").trim() || profile.provider || "VGO Remote";
  const baseUrlFromPayload = payload.baseUrl || profile.baseUrl;
  const modelListUrlFromPayload =
    typeof payload.modelListUrl === "string"
      ? payload.modelListUrl
      : profile.modelListUrl || "";
  const endpointChanged =
    String(profile.provider || "") !== String(nextProvider || "") ||
    normalizeUrlForCompare(profile.baseUrl) !== normalizeUrlForCompare(baseUrlFromPayload) ||
    normalizeUrlForCompare(profile.modelListUrl) !== normalizeUrlForCompare(modelListUrlFromPayload);

  const nextProfile = {
    ...profile,
    name: (payload.name || "").trim() || profile.name,
    provider: nextProvider,
    baseUrl: baseUrlFromPayload,
    modelListUrl: modelListUrlFromPayload,
    modelCatalog:
      Array.isArray(payload.modelCatalog)
        ? payload.modelCatalog
        : endpointChanged
          ? []
          : profile.modelCatalog || [],
    model: normalizeExternalModelId(payload.model || profile.model),
    apiKey: nextApiKey,
    systemPrompt:
      typeof payload.systemPrompt === "string"
        ? payload.systemPrompt
        : profile.systemPrompt
  };

  const nextProfiles = (settings.remoteProfiles || []).map((item) =>
    item.id === profileId ? nextProfile : item
  );

  const shouldActivate = activate || settings.activeRemoteProfileId === profileId;
  saveAllSettings({
    ...settings,
    remoteProfiles: nextProfiles,
    remote: shouldActivate
      ? {
          provider: nextProfile.provider || "VGO Remote",
          baseUrl: nextProfile.baseUrl,
          modelListUrl: nextProfile.modelListUrl || "",
          model: nextProfile.model,
          apiKey: nextProfile.apiKey,
          systemPrompt: nextProfile.systemPrompt
        }
      : settings.remote
  });

  if (shouldActivate) {
    applyRuntimeForProfile(nextProfile);
  }

  return serializeState();
}

function deleteRemoteProfileState(profileId) {
  const profiles = (settings.remoteProfiles || []).filter((item) => item.id !== profileId);
  const nextProfiles = profiles.length
    ? profiles
    : [
        {
          id: "default",
          name: "默认 VGO AI",
          provider: "VGO Remote",
          baseUrl: settings.remote.baseUrl,
          modelListUrl: settings.remote.modelListUrl || "",
          modelCatalog: [],
          model: settings.remote.model,
          apiKey: settings.remote.apiKey,
          systemPrompt: settings.remote.systemPrompt
        }
      ];
  const activeProfile =
    nextProfiles.find((item) => item.id === settings.activeRemoteProfileId) || nextProfiles[0];

  saveAllSettings({
    ...settings,
    remoteProfiles: nextProfiles,
    activeRemoteProfileId: activeProfile.id,
    remote: {
      provider: activeProfile.provider || "VGO Remote",
      baseUrl: activeProfile.baseUrl,
      modelListUrl: activeProfile.modelListUrl || "",
      model: activeProfile.model,
      apiKey: activeProfile.apiKey,
      systemPrompt: activeProfile.systemPrompt
    }
  });
  applyRuntimeForProfile(activeProfile);
  return serializeState();
}

function resolveProfileName(profile, fallbackEmail) {
  return (
    profile?.displayName ||
    profile?.nickname ||
    profile?.name ||
    profile?.username ||
    profile?.email ||
    fallbackEmail ||
    "VGO AI Developer"
  );
}

async function fetchJson(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
    }
    if (!response.ok) {
      const message =
        payload?.message ||
        payload?.error ||
        payload?.msg ||
        payload?.detail ||
        payload?.data?.message ||
        payload?.data?.error ||
        `http_${response.status}`;
      const normalizedMessage = typeof message === "string" ? message : JSON.stringify(message);
      throw new Error(`${normalizedMessage} (status ${response.status})`);
    }
    return payload;
  } catch (error) {
    logMainEvent("fetch_json_error", {
      url: String(url || ""),
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function extractAccessToken(loginPayload = {}) {
  return (
    loginPayload.accessToken ||
    loginPayload.access_token ||
    loginPayload.token ||
    loginPayload.jwt ||
    loginPayload?.data?.accessToken ||
    loginPayload?.data?.access_token ||
    loginPayload?.data?.token ||
    loginPayload?.data?.jwt ||
    loginPayload?.result?.accessToken ||
    loginPayload?.result?.token ||
    ""
  );
}

async function requestRealVgoAiLogin(email, password) {
  const endpoints = [
    "https://vgoai.cn/api/v1/auth/login",
    "https://vgoai.cn/api/auth/login",
    "https://vgoai.cn/auth/login"
  ];
  const payloadVariants = [
    { email, password },
    { account: email, password },
    { username: email, password },
    { login: email, password },
    { identifier: email, password }
  ];

  let lastError = null;
  for (const endpoint of endpoints) {
    for (const payload of payloadVariants) {
      try {
        return await fetchJson(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json, text/plain, */*"
          },
          body: JSON.stringify(payload)
        });
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError || new Error("login_request_failed");
}

async function fetchVgoAiProfile(accessToken) {
  const payload = await fetchJson("https://vgoai.cn/api/v1/user/profile", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  return payload.user || payload.data || payload.profile || payload;
}

async function fetchRealVgoModels(accessToken) {
  const payload = await fetchJson("https://vgoai.cn/api/v1/chat/models", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const items = payload?.data || payload?.items || payload?.models || [];
      return Array.isArray(items)
    ? items
        .filter((m) => !/^nvidia\//i.test(m.id))
        .map((item) => ({
          id: item.id,
          label: item.name || item.label || item.id,
          description: item.description || "",
          contextWindow: Number(
            item.contextWindow ||
              item.contextTokens ||
              item.maxContextTokens ||
              item.max_input_tokens ||
              item.maxTokens ||
              0
          )
        }))
    : [];
}

function mapGenericModelCatalog(payload = {}) {
  const items = payload?.items || payload?.data || payload?.models || [];
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => ({
      id: String(item?.id || "").trim(),
      label: String(item?.name || item?.label || item?.id || "").trim(),
      description: String(item?.description || ""),
      contextWindow: Number(
        item?.contextWindow ||
          item?.contextTokens ||
          item?.maxContextTokens ||
          item?.max_input_tokens ||
          item?.maxTokens ||
          0
      )
    }))
    .filter((item) => item.id && !/^nvidia\//i.test(item.id))
    .map((item) => ({
      ...item,
      label: item.label || item.id
    }));
}

async function fetchRemoteProfileModelCatalog(profile = {}) {
  if (!profile || profile.provider === "Ollama") {
    return [];
  }

  const baseUrl = String(profile.baseUrl || "").trim().replace(/\/+$/, "");
  const modelListUrl = String(profile.modelListUrl || "").trim();
  const apiKey = String(profile.apiKey || "").trim();

  if (!baseUrl && !modelListUrl) {
    return [];
  }

  const candidates = normalizeModelCatalogCandidates(baseUrl, modelListUrl);

  let lastError = null;
  for (const url of candidates) {
    try {
      const headers = {};
      const authHeader = resolveCustomProviderAuthHeader(apiKey, url);
      if (authHeader) {
        headers.Authorization = authHeader;
      }
      const payload = await fetchJson(url, { headers });
      const models = mapGenericModelCatalog(payload);
      if (models.length) {
        return models;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }
  return [];
}

async function refreshRemoteProfileModelCatalogState(profileId, { activateModelIfMissing = true } = {}) {
  const profile = (settings.remoteProfiles || []).find((item) => item.id === profileId);
  if (!profile || profile.provider === "Ollama") {
    return serializeState();
  }

  const models = await fetchRemoteProfileModelCatalog(profile).catch(() => []);
  const resolvedModel =
    profile.model && models.some((item) => item.id === profile.model)
      ? profile.model
      : activateModelIfMissing && models.length
      ? models[0].id
      : profile.model;

  const nextProfiles = (settings.remoteProfiles || []).map((item) =>
    item.id === profileId
      ? {
          ...item,
          modelCatalog: models,
          model: resolvedModel
        }
      : item
  );

  const isActive = settings.activeRemoteProfileId === profileId;
  const activeProfile =
    nextProfiles.find((item) => item.id === settings.activeRemoteProfileId) || nextProfiles[0];

  saveAllSettings({
    ...settings,
    remoteProfiles: nextProfiles,
    remote: isActive
      ? {
          ...settings.remote,
          provider: activeProfile.provider || settings.remote.provider,
          baseUrl: activeProfile.baseUrl || settings.remote.baseUrl,
          modelListUrl: activeProfile.modelListUrl || settings.remote.modelListUrl || "",
          model: activeProfile.model || settings.remote.model,
          apiKey: activeProfile.apiKey,
          systemPrompt: activeProfile.systemPrompt
        }
      : settings.remote
  });

  return serializeState();
}

function setRuntimeToRemoteEngine() {
  setRuntimeEngine("vgo-remote");
}

function applyRealVgoAiSession({
  email = "",
  displayName,
  preferredModel,
  accessToken,
  profile = null,
  modelCatalog = [],
  rememberedPassword = settings.vgoAI.rememberedPassword,
  rememberPassword = settings.vgoAI.rememberPassword
}) {
  const activeProfile =
    (settings.remoteProfiles || []).find((item) => item.id === settings.activeRemoteProfileId) || null;
  const activeIsRemote = !activeProfile || resolveEngineIdForProfile(activeProfile) !== "ollama";
  let nextSettings = {
    ...settings,
    vgoAI: {
      ...settings.vgoAI,
      loggedIn: true,
      email,
      rememberedPassword: rememberPassword ? rememberedPassword || "" : "",
      rememberPassword,
      displayName,
      accessToken,
      preferredModel,
      linkedAt: new Date().toISOString(),
      profile,
      modelCatalog: modelCatalog.length ? modelCatalog : settings.vgoAI.modelCatalog
    }
  };

  if (activeIsRemote) {
    nextSettings = syncRemoteProfileState(nextSettings, { ...nextSettings.remote, model: preferredModel }, {}, nextSettings.vgoAI);
  }

  saveAllSettings(nextSettings);
  if (activeIsRemote) {
    setRuntimeToRemoteEngine();
  }
}

function savePreferredModelIfChanged(modelId) {
  if (!modelId) {
    return;
  }

  const activeProfile =
    (settings.remoteProfiles || []).find((item) => item.id === settings.activeRemoteProfileId) || null;
  const activeIsRemote = !activeProfile || resolveEngineIdForProfile(activeProfile) !== "ollama";
  if (!activeIsRemote) {
    return;
  }

  if (settings.vgoAI.preferredModel === modelId) {
    return;
  }

  if (activeIsRemote) {
    saveAllSettings(syncRemoteProfileState(settings, { ...settings.remote, model: modelId }));
  }
}

function clearRealVgoAiSession() {
  const guestCatalog = buildGuestModelCatalog();
  const clearedProfiles = (settings.remoteProfiles || []).map((profile) =>
    isVgoManagedCloudProfile(profile)
      ? {
          ...profile,
          modelCatalog: [],
          model: profile.id === DEFAULT_PROFILE_ID ? "vgo-coder-pro" : profile.model
        }
      : profile
  );
  const activeProfile =
    clearedProfiles.find((item) => item.id === settings.activeRemoteProfileId) || clearedProfiles[0] || null;
  const activeProfileIsRemote = activeProfile && resolveEngineIdForProfile(activeProfile) !== "ollama";

  saveAllSettings({
    ...settings,
    remoteProfiles: clearedProfiles,
    remote: activeProfileIsRemote
      ? {
          ...settings.remote,
          provider: activeProfile.provider || settings.remote.provider,
          baseUrl: activeProfile.baseUrl || settings.remote.baseUrl,
          modelListUrl: activeProfile.modelListUrl || settings.remote.modelListUrl || "",
          model: activeProfile.model || "vgo-coder-pro",
          apiKey: activeProfile.apiKey,
          systemPrompt: activeProfile.systemPrompt
        }
      : settings.remote,
    vgoAI: {
      ...settings.vgoAI,
      loggedIn: false,
      email: "",
      displayName: "Guest",
      accessToken: "",
      preferredModel: "vgo-coder-pro",
      linkedAt: "",
      profile: null,
      modelCatalog: guestCatalog
    }
  });
}

async function clearAuthBrowserSession() {
  const authSession = session.fromPartition(AUTH_PARTITION);
  try {
    await authSession.clearStorageData({
      storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"]
    });
  } catch {}
}

async function validateStoredRealLogin() {
  if (!settings.vgoAI?.loggedIn || !settings.vgoAI?.accessToken) {
    return;
  }

  if (String(settings.vgoAI.accessToken).startsWith("vgo-local-")) {
    clearRealVgoAiSession();
    return;
  }

  try {
    const profile = await fetchVgoAiProfile(settings.vgoAI.accessToken);
    saveAllSettings({
      ...settings,
      vgoAI: {
        ...settings.vgoAI,
        displayName: resolveProfileName(profile, settings.vgoAI.email),
        profile
      }
    });
  } catch (error) {
    clearRealVgoAiSession();
    setBrowserAuthState({
      status: "error",
      message: `登录态已失效（${error.message}），请重新登录。`
    });
    mainWindow?.webContents?.send("auth:stateUpdate", {
      status: "logged_out",
      reason: "token_invalid",
      message: "登录态已失效，请重新登录。"
    });
  }
}

async function loginRealVgoAi(payload = {}) {
  const email = (payload.email || "").trim();
  const password = payload.password || "";
  const preferredModel = payload.preferredModel || "vgo-coder-pro";

  if (!email || !password) {
    throw new Error("请输入网页登录账号对应的邮箱和密码。");
  }

  const loginPayload = await requestRealVgoAiLogin(email, password);

  const accessToken = extractAccessToken(loginPayload);
  if (!accessToken) {
    throw new Error("登录接口未返回有效 accessToken。");
  }

  const profile = loginPayload.user || (await fetchVgoAiProfile(accessToken));
  const modelCatalog = await fetchRealVgoModels(accessToken).catch(() => []);
  const displayName = resolveProfileName(profile, email);

  applyRealVgoAiSession({
    email,
    displayName,
    preferredModel,
    accessToken,
    profile: profile || null,
    modelCatalog,
    rememberedPassword: payload.password || settings.vgoAI.rememberedPassword,
    rememberPassword: payload.rememberPassword ?? settings.vgoAI.rememberPassword
  });

  return serializeState();
}

async function loginAndBindVgoAi(payload = {}) {
  return {
    ok: true,
    state: await loginRealVgoAi(payload)
  };
}

function closePendingAuthServer() {
  if (!pendingAuthServer) {
    return;
  }
  try {
    pendingAuthServer.close();
  } catch {}
  pendingAuthServer = null;
}

function setBrowserAuthState(nextState = {}) {
  browserAuthState = {
    ...browserAuthState,
    ...nextState
  };
  sendAuthStateUpdate();
}

function browserCallbackHtml(title, description) {
  return `<!doctype html><html><body style="font-family:Segoe UI;padding:24px;background:#08111d;color:#e8eefc;"><h2>${title}</h2><p>${description}</p></body></html>`;
}

async function readTokenFromAuthWindow() {
  if (!authWindow || authWindow.isDestroyed()) {
    return "";
  }

  const authSession = authWindow.webContents.session;
  const cookieNames = ["token", "accessToken", "access_token", "auth_token"];
  for (const name of cookieNames) {
    const cookies = await authSession.cookies.get({ name });
    const value = cookies.find((item) => item.value)?.value;
    if (value) {
      return value;
    }
  }

  try {
    const token = await authWindow.webContents.executeJavaScript(
      `(() => {
        const keys = ["token", "accessToken", "access_token", "auth_token"];
        for (const key of keys) {
          const localValue = window.localStorage.getItem(key);
          if (localValue) return localValue;
          const sessionValue = window.sessionStorage.getItem(key);
          if (sessionValue) return sessionValue;
        }
        return "";
      })()`,
      true
    );
    return typeof token === "string" ? token : "";
  } catch {
    return "";
  }
}

async function finalizeEmbeddedAuth(preferredModel) {
  if (authCheckInFlight) {
    return false;
  }
  authCheckInFlight = true;

  const accessToken = await readTokenFromAuthWindow();
  if (!accessToken) {
    authCheckInFlight = false;
    return false;
  }

  try {
    const profile = await fetchVgoAiProfile(accessToken);
    const modelCatalog = await fetchRealVgoModels(accessToken).catch(() => []);
    const displayName = resolveProfileName(profile, profile?.email || "");

    applyRealVgoAiSession({
      email: profile?.email || "",
      displayName,
      preferredModel,
      accessToken,
      profile,
      modelCatalog
    });

    setBrowserAuthState({
      status: "success",
      message: "网页登录授权成功。",
      loginUrl: browserAuthState.loginUrl,
      redirectUri: browserAuthState.redirectUri
    });

    // Force refresh all windows with new state
    sendStateRefresh();

    if (authWindow && !authWindow.isDestroyed()) {
      authWindow.close();
    }

    return true;
  } finally {
    authCheckInFlight = false;
  }
}

async function beginBrowserVgoAiAuth(payload = {}) {
  closePendingAuthServer();
  clearRealVgoAiSession();
  authCheckInFlight = false;
  setBrowserAuthState({
    status: "starting",
    message: "",
    loginUrl: "",
    redirectUri: ""
  });

  const displayName = (payload.displayName || "").trim() || "VGO AI Developer";
  const preferredModel = payload.preferredModel || "vgo-coder-pro";

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    if (requestUrl.pathname !== "/auth/callback") {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    const accessToken =
      requestUrl.searchParams.get("access_token") || requestUrl.searchParams.get("token") || "";

    if (!accessToken) {
      clearRealVgoAiSession();
      setBrowserAuthState({
        status: "error",
        message: "网页已回调，但没有返回 accessToken，桌面端仍保持未登录状态。"
      });
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        browserCallbackHtml(
          "VGO CODE 未完成授权",
          "网页没有回传 accessToken，因此桌面端不会写入登录状态。"
        )
      );
      closePendingAuthServer();
      return;
    }

    try {
      const profile = await fetchVgoAiProfile(accessToken);
      const modelCatalog = await fetchRealVgoModels(accessToken).catch(() => []);
      const display = resolveProfileName(profile, payload.email || "");

      applyRealVgoAiSession({
        email: profile?.email || "",
        displayName: display,
        preferredModel: requestUrl.searchParams.get("model") || preferredModel,
        accessToken,
        profile,
        modelCatalog,
        rememberedPassword: settings.vgoAI.rememberedPassword,
        rememberPassword: settings.vgoAI.rememberPassword
      });

      setBrowserAuthState({
        status: "success",
        message: "网页登录授权成功。",
        loginUrl: browserAuthState.loginUrl,
        redirectUri: browserAuthState.redirectUri
      });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(browserCallbackHtml("VGO CODE 登录成功", "授权已完成，现在可以回到桌面端继续使用。"));
      closePendingAuthServer();
    } catch (error) {
      clearRealVgoAiSession();
      setBrowserAuthState({
        status: "error",
        message: `已收到网页登录回调，但验证真实账户失败：${error.message}`
      });
      res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
      res.end(browserCallbackHtml("VGO CODE 授权失败", "收到回调但无法验证真实账户信息，请回到桌面端重试。"));
      closePendingAuthServer();
    }
  });

  server.on("error", (error) => {
    clearRealVgoAiSession();
    setBrowserAuthState({
      status: "error",
      message: `启动本地回调监听失败：${error.message}`
    });
    closePendingAuthServer();
  });

  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  pendingAuthServer = server;
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
  const loginUrl =
    `https://vgoai.cn/login?redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&display_name=${encodeURIComponent(displayName)}` +
    `&model=${encodeURIComponent(preferredModel)}`;

  setBrowserAuthState({
    status: "waiting",
    message: "网页登录页已打开，正在等待授权回调。",
    loginUrl,
    redirectUri
  });

  try {
    if (authWindow && !authWindow.isDestroyed()) {
      authWindow.close();
    }
    const win = createAuthWindow(loginUrl);
    setBrowserAuthState({
      status: "waiting",
      message: "网页登录窗口已打开，正在等待授权结果。",
      loginUrl,
      redirectUri
    });

    let authPollInterval = null;

    const clearAuthPoll = () => {
      if (authPollInterval) {
        clearInterval(authPollInterval);
        authPollInterval = null;
      }
    };

    authWindow.on("closed", () => {
      clearAuthPoll();
    });

    authPollInterval = setInterval(async () => {
      if (!authWindow || authWindow.isDestroyed()) {
        clearAuthPoll();
        return;
      }

      try {
        const ok = await finalizeEmbeddedAuth(preferredModel);
        if (ok) {
          clearAuthPoll();
        }
      } catch (error) {
        clearAuthPoll();
        clearRealVgoAiSession();
        setBrowserAuthState({
          status: "error",
          message: `已检测到登录态，但校验账户失败：${error.message}`,
          loginUrl,
          redirectUri
        });
      }
    }, 1500);

    win.webContents.on("did-navigate", async () => {
      try {
        await finalizeEmbeddedAuth(preferredModel);
      } catch {}
    });
  } catch (error) {
    clearRealVgoAiSession();
    setBrowserAuthState({
      status: "error",
      message: `无法打开网页登录窗口：${error.message}`,
      loginUrl,
      redirectUri
    });
    closePendingAuthServer();
    throw error;
  }

  let authTimeout = null;
  authTimeout = setTimeout(() => {
    authTimeout = null;
    if (pendingAuthServer === server && browserAuthState.status === "waiting") {
      clearRealVgoAiSession();
      setBrowserAuthState({
        status: "timeout",
        message: "已打开网页登录页，但暂未收到有效回调。桌面端仍保持未登录状态。",
        loginUrl,
        redirectUri
      });
      closePendingAuthServer();
    }
  }, 180000);

  return {
    ok: false,
    pending: true,
    loginUrl,
    redirectUri,
    message: "网页登录页已打开，正在等待授权回调。"
  };
}

async function syncVgoAiModels() {
  if (isRealVgoLogin()) {
    const modelCatalog = await fetchRealVgoModels(settings.vgoAI.accessToken);
    saveAllSettings({
      ...settings,
      vgoAI: {
        ...settings.vgoAI,
        modelCatalog
      }
    });
    return serializeState();
  }

  const modelCatalog = buildGuestModelCatalog();
  saveAllSettings({
    ...settings,
    vgoAI: {
      ...settings.vgoAI,
      modelCatalog
    }
  });
  return serializeState();
}

app.whenReady().then(async () => {
  await normalizeEngineLogFile(path.join(process.cwd(), "logs", "agent.log"));
  store.load();
  await validateStoredRealLogin();

  // Auto-sync model catalog on startup so stale models are refreshed
  syncVgoAiModels().catch(() => {});

  try {
    const serverInfo = await startMockServer({
      getSettings: () => settings,
      serializeState,
      createRemoteProfile: (payload, options) => createRemoteProfileState(payload, options),
      updateRemoteProfile: (profileId, payload, options) =>
        updateRemoteProfileState(profileId, payload, options),
      selectRemoteProfile: (profileId) => selectRemoteProfileState(profileId),
      deleteRemoteProfile: (profileId) => deleteRemoteProfileState(profileId)
    });
    mockServerInfo = {
      baseUrl: serverInfo.baseUrl,
      status: "online"
    };

    if (!settings.remote.baseUrl || settings.remote.baseUrl.includes("127.0.0.1")) {
      saveAllSettings({
        ...settings,
        remote: {
          ...settings.remote,
          baseUrl: serverInfo.baseUrl
        }
      });
    }
  } catch (error) {
    mockServerInfo = {
      baseUrl: settings.remote.baseUrl,
      status: `failed: ${error.message}`
    };
  }

  const engine = activeEngine();
  store.setRuntime({
    engineId: engine.engineId,
    engineLabel: engine.engineLabel,
    providerLabel: engine.providerLabel
  });

  const ctx = {
    app, store, dialog, shell, crypto, BrowserWindow,
    mainWindow, AUTH_PARTITION,
    activePromptControllers, userAbortedSessions, pendingPermissionRequests,
    sessionEventCounters, browserAuthState, mockServerInfo,
    authWindow, pendingAuthServer, authCheckInFlight,
    appIsPackaged: app.isPackaged,
    UPDATE_URL: "https://vgoai.cn/downloads/vgo-code/version.json",
    DEFAULT_MAX_TASK_RUNTIME_MINUTES: 240,
    MIN_TASK_RUNTIME_MINUTES: 30,
    MAX_TASK_RUNTIME_MINUTES: 720,
    getSettings: () => settings,
    setSettings: (s) => { settings = s; saveSettings(s); },
    getBrowserAuthStatus: () => ({ status: browserAuthState?.status || "idle", message: browserAuthState?.message || "", loginUrl: browserAuthState?.loginUrl || "", redirectUri: browserAuthState?.redirectUri || "" }),
    setBrowserAuthState: (s) => { browserAuthState = { ...browserAuthState, ...s }; sendAuthStateUpdate(); },
    sendAgentEvent, sendStateRefresh, sendUpdateEvent, sendAuthStateUpdate,
    serializeState, serializeSettings, saveAllSettings, isRealVgoLogin, activeEngine,
    setRuntimeEngine, resolveEngineIdForProfile, applyRuntimeForProfile,
    deriveTaskWorkspace, maybeCompressActiveSession, savePreferredModelIfChanged,
    resolveModelContextWindow, touchActivePromptController: (id) => {
      const entry = activePromptControllers.get(String(id || "").trim());
      if (entry) entry.lastTouchedAt = Date.now();
    },
    closePendingAuthServer: () => { if (pendingAuthServer) { try { pendingAuthServer.close(); } catch {} pendingAuthServer = null; } }
  };

  require("./ipc/settings.js").registerHandlers(ipcMain, ctx);
  require("./ipc/chat.js").registerHandlers(ipcMain, ctx);
  require("./ipc/update.js").registerHandlers(ipcMain, ctx);
  require("./ipc/misc.js").registerHandlers(ipcMain, ctx);

  createWindow();
  createTrayIcon();

  app.on("before-quit", () => {
    app.isQuitting = true;
    store.save();
    closePendingAuthServer();
  });

  app.on("activate", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (!app.isQuitting) {
      return;
    }
    app.quit();
  }
});
