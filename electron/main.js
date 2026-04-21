const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { BrowserWindow, app, dialog, ipcMain, shell, session, Tray, Menu, nativeImage } = require("electron");
const { createStore } = require("./core/state");
const {
  compressSessionContext,
  estimateSessionTokens,
  resolveCompressionThresholdRatio,
  resolveModelContextWindow
} = require("./core/contextCompression");
const { getEngine, listEngines } = require("./core/engineRegistry");
const { analyzeWorkspace } = require("./core/workspaceTools");
const { loadSettings, saveSettings, DEFAULT_PROFILE_ID, buildGuestModelCatalog } = require("./core/settings");
const { startMockServer } = require("./core/vgoMockServer");
const { normalizeEngineLogFile } = require("./core/engineLog");
const { listInstalledSkills, installSkillFromSource } = require("./core/localSkillDiscovery");
const { checkForUpdates, skipVersion, resetSkipVersion, setAutoCheck, getUpdateSettings, initializeAutoCheck } = require("./core/versionChecker");

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
const MAIN_LOG_DIR = path.join(process.cwd(), "logs");
const MAIN_LOG_FILE = path.join(MAIN_LOG_DIR, "main-process.log");

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
    const maxRuntimeMs = Number(data.maxRuntimeMs) > 0 ? Number(data.maxRuntimeMs) : DEFAULT_MAX_TASK_RUNTIME_MINUTES * 60000;
    if (now - data.createdAt > maxRuntimeMs) {
      data.controller.abort(new Error("task_runtime_limit_reached"));
      activePromptControllers.delete(key);
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
    ? path.join(process.resourcesPath, "app.asar", "ui", "logo.ico")
    : path.join(app.getAppPath(), "ui", "logo.ico");
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

function mergeSettingsSection(key, payload = {}) {
  saveAllSettings({
    ...settings,
    [key]: {
      ...(settings[key] || {}),
      ...payload
    }
  });
  return serializeState();
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

function installWhisperRuntime() {
  const result = spawnSync("python", ["-m", "pip", "install", "-U", "openai-whisper"], {
    encoding: "utf8",
    shell: false,
    timeout: 3_600_000,
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8"
    }
  });

  const output = [String(result.stdout || "").trim(), String(result.stderr || "").trim()]
    .filter(Boolean)
    .join("\n");

  return {
    ok: result.status === 0,
    exitCode: result.status,
    summary:
      result.status === 0
        ? "Whisper runtime installed successfully."
        : `Whisper install exited with code ${result.status}.`,
    output
  };
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

function resolveActualModelLabel(modelId) {
  const catalog = Array.isArray(settings.vgoAI?.modelCatalog) ? settings.vgoAI.modelCatalog : [];
  const match = catalog.find((item) => item.id === modelId);
  return match?.label || modelId || "未识别";
}

function getSelectedModelId() {
  return settings.vgoAI?.preferredModel || settings.remote?.model || "";
}

function resolveEngineIdForProfile(profile = {}) {
  const provider = String(profile.provider || "").toLowerCase();
  const baseUrl = String(profile.baseUrl || "").toLowerCase();
  const ollamaUrl = String(profile.ollamaUrl || "").toLowerCase();

  if (provider) {
    return provider.includes("ollama") ? "ollama" : "vgo-remote";
  }

  if (ollamaUrl.includes("11434") || baseUrl.includes("11434")) {
    return "ollama";
  }

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
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("agent:event", payload);
    }
  }
}

function sendAuthStateUpdate() {
  console.log("Sending auth state update:", browserAuthState.status);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("auth:stateUpdate", browserAuthState);
    }
  }
}

function sendStateRefresh() {
  console.log("Sending state refresh to all windows");
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("app:stateRefresh", serializeState());
    }
  }
}

function resolveTaskRuntimeLimitMs(targetSettings = settings) {
  const configuredMinutes = Number(targetSettings?.agent?.maxTaskRuntimeMinutes);
  const runtimeMinutes = Number.isFinite(configuredMinutes)
    ? Math.max(MIN_TASK_RUNTIME_MINUTES, Math.min(MAX_TASK_RUNTIME_MINUTES, configuredMinutes))
    : DEFAULT_MAX_TASK_RUNTIME_MINUTES;
  return runtimeMinutes * 60000;
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

function sanitizeFileName(name = "") {
  return String(name || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .trim();
}

function resolveInstallerFileName(downloadUrl = "", latestVersion = "") {
  try {
    const parsedUrl = new URL(downloadUrl);
    const fromUrl = sanitizeFileName(path.basename(decodeURIComponent(parsedUrl.pathname || "")));
    if (fromUrl) {
      return fromUrl;
    }
  } catch {}

  const normalizedVersion = String(latestVersion || "").trim() || "latest";
  return `VGO CODE Setup ${normalizedVersion}.exe`;
}

function downloadInstallerFile(downloadUrl, targetPath, onProgress) {
  return new Promise((resolve, reject) => {
    const fetchFile = (url, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error("Too many redirects while downloading installer"));
        return;
      }

      const client = String(url).startsWith("https://") ? https : http;
      const request = client.get(url, (response) => {
        const statusCode = Number(response.statusCode || 0);
        const redirectLocation = response.headers?.location;

        if (statusCode >= 300 && statusCode < 400 && redirectLocation) {
          response.resume();
          const nextUrl = new URL(redirectLocation, url).toString();
          fetchFile(nextUrl, redirectCount + 1);
          return;
        }

        if (statusCode !== 200) {
          response.resume();
          reject(new Error(`Download failed with HTTP ${statusCode}`));
          return;
        }

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        const output = fs.createWriteStream(targetPath);
        const totalBytes = Number(response.headers?.["content-length"] || 0);
        let downloadedBytes = 0;
        const startedAt = Date.now();
        let lastEmitAt = 0;
        const emitProgress = (force = false) => {
          if (typeof onProgress !== "function") {
            return;
          }
          const now = Date.now();
          if (!force && now - lastEmitAt < 200) {
            return;
          }
          lastEmitAt = now;
          const elapsedMs = Math.max(1, now - startedAt);
          const speedBytesPerSec = Math.max(0, Math.round((downloadedBytes * 1000) / elapsedMs));
          const progressPercent = totalBytes > 0 ? Math.min(100, (downloadedBytes / totalBytes) * 100) : 0;
          onProgress({
            downloadedBytes,
            totalBytes,
            speedBytesPerSec,
            progressPercent
          });
        };

        response.on("data", (chunk) => {
          downloadedBytes += chunk?.length || 0;
          emitProgress(false);
        });
        response.on("end", () => {
          emitProgress(true);
        });

        response.pipe(output);
        output.on("finish", () => {
          output.close(() => resolve(targetPath));
        });
        output.on("error", (error) => {
          output.destroy();
          try {
            fs.unlinkSync(targetPath);
          } catch {}
          reject(error);
        });
      });

      request.on("error", reject);
      request.setTimeout(120000, () => {
        request.destroy(new Error("Installer download timed out"));
      });
    };

    fetchFile(downloadUrl);
  });
}

function resolveUpgradeScriptTemplatePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar", "electron", "core", "scripts", "install-update.ps1");
  }
  return path.join(app.getAppPath(), "electron", "core", "scripts", "install-update.ps1");
}

function resolveUpdaterLogPath() {
  const updateDir = path.join(app.getPath("userData"), "updates");
  fs.mkdirSync(updateDir, { recursive: true });
  return path.join(updateDir, "install-update.log");
}

function launchWindowsInstallerDirect(installerPath) {
  const child = spawn(installerPath, ["/S"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    cwd: path.dirname(installerPath)
  });
  child.unref();
  return Boolean(child?.pid);
}

function launchWindowsUpgradeScript(installerPath) {
  const updateDir = path.join(app.getPath("userData"), "updates");
  fs.mkdirSync(updateDir, { recursive: true });
  const scriptTemplatePath = resolveUpgradeScriptTemplatePath();
  const scriptContent = fs.readFileSync(scriptTemplatePath, "utf8");
  const tempScriptPath = path.join(updateDir, `install-update-${Date.now()}.ps1`);
  fs.writeFileSync(tempScriptPath, scriptContent, "utf8");
  const logPath = resolveUpdaterLogPath();
  try {
    fs.appendFileSync(
      logPath,
      `${new Date().toISOString()} launch script=${tempScriptPath} installer=${installerPath}\n`,
      "utf8"
    );
  } catch {}

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    tempScriptPath,
    "-InstallerPath",
    installerPath,
    "-AppExePath",
    process.execPath,
    "-LogPath",
    logPath
  ];

  const processHandle = spawn("powershell.exe", args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  processHandle.unref();
  return Boolean(processHandle?.pid);
}

async function installUpdatePackage(payload = {}) {
  const updateInfo = {
    currentVersion: app.getVersion(),
    latestVersion: payload.latestVersion || lastDetectedUpdate?.latestVersion || "",
    downloadUrl: payload.downloadUrl || lastDetectedUpdate?.downloadUrl || "",
    releaseNotes: payload.releaseNotes || lastDetectedUpdate?.releaseNotes || "",
    releaseDate: payload.releaseDate || lastDetectedUpdate?.releaseDate || ""
  };

  if (!updateInfo.downloadUrl) {
    return { ok: false, error: "missing_download_url" };
  }

  if (process.platform !== "win32") {
    await shell.openExternal(updateInfo.downloadUrl);
    return { ok: true, mode: "external_download" };
  }

  try {
    sendUpdateEvent("update:status", { status: "downloading", ...updateInfo });
    const fileName = resolveInstallerFileName(updateInfo.downloadUrl, updateInfo.latestVersion);
    const targetPath = path.join(app.getPath("userData"), "updates", fileName);
    await downloadInstallerFile(updateInfo.downloadUrl, targetPath, (progress) => {
      sendUpdateEvent("update:status", {
        status: "downloading",
        ...updateInfo,
        ...progress
      });
    });

    const installerStat = fs.statSync(targetPath);
    if (!installerStat?.size || installerStat.size < 1024 * 1024) {
      throw new Error("Downloaded installer is invalid or incomplete");
    }

    sendUpdateEvent("update:status", { status: "downloaded", installerPath: targetPath, ...updateInfo });
    sendUpdateEvent("update:status", { status: "installing", installerPath: targetPath, ...updateInfo });
    let launched = false;
    try {
      launched = launchWindowsInstallerDirect(targetPath);
      if (!launched) {
        launched = launchWindowsUpgradeScript(targetPath);
      }
    } catch {
      launched = launchWindowsUpgradeScript(targetPath);
    }
    if (!launched) {
      throw new Error("Failed to launch updater script");
    }
    sendUpdateEvent("update:status", { status: "restarting", installerPath: targetPath, ...updateInfo });

    setTimeout(() => {
      app.isQuitting = true;
      app.exit(0);
    }, 1500);

    return { ok: true, mode: "auto_upgrade", installerPath: targetPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendUpdateEvent("update:status", { status: "failed", error: message, ...updateInfo });
    return { ok: false, error: message };
  }
}

function summarizeToolArguments(args = {}) {
  const parts = [];
  if (args.path) {
    parts.push(`path=${args.path}`);
  }
  if (args.query) {
    parts.push(`query=${args.query}`);
  }
  if (args.command) {
    parts.push(`command=${args.command}`);
  }
  if (args.cwd) {
    parts.push(`cwd=${args.cwd}`);
  }
  if (!parts.length) {
    return "无参数";
  }
  return parts.join(" | ");
}

function formatAgentEvent(event) {
  if (!event || typeof event !== "object") {
    return "";
  }

  if (event.type === "plan") {
    const steps = Array.isArray(event.steps) ? event.steps : [];
    const lines = [];
    if (event.summary) {
      lines.push(`执行目标：${event.summary}`);
    }
    if (steps.length) {
      lines.push(...steps.map((step, index) => `${index + 1}. ${step}`));
    }
    return lines.length ? `Agent 执行计划：\n${lines.join("\n")}` : "";
  }

  if (event.type === "workflow_selected") {
    return event.detail || `已选择 ${event.label || event.workflowId || "通用"} 工作流`;
  }

  if (event.type === "workflow_probe") {
    return event.detail || "已完成任务前置检查。";
  }

  if (event.type === "capability_gap") {
    return `能力缺口：\n${event.detail || "当前任务存在待补足能力。"}`;
  }

  if (event.type === "skill_suggestions") {
    const skills = Array.isArray(event.skills) ? event.skills : [];
    if (!skills.length) {
      return event.detail || "未找到可参考的本机 skill。";
    }
    return [
      event.detail || "已找到可参考的本机 skill：",
      ...skills.map((skill) => `- ${skill.name} | ${skill.path}`)
    ].join("\n");
  }

  if (event.type === "skill_installed") {
    return event.ok
      ? `Skill 已安装并启用\n${event.detail || "已完成本机 skill 安装。"}`
      : `Skill 安装失败\n${event.detail || "本机 skill 安装未成功。"}`
  }

  if (event.type === "model_response" && Array.isArray(event.toolCalls) && event.toolCalls.length) {
    const labels = event.toolCalls.map((call) => {
      const name = call?.name || "unknown_tool";
      const args = summarizeToolArguments(call?.arguments || {});
      return `- ${name} | ${args}`;
    });
    return `Agent 正在调用工具：\n${labels.join("\n")}`;
  }

  if (event.type === "tool_result") {
    return event.ok
      ? `工具已完成：${event.tool}\n${event.summary || "执行成功"}`
      : `工具执行失败：${event.tool}\n${event.summary || "执行失败"}`;
  }

  return "";
}

function collectMutatedPathsFromEvents(rawEvents = [], limit = 12) {
  const paths = [];
  for (const event of Array.isArray(rawEvents) ? rawEvents : []) {
    if (event?.type !== "tool_result" || !event?.ok) {
      continue;
    }
    if (!["write_file", "move_file", "rename_file", "copy_file", "delete_file", "make_dir", "delete_dir"].includes(event.tool)) {
      continue;
    }
    const summary = String(event.summary || "");
    const pathMatch =
      summary.match(/^(?:Wrote|Moved|Renamed|Copied|Deleted|Created directory)\s+(.+?)\.$/i) ||
      summary.match(/\bpath=([^\s|]+)/i);
    if (pathMatch?.[1]) {
      paths.push(pathMatch[1]);
    }
  }
  return [...new Set(paths)].slice(0, Math.max(1, limit));
}

function buildSessionClosingSummary(result = {}, prompt = "") {
  const text = String(result?.text || "").trim();
  const rawEvents = Array.isArray(result?.rawEvents) ? result.rawEvents : [];
  const toolResults = rawEvents.filter((event) => event?.type === "tool_result");
  const successCount = toolResults.filter((event) => event?.ok).length;
  const failCount = toolResults.filter((event) => event?.ok === false).length;
  const mutatedPaths = collectMutatedPathsFromEvents(rawEvents);
  const conciseEvidence = [
    mutatedPaths.length ? `变更文件 ${mutatedPaths.length} 项` : "",
    successCount > 0 ? `工具成功 ${successCount} 次` : "",
    failCount > 0 ? `失败 ${failCount} 次` : ""
  ]
    .filter(Boolean)
    .join("，");

  if (!text) {
    if (conciseEvidence) {
      return `本轮执行完成。${conciseEvidence}。`;
    }
    return result.ok ? "本轮任务已完成。" : "本轮任务未完成。";
  }

  // 避免把僵硬模板再拼接到模型原始回答后面，优先保留模型自然输出。
  if (text.includes("【任务收尾】") || text.includes("下一步建议")) {
    return text;
  }

  // 只在模型回答极短且信息不足时，补一行证据，不再强制固定大模板。
  if (text.length <= 24 && conciseEvidence) {
    return `${text}\n\n执行摘要：${conciseEvidence}。`;
  }

  return text;
}

function collectConcreteToolFindingsV2(rawEvents = [], limit = 5) {
  const findings = [];
  for (const event of Array.isArray(rawEvents) ? rawEvents : []) {
    if (event?.type !== "tool_result") continue;
    const summary = String(event.summary || "").trim();
    const output = String(event.output || "").trim();
    const firstOutputLine = output.split(/\r?\n/).find((line) => String(line || "").trim()) || "";
    const base = summary || firstOutputLine;
    if (!base) continue;
    if (/^(success|ok|done|completed?)$/i.test(base)) continue;
    findings.push(`${event.ok ? "[OK]" : "[ERR]"} ${event.tool || "tool"}: ${base}`);
  }
  return [...new Set(findings)].slice(0, Math.max(1, limit));
}

function stripClosingTemplateV2(text = "") {
  let cleaned = String(text || "").trim();
  if (!cleaned) return "";
  cleaned = cleaned.replace(/【任务收尾】[\s\S]*$/i, "").trim();
  cleaned = cleaned.replace(/\b(?:下一步建议|可继续下一步|我可以继续修复)\b[\s\S]*$/i, "").trim();
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

function buildSessionClosingSummaryV2(result = {}, prompt = "") {
  const text = String(result?.text || "").trim();
  const rawEvents = Array.isArray(result?.rawEvents) ? result.rawEvents : [];
  const toolResults = rawEvents.filter((event) => event?.type === "tool_result");
  const successCount = toolResults.filter((event) => event?.ok).length;
  const failCount = toolResults.filter((event) => event?.ok === false).length;
  const mutatedPaths = collectMutatedPathsFromEvents(rawEvents, 12);
  const concreteFindings = collectConcreteToolFindingsV2(rawEvents);
  const strippedText = stripClosingTemplateV2(text);
  const conciseEvidence = [
    mutatedPaths.length ? `变更文件 ${mutatedPaths.length} 项` : "",
    successCount > 0 ? `工具成功 ${successCount} 次` : "",
    failCount > 0 ? `失败 ${failCount} 次` : ""
  ]
    .filter(Boolean)
    .join("，");

  const changedFilesSection = mutatedPaths.length
    ? `\n\n已修改文件（${mutatedPaths.length}）：\n${mutatedPaths
        .map((item, index) => `${index + 1}. ${item}`)
        .join("\n")}`
    : "";

  if (!text && concreteFindings.length) {
    return `已完成本轮执行，关键结果：\n${concreteFindings
      .map((item, index) => `${index + 1}. ${item}`)
      .join("\n")}${changedFilesSection}`;
  }

  if (!text) {
    if (conciseEvidence) {
      return `本轮执行已完成。${conciseEvidence}。`;
    }
    return result.ok ? "本轮任务已完成。" : "本轮任务未完成。";
  }

  const looksTemplateLike =
    /【任务收尾】|下一步建议|本轮任务已完成|可继续下一步/i.test(text) && strippedText.length <= 24;
  if (looksTemplateLike && concreteFindings.length) {
    return `已完成本轮执行，关键结果：\n${concreteFindings
      .map((item, index) => `${index + 1}. ${item}`)
      .join("\n")}${changedFilesSection}`;
  }

  if (strippedText && strippedText.length > 24) {
    return `${strippedText}${changedFilesSection}`;
  }

  if (text.length <= 24 && concreteFindings.length) {
    return `${text}\n\n关键结果：\n${concreteFindings
      .map((item, index) => `${index + 1}. ${item}`)
      .join("\n")}${changedFilesSection}`;
  }

  if (text.length <= 24 && conciseEvidence) {
    return `${text}\n\n执行摘要：${conciseEvidence}。${changedFilesSection}`;
  }

  return `${text}${changedFilesSection}`;
}

async function requestToolPermission(call = {}, notify = () => {}) {
  const permissionMode = settings.permissions?.mode || "default";
  const args = call.arguments && typeof call.arguments === "object" ? call.arguments : {};
  const detail =
    call.name === "skill_discovery"
      ? `工作流：${args.workflow || "未识别"}\n查询：${args.query || "(empty)"}\n原因：${args.reason || "需要补充执行技能能力"}`
      : call.name === "skill_install"
      ? `Skill：${args.name || "未命名"}\n来源：${args.sourcePath || "(empty)"}\n原因：${args.reason || "需要安装本机 skill 以继续完成任务"}`
      :
    call.name === "run_command"
      ? `命令：${args.command || "(empty)"}\n目录：${args.cwd || "."}`
      : `文件：${args.path || "(missing path)"}`;

  if (permissionMode === "full-access") {
    notify({
      type: "permission_granted",
      tool: call.name,
      detail: `${detail}\n模式：完全访问。`, 
    });
    return true;
  }

  if (settings.behavior?.confirmDangerousOps === false) {
    notify({
      type: "permission_granted",
      tool: call.name,
      detail: `${detail}` + "\n模式：已关闭危险操作确认。",
    });
    return true;
  }

  const requestId = crypto.randomUUID();
  notify({
    type: "permission_requested",
    tool: call.name,
    detail,
    requestId
  });

  return await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingPermissionRequests.delete(requestId);
      notify({
        type: "permission_denied",
        tool: call.name,
        detail: `${detail}\n结果：等待确认超时，已自动拒绝。`, 
        requestId
      });
      resolve(false);
    }, 300000);

    pendingPermissionRequests.set(requestId, {
      callback: (approved) => {
        clearTimeout(timeout);
        pendingPermissionRequests.delete(requestId);
        notify({
          type: approved ? "permission_granted" : "permission_denied",
          tool: call.name,
          detail,
          requestId
        });
        resolve(Boolean(approved));
      },
      createdAt: Date.now()
    });
  });
}

function isModelQuery(prompt = "") {
  const normalized = String(prompt || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized === "/model" || normalized === "model" || normalized === "/models") {
    return true;
  }

  return /你.*什么模型|当前.*模型|现在.*模型|哪个模型|what model/i.test(normalized);
}

function buildModelStatusReply(session) {
  const actualModel = session?.actualModel || settings.vgoAI?.preferredModel || settings.remote?.model || "";
  const actualLabel = resolveActualModelLabel(actualModel);
  const actualChannel = session?.actualChannel || (isRealVgoLogin() ? "real-remote" : "local-mock");
  const contextWindow =
    session?.actualContextWindow || resolveModelContextWindow(settings, actualModel);

  return [
    `当前实际模型：${actualLabel}`,
    `模型 ID：${actualModel || "未识别"}`,
    `当前通道：${actualChannel}`,
    `上下文窗口：${contextWindow} tokens`,
    "",
    "这条信息由桌面端直接返回，依据的是本次会话记录里的实际模型状态，不依赖模型自行描述。"
  ].join("\\n");
}

function isModelQueryV2(prompt = "") {
  const normalized = String(prompt || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  if (!normalized) {
    return false;
  }

  return (
    normalized === "/model" ||
    normalized === "model" ||
    normalized === "/models" ||
    normalized.includes("你是什么模型") ||
    normalized.includes("你现在是什么模型") ||
    normalized.includes("当前模型是什么") ||
    normalized.includes("现在是什么模型") ||
    normalized.includes("哪个模型") ||
    normalized.includes("whatmodel")
  );
}

function buildModelStatusReplyV2(session) {
  const selectedModel = settings.vgoAI?.preferredModel || settings.remote?.model || "";
  const selectedLabel = resolveActualModelLabel(selectedModel);
  const actualModel = session?.actualModel || "";
  const actualLabel = resolveActualModelLabel(actualModel);
  const actualChannel = session?.actualChannel || (isRealVgoLogin() ? "real-remote" : "local-mock");
  const contextWindow =
    session?.actualContextWindow || resolveModelContextWindow(settings, actualModel || selectedModel);

  const lines = [
    `当前已选模型：${selectedLabel}`,
    `模型 ID：${selectedModel || "未识别"}`,
    `当前通道：${actualChannel}`,
    `上下文窗口：${contextWindow} tokens`
  ];

  if (actualModel && actualModel !== selectedModel) {
    lines.push(`上一条实际命中模型：${actualLabel} (${actualModel})`);
  }

  lines.push("");
  lines.push("这条信息由桌面端直接返回，优先依据当前已选模型，而不是让模型自行描述。");
  return lines.join("\n");
}

function createTrayIcon() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "ui", "logo.png")
    : path.join(app.getAppPath(), "ui", "logo.png");
  
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

  const isDev = !app.isPackaged;
  const distWebPath = path.join(app.getAppPath(), "dist-web", "index.html");
  const fallbackUiPath = path.join(app.getAppPath(), "ui", "index.html");
  const allowLegacyFallback =
    isDev || String(process.env.VGO_ALLOW_LEGACY_UI_FALLBACK || "") === "1";
  if (fs.existsSync(distWebPath)) {
    win.loadFile(distWebPath);
  } else if (allowLegacyFallback && fs.existsSync(fallbackUiPath)) {
    logMainEvent("renderer_missing_dist_web_using_legacy_fallback", {
      distWebPath,
      fallbackUiPath,
      isDev,
      allowLegacyFallback
    });
    win.loadFile(fallbackUiPath);
  } else {
    logMainEvent("renderer_missing_dist_web_no_fallback", {
      distWebPath,
      fallbackUiPath,
      isDev,
      allowLegacyFallback
    });
    win.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          "<!doctype html><html><head><meta charset='utf-8'><title>VGO CODE</title></head>" +
            "<body style='font-family:Segoe UI,Arial,sans-serif;padding:24px;background:#0b1220;color:#f5f7fb;'>" +
            "<h2>Renderer bundle is missing</h2>" +
            "<p>Cannot find dist-web/index.html. Please run <code>npm run build:web</code> and restart.</p>" +
            "<p>If you must use legacy fallback temporarily, set <code>VGO_ALLOW_LEGACY_UI_FALLBACK=1</code>.</p>" +
            "</body></html>"
        )
    );
  }
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

function syncRemoteProfileState(nextRemote, extraProfileFields = {}, currentVgoAi = null) {
  const activeProfileId = settings.activeRemoteProfileId;
  const profiles = (settings.remoteProfiles || []).map((profile) =>
    profile.id === activeProfileId
      ? {
          ...profile,
          ...extraProfileFields,
          provider: extraProfileFields.provider || nextRemote.provider || profile.provider || "VGO Remote",
          baseUrl: nextRemote.baseUrl,
          modelListUrl:
            typeof nextRemote.modelListUrl === "string"
              ? nextRemote.modelListUrl
              : profile.modelListUrl || "",
          modelCatalog:
            Array.isArray(extraProfileFields.modelCatalog)
              ? extraProfileFields.modelCatalog
              : profile.modelCatalog || [],
          ollamaUrl: nextRemote.ollamaUrl || profile.ollamaUrl || "",
          model: nextRemote.model,
          apiKey: nextRemote.apiKey,
          systemPrompt: nextRemote.systemPrompt
        }
      : profile
  );

  return {
    ...settings,
    vgoAI: currentVgoAi !== null ? currentVgoAi : settings.vgoAI,
    remote: {
      ...nextRemote,
      provider:
        extraProfileFields.provider ||
        nextRemote.provider ||
        profiles.find((profile) => profile.id === activeProfileId)?.provider ||
        "VGO Remote",
      modelListUrl:
        typeof nextRemote.modelListUrl === "string"
          ? nextRemote.modelListUrl
          : profiles.find((profile) => profile.id === activeProfileId)?.modelListUrl ||
            "",
      ollamaUrl:
        nextRemote.ollamaUrl ||
        profiles.find((profile) => profile.id === activeProfileId)?.ollamaUrl ||
        ""
    },
    remoteProfiles: profiles
  };
}

function createRemoteProfileState(payload = {}, { activate = true } = {}) {
  const profileId = `profile-${Date.now()}`;
  const normalizedProvider = (payload.provider || "").trim() || "VGO Remote";
  const isOllamaProvider = normalizedProvider.toLowerCase().includes("ollama");
  const incomingApiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
  const currentApiKey = String(settings.remote.apiKey || "").trim();
  const resolvedApiKey =
    incomingApiKey === "********"
      ? (currentApiKey === "********" ? "" : currentApiKey)
      : incomingApiKey;
  const profile = {
    id: profileId,
    name: (payload.name || "").trim() || `杩滅▼閰嶇疆 ${(settings.remoteProfiles || []).length + 1}`,
    provider: normalizedProvider,
    baseUrl: payload.baseUrl || settings.remote.baseUrl,
    modelListUrl: payload.modelListUrl || "",
    modelCatalog: Array.isArray(payload.modelCatalog) ? payload.modelCatalog : [],
    ollamaUrl: isOllamaProvider ? payload.ollamaUrl || settings.remote.ollamaUrl || "" : "",
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
          ollamaUrl: profile.ollamaUrl || "",
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
  const isOllamaProvider = String(profile.provider || "").toLowerCase().includes("ollama");

  saveAllSettings({
    ...settings,
    activeRemoteProfileId: profileId,
    remote: {
      provider: profile.provider || "VGO Remote",
      baseUrl: profile.baseUrl,
      modelListUrl: profile.modelListUrl || "",
      ollamaUrl: isOllamaProvider ? profile.ollamaUrl || "" : "",
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
  const nextIsOllamaProvider = String(nextProvider).toLowerCase().includes("ollama");
  const baseUrlFromPayload = payload.baseUrl || profile.baseUrl;
  const modelListUrlFromPayload =
    typeof payload.modelListUrl === "string"
      ? payload.modelListUrl
      : profile.modelListUrl || "";
  const ollamaUrlFromPayload = nextIsOllamaProvider ? payload.ollamaUrl || profile.ollamaUrl || "" : "";
  const endpointChanged =
    String(profile.provider || "") !== String(nextProvider || "") ||
    normalizeUrlForCompare(profile.baseUrl) !== normalizeUrlForCompare(baseUrlFromPayload) ||
    normalizeUrlForCompare(profile.modelListUrl) !== normalizeUrlForCompare(modelListUrlFromPayload) ||
    normalizeUrlForCompare(profile.ollamaUrl) !== normalizeUrlForCompare(ollamaUrlFromPayload);

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
    ollamaUrl: ollamaUrlFromPayload,
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
          ollamaUrl: nextProfile.ollamaUrl || "",
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
          ollamaUrl: settings.remote.ollamaUrl || "",
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
      ollamaUrl: activeProfile.ollamaUrl || "",
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
      throw new Error(payload.message || payload.error || `http_${response.status}`);
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
    ? items.map((item) => ({
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

async function fetchModelCatalog(baseUrl) {
  const payload = await fetchJson(`${baseUrl.replace(/\/+$/, "")}/models`);
  return Array.isArray(payload.items) ? payload.items : [];
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
    .filter((item) => item.id)
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
          ollamaUrl: activeProfile.ollamaUrl || settings.remote.ollamaUrl || "",
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
    nextSettings = syncRemoteProfileState(
      {
        ...nextSettings.remote,
        model: preferredModel
      },
      {},
      nextSettings.vgoAI
    );
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

  let nextSettings = {
    ...settings,
    vgoAI: {
      ...settings.vgoAI,
      preferredModel: modelId
    }
  };

  if (activeIsRemote) {
    nextSettings = syncRemoteProfileState(
      {
        ...nextSettings.remote,
        model: modelId
      },
      {}
    );
  }

  saveAllSettings(nextSettings);
}

function clearRealVgoAiSession() {
  saveAllSettings({
    ...settings,
    vgoAI: {
      ...settings.vgoAI,
      loggedIn: false,
      email: "",
      displayName: "Guest",
      accessToken: "",
      linkedAt: "",
      profile: null
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

  console.log("Attempting login to vgoai.cn with email:", email);
  
  const loginPayload = await fetchJson("https://vgoai.cn/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });

  console.log("Login response:", JSON.stringify(loginPayload).slice(0, 200));

  const accessToken = loginPayload.accessToken;
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

  console.log("Login successful, state serialized");
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

async function exportHistory() {
  const state = store.getState();
  const session = store.getActiveSession();
  if (!session) {
    return { ok: false, canceled: true };
  }

  const defaultFile = path.join(state.workspace, `vgo-session-${session.id.slice(0, 8)}.md`);
  const result = await dialog.showSaveDialog({
    defaultPath: defaultFile,
    filters: [{ name: "Markdown", extensions: ["md"] }]
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  const body = [
    "# VGO CODE Session Export",
    "",
    `Workspace: ${state.workspace}`,
    `Session ID: ${session.id}`,
    `Session Title: ${session.title}`,
    `Runtime: ${state.runtime.engineLabel}`,
    `Provider: ${state.runtime.providerLabel}`,
    `Exported At: ${new Date().toISOString()}`,
    "",
    ...session.history.map((item) => [`## ${item.role.toUpperCase()}`, "", item.text, ""].join("\n"))
  ].join("\n");

  fs.writeFileSync(result.filePath, body, "utf8");
  return { ok: true, filePath: result.filePath };
}

function readAttachmentPreview(filePath) {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isText = TEXT_EXTENSIONS.has(ext) && stat.size <= 256 * 1024;
  const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
  const audioExtensions = new Set([".mp3", ".wav", ".m4a", ".flac", ".ogg"]);
  const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm"]);
  const imageBase64 =
    imageExtensions.has(ext) && stat.size <= 10 * 1024 * 1024
      ? fs.readFileSync(filePath).toString("base64")
      : "";
  const mediaType = imageExtensions.has(ext)
    ? "image"
    : audioExtensions.has(ext)
      ? "audio"
      : videoExtensions.has(ext)
        ? "video"
        : "file";

  return {
    name: path.basename(filePath),
    path: filePath,
    size: stat.size,
    isText,
    mediaType,
    imageBase64,
    content: isText ? fs.readFileSync(filePath, "utf8") : ""
  };
}

app.whenReady().then(async () => {
  normalizeEngineLogFile(path.join(process.cwd(), "logs", "ollama-engine.log"));
  store.load();
  await validateStoredRealLogin();

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

  ipcMain.handle("app:getState", () => serializeState());
  ipcMain.handle("settings:get", () => serializeSettings());
  ipcMain.handle("logs:normalizeEngine", () =>
    normalizeEngineLogFile(path.join(process.cwd(), "logs", "ollama-engine.log"))
  );
  ipcMain.handle("runtime:installWhisper", () => installWhisperRuntime());
  ipcMain.handle("runtime:installSkill", (_event, payload = {}) => {
    const result = installSkillFromSource(payload.sourcePath, payload.name);
    sendStateRefresh();
    return result;
  });

  createWindow();
  createTrayIcon();

  setTimeout(async () => {
    const updateResult = await initializeAutoCheck(app.getVersion(), {
      updateUrl: "https://vgoai.cn/downloads/vgo-code/version.json"
    });
    if (updateResult?.updateAvailable && mainWindow) {
      lastDetectedUpdate = {
        currentVersion: updateResult.currentVersion,
        latestVersion: updateResult.latestVersion,
        downloadUrl: updateResult.downloadUrl,
        releaseNotes: updateResult.releaseNotes,
        releaseDate: updateResult.releaseDate
      };
      sendUpdateEvent("update:available", lastDetectedUpdate);
    }
  }, 5000);

  ipcMain.handle("settings:updateAppearance", (_event, payload = {}) =>
    mergeSettingsSection("appearance", {
      theme: payload.theme || settings.appearance?.theme || "aurora",
      uiMode: payload.uiMode || settings.appearance?.uiMode || "standard",
      compactMode:
        typeof payload.compactMode === "boolean"
          ? payload.compactMode
          : settings.appearance?.compactMode,
      messageDensity: payload.messageDensity || settings.appearance?.messageDensity || "comfortable"
    })
  );

  ipcMain.handle("settings:updateLocalization", (_event, payload = {}) =>
    mergeSettingsSection("localization", {
      locale: payload.locale === "en-US" ? "en-US" : "zh-CN"
    })
  );

  ipcMain.handle("settings:updateBehavior", (_event, payload = {}) =>
    mergeSettingsSection("behavior", {
      enterToSend:
        typeof payload.enterToSend === "boolean"
          ? payload.enterToSend
          : settings.behavior?.enterToSend,
      autoScroll:
        typeof payload.autoScroll === "boolean" ? payload.autoScroll : settings.behavior?.autoScroll,
      showTaskPanel:
        typeof payload.showTaskPanel === "boolean"
          ? payload.showTaskPanel
          : settings.behavior?.showTaskPanel,
      confirmDangerousOps:
        typeof payload.confirmDangerousOps === "boolean"
          ? payload.confirmDangerousOps
          : settings.behavior?.confirmDangerousOps
    })
  );

  ipcMain.handle("settings:updateAgentPreferences", (_event, payload = {}) =>
    mergeSettingsSection("agent", {
      autoSummarizeContext:
        typeof payload.autoSummarizeContext === "boolean"
          ? payload.autoSummarizeContext
          : settings.agent?.autoSummarizeContext,
      contextCompressionThreshold:
        typeof payload.contextCompressionThreshold === "number"
          ? Math.max(0.5, Math.min(0.98, payload.contextCompressionThreshold))
          : settings.agent?.contextCompressionThreshold,
      showRuntimeMeta:
        typeof payload.showRuntimeMeta === "boolean"
          ? payload.showRuntimeMeta
          : settings.agent?.showRuntimeMeta,
      showExecutionPlan:
        typeof payload.showExecutionPlan === "boolean"
          ? payload.showExecutionPlan
          : settings.agent?.showExecutionPlan,
      fallbackModel:
        typeof payload.fallbackModel === "string"
          ? payload.fallbackModel.trim()
          : settings.agent?.fallbackModel,
      suggestSkillAugmentation:
        typeof payload.suggestSkillAugmentation === "boolean"
          ? payload.suggestSkillAugmentation
          : settings.agent?.suggestSkillAugmentation,
      autoSearchSkillsOnApproval:
        typeof payload.autoSearchSkillsOnApproval === "boolean"
          ? payload.autoSearchSkillsOnApproval
          : settings.agent?.autoSearchSkillsOnApproval,
      maxToolSteps:
        typeof payload.maxToolSteps === "number"
          ? Math.max(20, Math.min(300, Math.floor(payload.maxToolSteps)))
          : settings.agent?.maxToolSteps,
      maxTaskRuntimeMinutes:
        typeof payload.maxTaskRuntimeMinutes === "number"
          ? Math.max(MIN_TASK_RUNTIME_MINUTES, Math.min(MAX_TASK_RUNTIME_MINUTES, Math.floor(payload.maxTaskRuntimeMinutes)))
          : settings.agent?.maxTaskRuntimeMinutes
    })
  );
  ipcMain.handle("settings:updateSkillState", (_event, payload = {}) => {
    const skillId = String(payload.id || "").trim();
    if (!skillId) {
      return { ok: false, error: "missing_skill_id" };
    }

    const disabled = new Set(settings.skills?.disabled || []);
    if (payload.enabled === false) {
      disabled.add(skillId);
    } else {
      disabled.delete(skillId);
    }

    saveAllSettings({
      ...settings,
      skills: {
        ...(settings.skills || {}),
        disabled: [...disabled].sort()
      }
    });

    return serializeState();
  });

  ipcMain.handle("settings:updateRemote", (_event, payload) => {
    const nextRemote = {
      ...settings.remote,
      ...payload,
      model: normalizeExternalModelId(payload.model || settings.remote.model),
      apiKey:
        typeof payload.apiKey === "string" && payload.apiKey.trim() === "********"
          ? settings.remote.apiKey
          : payload.apiKey
    };
    const extraProfileFields = {};
    if ((payload.name || "").trim()) {
      extraProfileFields.name = payload.name.trim();
    }
    if ((payload.provider || "").trim()) {
      extraProfileFields.provider = payload.provider.trim();
    }
    saveAllSettings(syncRemoteProfileState(nextRemote, extraProfileFields));
    return serializeState();
  });

  ipcMain.handle("settings:updatePermissions", (_event, payload = {}) => {
    const nextMode = payload.mode === "full" ? "full-access" : "default";
    saveAllSettings({
      ...settings,
      permissions: {
        ...settings.permissions,
        mode: nextMode
      }
    });
    return serializeState();
  });
  ipcMain.handle("settings:updateAccess", (_event, payload = {}) => {
    const allowedScopes = new Set(["workspace-only", "workspace-and-desktop", "full-system"]);
    const nextScope = allowedScopes.has(payload.scope) ? payload.scope : "workspace-and-desktop";
    saveAllSettings({
      ...settings,
      access: {
        ...(settings.access || {}),
        scope: nextScope
      }
    });
    return serializeState();
  });
  ipcMain.handle("permissions:respond", (_event, payload = {}) => {
    const entry = pendingPermissionRequests.get(payload.requestId);
    if (!entry) {
      return { ok: false };
    }
    entry.callback(payload.approved === true);
    return { ok: true };
  });

  ipcMain.handle("settings:createRemoteProfile", async (_event, payload = {}) => {
    const result = createRemoteProfileState(payload, { activate: true });
    const profileId = result?.settings?.activeRemoteProfileId;
    if (!profileId) {
      return result;
    }
    return await refreshRemoteProfileModelCatalogState(profileId);
  });

  ipcMain.handle("settings:updateRemoteProfile", async (_event, payload = {}) => {
    const result = updateRemoteProfileState(payload.profileId, payload.payload || {}, { activate: true });
    const profileId = payload.profileId || result?.settings?.activeRemoteProfileId;
    if (!profileId) {
      return result;
    }
    return await refreshRemoteProfileModelCatalogState(profileId);
  });

  ipcMain.handle("settings:selectRemoteProfile", async (_event, profileId) => {
    const result = selectRemoteProfileState(profileId);
    if (!profileId) {
      return result;
    }
    return await refreshRemoteProfileModelCatalogState(profileId, { activateModelIfMissing: false });
  });

  ipcMain.handle("settings:refreshRemoteProfileModels", async (_event, profileId) => {
    const targetProfileId = profileId || settings.activeRemoteProfileId;
    if (!targetProfileId) {
      return serializeState();
    }
    return await refreshRemoteProfileModelCatalogState(targetProfileId);
  });

  ipcMain.handle("settings:deleteRemoteProfile", (_event, profileId) =>
    deleteRemoteProfileState(profileId)
  );

  ipcMain.handle("settings:updateVgoAiProfile", (_event, payload) => {
    const nextPreferredModel = payload.preferredModel || settings.vgoAI.preferredModel;
    const requestedDefaultCloudProfile = payload.useDefaultCloudProfile === true;
    const activeProfile = requestedDefaultCloudProfile
      ? (settings.remoteProfiles || []).find((item) => item.id === DEFAULT_PROFILE_ID) || null
      : (settings.remoteProfiles || []).find((item) => item.id === settings.activeRemoteProfileId) || null;
    const activeIsRemote = !activeProfile || resolveEngineIdForProfile(activeProfile) !== "ollama";

    let nextSettings = {
      ...settings,
      vgoAI: {
        ...settings.vgoAI,
        email: payload.email || settings.vgoAI.email,
        rememberedPassword:
          payload.rememberPassword === false
            ? ""
            : payload.password ?? settings.vgoAI.rememberedPassword,
        rememberPassword: payload.rememberPassword ?? settings.vgoAI.rememberPassword,
        displayName: payload.displayName || settings.vgoAI.displayName,
        preferredModel: nextPreferredModel
      }
    };

    if (activeIsRemote) {
      if (requestedDefaultCloudProfile && activeProfile) {
        const nextProfiles = (settings.remoteProfiles || []).map((profile) =>
          profile.id === activeProfile.id
            ? {
                ...profile,
                provider: activeProfile.provider || "VGO Remote",
                baseUrl: activeProfile.baseUrl,
                ollamaUrl: activeProfile.ollamaUrl || "",
                model: nextPreferredModel,
                apiKey: activeProfile.apiKey,
                systemPrompt: activeProfile.systemPrompt
              }
            : profile
        );

        nextSettings = {
          ...nextSettings,
          activeRemoteProfileId: activeProfile.id,
          remoteProfiles: nextProfiles,
          remote: {
            provider: activeProfile.provider || "VGO Remote",
            baseUrl: activeProfile.baseUrl,
            ollamaUrl: activeProfile.ollamaUrl || "",
            model: nextPreferredModel,
            apiKey: activeProfile.apiKey,
            systemPrompt: activeProfile.systemPrompt
          }
        };
      } else {
        nextSettings = syncRemoteProfileState(
          {
            ...nextSettings.remote,
            model: nextPreferredModel
          },
          {}
        );
      }
    }

    saveAllSettings(nextSettings);
    return serializeState();
  });

  ipcMain.handle("settings:logoutVgoAi", async () => {
    if (authWindow && !authWindow.isDestroyed()) {
      authWindow.close();
    }
    authCheckInFlight = false;
    setBrowserAuthState({
      status: "idle",
      message: "",
      loginUrl: "",
      redirectUri: ""
    });
    clearRealVgoAiSession();
    await clearAuthBrowserSession();
    return serializeState();
  });

  ipcMain.handle("settings:bindVgoAi", () => ({
    ok: false,
    message: "本地假绑定已禁用，请使用真实网页登录或真实账号密码登录。",
    state: serializeState()
  }));
  ipcMain.handle("settings:loginAndBindVgoAi", (_event, payload) => loginAndBindVgoAi(payload));
  ipcMain.handle("settings:startBrowserVgoAiAuth", (_event, payload) => beginBrowserVgoAiAuth(payload));
  ipcMain.handle("settings:getBrowserAuthStatus", () => ({
    ...browserAuthState,
    state: serializeState()
  }));
  ipcMain.handle("settings:openVgoAiLoginPage", async (_event, payload = {}) => {
  const displayName = (payload.displayName || "").trim() || "VGO AI Developer";
    const preferredModel = payload.preferredModel || "vgo-coder-pro";
    const loginUrl =
      `https://vgoai.cn/login?display_name=${encodeURIComponent(displayName)}` +
      `&model=${encodeURIComponent(preferredModel)}`;
    await shell.openExternal(loginUrl);
    return { ok: true, loginUrl };
  });
  ipcMain.handle("settings:syncVgoAiModels", () => syncVgoAiModels());

  ipcMain.handle("runtime:setEngine", (_event, engineId) => {
    if (engineId === "ollama") {
      const profile =
        (settings.remoteProfiles || []).find((item) => resolveEngineIdForProfile(item) === "ollama") ||
        null;
      if (profile) {
        saveAllSettings({
          ...settings,
          activeRemoteProfileId: profile.id,
          remote: {
            provider: profile.provider || "Ollama",
            baseUrl: profile.baseUrl,
            ollamaUrl: profile.ollamaUrl || profile.baseUrl || "",
            model: profile.model,
            apiKey: profile.apiKey,
            systemPrompt: profile.systemPrompt
          }
        });
      }
    }

    if (engineId === "vgo-remote") {
      const profile =
        (settings.remoteProfiles || []).find((item) => item.id === DEFAULT_PROFILE_ID) ||
        (settings.remoteProfiles || []).find((item) => resolveEngineIdForProfile(item) === "vgo-remote") ||
        null;
      if (profile) {
        saveAllSettings({
          ...settings,
          activeRemoteProfileId: profile.id,
          remote: {
            provider: profile.provider || "VGO Remote",
            baseUrl: profile.baseUrl,
            ollamaUrl: profile.ollamaUrl || "",
            model: profile.model,
            apiKey: profile.apiKey,
            systemPrompt: profile.systemPrompt
          }
        });
      }
    }

    setRuntimeEngine(engineId);
    return serializeState();
  });

  ipcMain.handle("chat:send", async (_event, payload) => {
    const current = store.getState();
    let session = store.getActiveSession();
    const prompt = typeof payload === "string" ? payload : String(payload?.text || "");
    const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
    const normalizedPrompt = String(prompt || "").trim();
    if (!session) {
      return {
        ok: false,
        exitCode: 1,
        sessionId: "",
        text: "当前没有可用线程。",
        error: "no_active_session",
        rawEvents: []
      };
    }

    if (!normalizedPrompt && attachments.length === 0) {
      return {
        ok: false,
        exitCode: 1,
        sessionId: session.id,
        text: "empty_prompt_ignored",
        error: "empty_prompt_ignored",
        rawEvents: []
      };
    }

    const attachmentSummary = attachments.length
      ? `\n\n[附件]\n${attachments.map((item, index) => `${index + 1}. ${item.name} | ${item.path}`).join("\n")}`
      : "";
    store.renameSessionFromFirstPrompt(normalizedPrompt);
    store.appendHistory("user", `${normalizedPrompt}${attachmentSummary}`);
    const taskWorkspace = deriveTaskWorkspace(normalizedPrompt, current.workspace, session.directory || "");
    store.updateSessionMeta(session.id, {
      directory: taskWorkspace
    });
    session = store.getActiveSession();
    sendAgentEvent({
      sessionId: session.id,
      type: "task_status",
      status: "planning",
      message: "Agent 正在分析任务并规划执行步骤...",
      taskWorkspace
    });

    const compression = maybeCompressActiveSession();
    session = store.getActiveSession();
    const controller = new AbortController();
    userAbortedSessions.delete(session.id);
    activePromptControllers.set(session.id, {
      controller,
      createdAt: Date.now(),
      lastTouchedAt: Date.now(),
      maxRuntimeMs: resolveTaskRuntimeLimitMs(settings)
    });

    let result;
    try {
      result = await activeEngine().runPrompt({
        workspace: taskWorkspace,
        sessionId: session.id,
        conversationId: "",
        prompt: normalizedPrompt,
        settings,
        attachments,
        signal: controller.signal,
        requestToolPermission: (call) => {
          touchActivePromptController(session.id);
          return requestToolPermission(call, (event) => {
            touchActivePromptController(session.id);
            sendAgentEvent({
              sessionId: session.id,
              ...event
            });
          });
        },
        onEvent: (event) => {
          touchActivePromptController(session.id);
          sendAgentEvent({
            sessionId: session.id,
            ...event
          });
        },
        sessionMeta: {
          contextSummary: session.contextSummary || ""
        },
        history: session.history
      });
    } finally {
      activePromptControllers.delete(session.id);
    }

    if (userAbortedSessions.has(session.id)) {
      userAbortedSessions.delete(session.id);
      result = {
        ...result,
        ok: false,
        exitCode: 130,
        text: "已手动停止本轮任务。",
        error: "aborted_by_user"
      };
    }

    if (!String(result.text || "").trim()) {
      result.text = result.ok
        ? "本轮任务已结束，但没有生成最终文本结果。请查看上方工具步骤，并根据需要继续追问。"
        : "本轮任务执行失败，而且没有返回可显示的错误文本。";
    }
    result.text = buildSessionClosingSummaryV2(result, normalizedPrompt);

    if (result.usedModel) {
      savePreferredModelIfChanged(result.usedModel);
    }

    store.updateSessionMeta(session.id, {
      actualModel: result.usedModel || settings.vgoAI?.preferredModel || settings.remote?.model || "",
      actualChannel: result.actualChannel || "",
      actualContextWindow:
        Number(result.actualContextWindow) ||
        resolveModelContextWindow(settings, result.usedModel || settings.vgoAI?.preferredModel),
      usageInputTokens: Number(result.usageInputTokens) || 0,
      usageOutputTokens: Number(result.usageOutputTokens) || 0,
      usageTotalTokens: Number(result.usageTotalTokens) || 0
    });

    for (const event of result.rawEvents || []) {
      const message = formatAgentEvent(event);
      if (!message) {
        continue;
      }
      store.appendHistory("system", message, event.ok === false ? "error" : "done");
    }

    store.appendHistory("assistant", result.text, result.ok ? "done" : "error");
    sendAgentEvent({
      sessionId: session.id,
      type: "task_status",
      status: result.ok ? "completed" : "failed",
      message: result.ok ? "Agent 已完成本轮任务。" : "Agent 本轮任务执行失败。",
      taskWorkspace
    });
    if (compression?.compressed) {
      store.appendHistory(
        "system",
        `已自动压缩上下文：${compression.estimatedBefore} -> ${compression.estimatedAfter} tokens，当前阈值 ${compression.thresholdTokens} tokens`,
        "done"
      );
    }
    return result;
  });

  ipcMain.handle("chat:abort", () => {
    const session = store.getActiveSession();
    if (!session) {
      return { ok: false, reason: "no_active_session" };
    }

    const controller = activePromptControllers.get(session.id);
    if (!controller) {
      const fallback = [...activePromptControllers.entries()][0];
      if (!fallback) {
        return { ok: false, reason: "no_active_prompt" };
      }
      const [fallbackSessionId, fallbackController] = fallback;
      userAbortedSessions.add(fallbackSessionId);
      fallbackController.controller.abort(new Error("aborted_by_user"));
      activePromptControllers.delete(fallbackSessionId);
      sendAgentEvent({
        sessionId: fallbackSessionId,
        type: "task_status",
        status: "failed",
        message: "已手动停止本轮任务。"
      });
      return { ok: true, sessionId: fallbackSessionId };
    }

    userAbortedSessions.add(session.id);
    controller.controller.abort(new Error("aborted_by_user"));
    activePromptControllers.delete(session.id);
    sendAgentEvent({
      sessionId: session.id,
      type: "task_status",
      status: "failed",
      message: "已手动停止本轮任务。"
    });
    return { ok: true };
  });

  ipcMain.handle("chat:resetSession", () => {
    const sessionId = store.resetActiveSession();
    return { sessionId, state: serializeState() };
  });
  ipcMain.handle("chat:createSession", () => ({
    session: store.createAndActivateSession(settings.workspace || null),
    state: serializeState()
  }));
  ipcMain.handle("chat:switchSession", (_event, sessionId) => {
    const result = store.switchSession(sessionId);
    return result ? { state: result } : null;
  });
  ipcMain.handle("chat:renameSession", (_event, payload) => {
    store.renameSession(payload.sessionId, payload.title);
    return { state: serializeState() };
  });
  ipcMain.handle("chat:togglePinSession", (_event, sessionId) => {
    store.togglePinSession(sessionId);
    return { state: serializeState() };
  });
  ipcMain.handle("chat:deleteSession", (_event, sessionId) => {
    store.deleteSession(sessionId);
    return { state: serializeState() };
  });
  ipcMain.handle("chat:updateSession", (_event, payload) => {
    store.updateSessionMeta(payload.sessionId, payload);
    return { state: serializeState() };
  });
  ipcMain.handle("chat:clearHistory", () => {
    store.clearActiveHistory();
    return { ok: true };
  });

  ipcMain.handle("workspace:analyze", async () => {
    const workspace = store.getState().workspace;
    if (!workspace) {
      return { ok: false, error: "no_workspace", summary: "请先选择工作区目录。" };
    }
    
    const result = analyzeWorkspace(workspace);
    store.appendHistory("system", result.summary);
    
    // Send event to update UI
    sendAgentEvent({
      type: "task_status",
      status: "completed",
      message: "工作区分析完成"
    });
    
    // Refresh state
    sendStateRefresh();
    
    return result;
  });

  ipcMain.handle("app:healthCheck", () =>
    activeEngine().runHealthCheck(store.getState().workspace, settings)
  );
  ipcMain.handle("history:export", () => exportHistory());

  ipcMain.handle("dialog:pickWorkspace", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    store.setWorkspace(result.filePaths[0]);
    return serializeState();
  });

  ipcMain.handle("dialog:pickFiles", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return result.filePaths.map((filePath) => readAttachmentPreview(filePath));
  });

  ipcMain.handle("attachments:remove", async (_event, index) => {
    if (typeof index !== "number" || index < 0) {
      return { ok: false, error: "Invalid attachment index" };
    }
    return { ok: true };
  });

  ipcMain.handle("auth:openLoginTerminal", () => {
    activeEngine().openLoginShell(store.getState().workspace, settings);
    return { ok: true };
  });

  ipcMain.handle("shell:openPath", (_event, target) => shell.openPath(target));
  ipcMain.handle("shell:openExternal", (_event, target) => shell.openExternal(target));

  ipcMain.handle("update:check", async (_event, payload = {}) => {
    const appVersion = app.getVersion();
    const updateUrl = payload.updateUrl || "https://vgoai.cn/downloads/vgo-code/version.json";
    const result = await checkForUpdates(appVersion, { updateUrl, force: payload.force || false });
    if (result.ok && result.updateAvailable && mainWindow) {
      lastDetectedUpdate = {
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
        downloadUrl: result.downloadUrl,
        releaseNotes: result.releaseNotes,
        releaseDate: result.releaseDate
      };
      sendUpdateEvent("update:available", lastDetectedUpdate);
    }
    return result;
  });

  ipcMain.handle("update:install", async (_event, payload = {}) => {
    return await installUpdatePackage(payload);
  });

  ipcMain.handle("update:skipVersion", (_event, version) => {
    skipVersion(version);
    return { ok: true };
  });

  ipcMain.handle("update:resetSkip", () => {
    resetSkipVersion();
    return { ok: true };
  });

  ipcMain.handle("update:setAutoCheck", (_event, enabled, intervalHours) => {
    setAutoCheck(enabled, intervalHours);
    return { ok: true };
  });

  ipcMain.handle("update:getSettings", () => {
    return getUpdateSettings();
  });

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
