const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { isVgoManagedCloudProfile, syncRemoteProfileState } = require("../core/settings");

function toBase64Url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isBigModelHost(requestUrl = "") {
  try { return /(^|\.)open\.bigmodel\.cn$/i.test(new URL(requestUrl).hostname); } catch { return /open\.bigmodel\.cn/i.test(requestUrl); }
}

function looksLikeBigModelApiKey(value = "") {
  return String(value || "").trim().includes(".") && String(value || "").trim().split(".").length === 2;
}

function buildBigModelJwtFromApiKey(apiKey = "") {
  const [apiKeyId, apiKeySecret] = String(apiKey || "").trim().split(".");
  if (!apiKeyId || !apiKeySecret) return String(apiKey || "").trim();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "HS256", sign_type: "SIGN" }));
  const payload = toBase64Url(JSON.stringify({ api_key: apiKeyId, exp: nowSeconds + 300, timestamp: Date.now() }));
  const data = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", apiKeySecret).update(data).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${data}.${signature}`;
}

function resolveCustomProviderAuthHeader(apiKey = "", requestUrl = "") {
  const rawApiKey = String(apiKey || "").trim();
  if (!rawApiKey || rawApiKey === "********") return "";
  return `Bearer ${isBigModelHost(requestUrl) && looksLikeBigModelApiKey(rawApiKey) ? buildBigModelJwtFromApiKey(rawApiKey) : rawApiKey}`;
}

function normalizeExternalModelId(modelId = "") {
  const raw = String(modelId || "").trim();
  if (!raw) return raw;
  return /^glm[-_.]/i.test(raw) ? raw.replace(/_/g, "-").toLowerCase() : raw;
}

function normalizeModelCatalogCandidates(baseUrl = "", modelListUrl = "") {
  const candidates = [];
  const append = (url) => { const cleaned = String(url || "").trim().replace(/\/+$/, ""); if (!cleaned || candidates.includes(cleaned)) return; candidates.push(cleaned); };
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  const normalizedModelListUrl = String(modelListUrl || "").trim().replace(/\/+$/, "");
  if (normalizedModelListUrl) {
    if (!/\/chat\/completions$/i.test(normalizedModelListUrl)) append(normalizedModelListUrl);
    if (/\/chat\/completions$/i.test(normalizedModelListUrl) || /\/v1\/chat\/completions$/i.test(normalizedModelListUrl)) append(normalizedModelListUrl.replace(/\/chat\/completions$/i, "/models"));
  }
  if (normalizedBaseUrl) {
    if (/\/chat\/completions$/i.test(normalizedBaseUrl)) { const parent = normalizedBaseUrl.replace(/\/chat\/completions$/i, ""); append(`${parent}/models`); append(`${parent}/v1/models`); }
    else if (/\/v1$/i.test(normalizedBaseUrl)) append(`${normalizedBaseUrl}/models`);
    else { append(`${normalizedBaseUrl}/v1/models`); append(`${normalizedBaseUrl}/models`); }
  }
  return candidates;
}

function normalizeUrlForCompare(input = "") {
  return String(input || "").trim().replace(/\/+$/, "").toLowerCase();
}

function installWhisperRuntime() {
  const result = spawnSync("python", ["-m", "pip", "install", "-U", "openai-whisper"], { encoding: "utf8", shell: false, timeout: 3_600_000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
  const output = [String(result.stdout || "").trim(), String(result.stderr || "").trim()].filter(Boolean).join("\n");
  return { ok: result.status === 0, exitCode: result.status, summary: result.status === 0 ? "Whisper runtime installed successfully." : `Whisper install exited with code ${result.status}.`, output };
}

function serializeSettings(settings) {
  return {
    permissions: { ...settings.permissions },
    access: { ...settings.access },
    appearance: { ...settings.appearance },
    localization: { ...settings.localization },
    behavior: { ...settings.behavior },
    agent: { ...settings.agent },
    skills: { ...settings.skills },
    remote: { ...settings.remote, apiKey: settings.remote.apiKey ? "********" : "" },
    remoteProfiles: (settings.remoteProfiles || []).map((profile) => ({ ...profile, apiKey: profile.apiKey ? "********" : "" })),
    activeRemoteProfileId: settings.activeRemoteProfileId,
    vgoAI: { ...settings.vgoAI, accessToken: settings.vgoAI.accessToken ? "********" : "", hasAccessToken: Boolean(settings.vgoAI.accessToken) }
  };
}

function mergeSettingsSection(settings, key, payload = {}) {
  return { ...settings, [key]: { ...(settings[key] || {}), ...payload } };
}

function resolveProfileName(profile, fallbackEmail) {
  return profile?.displayName || profile?.nickname || profile?.name || profile?.username || profile?.email || fallbackEmail || "VGO AI Developer";
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const text = await response.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch { throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`); }
  if (!response.ok) {
    const message = payload?.message || payload?.error || payload?.msg || payload?.detail || payload?.data?.message || payload?.data?.error || `http_${response.status}`;
    throw new Error(`${typeof message === "string" ? message : JSON.stringify(message)} (status ${response.status})`);
  }
  return payload;
}

function extractAccessToken(loginPayload = {}) {
  return loginPayload.accessToken || loginPayload.access_token || loginPayload.token || loginPayload.jwt || loginPayload?.data?.accessToken || loginPayload?.data?.access_token || loginPayload?.data?.token || loginPayload?.data?.jwt || loginPayload?.result?.accessToken || loginPayload?.result?.token || "";
}

async function requestRealVgoAiLogin(email, password) {
  const endpoints = ["https://vgoai.cn/api/v1/auth/login", "https://vgoai.cn/api/auth/login", "https://vgoai.cn/auth/login"];
  const payloadVariants = [{ email, password }, { account: email, password }, { username: email, password }, { login: email, password }, { identifier: email, password }];
  let lastError = null;
  for (const endpoint of endpoints) { for (const payload of payloadVariants) { try { return await fetchJson(endpoint, { method: "POST", headers: { Accept: "application/json, text/plain, */*" }, body: JSON.stringify(payload) }); } catch (error) { lastError = error; } } }
  throw lastError || new Error("login_request_failed");
}

async function fetchVgoAiProfile(accessToken) {
  const payload = await fetchJson("https://vgoai.cn/api/v1/user/profile", { headers: { Authorization: `Bearer ${accessToken}` } });
  return payload.user || payload.data || payload.profile || payload;
}

async function fetchRealVgoModels(accessToken) {
  const payload = await fetchJson("https://vgoai.cn/api/v1/chat/models", { headers: { Authorization: `Bearer ${accessToken}` } });
  const items = payload?.data || payload?.items || payload?.models || [];
  return Array.isArray(items) ? items.map((item) => ({ id: item.id, label: item.name || item.label || item.id, description: item.description || "", contextWindow: Number(item.contextWindow || item.contextTokens || item.maxContextTokens || item.max_input_tokens || item.maxTokens || 0) })) : [];
}

function mapGenericModelCatalog(payload = {}) {
  const items = payload?.items || payload?.data || payload?.models || [];
  return Array.isArray(items) ? items.map((item) => ({ id: String(item?.id || "").trim(), label: String(item?.name || item?.label || item?.id || "").trim(), description: String(item?.description || ""), contextWindow: Number(item?.contextWindow || item?.contextTokens || item?.maxContextTokens || item?.max_input_tokens || item?.maxTokens || 0) })).filter((item) => item.id).map((item) => ({ ...item, label: item.label || item.id })) : [];
}

async function fetchRemoteProfileModelCatalog(profile = {}) {
  if (!profile) return [];
  const baseUrl = String(profile.baseUrl || "").trim().replace(/\/+$/, "");
  const modelListUrl = String(profile.modelListUrl || "").trim();
  const apiKey = String(profile.apiKey || "").trim();

  // Ollama: use /api/tags
  const lower = baseUrl.toLowerCase();
  if (/localhost:11434|127\.0\.0\.1:11434/.test(lower) || String(profile.provider || "").toLowerCase().includes("ollama")) {
    try {
      const ollamaUrl = /\/api\/tags$/.test(lower) ? baseUrl : `${baseUrl}/api/tags`;
      const payload = await fetchJson(ollamaUrl, {});
      const models = Array.isArray(payload?.models) ? payload.models.map((m) => ({ id: String(m?.name || "").trim(), label: String(m?.name || "").trim() })).filter((m) => m.id) : [];
      if (models.length) return models;
    } catch { return []; }
    return [];
  }

  if (!baseUrl && !modelListUrl) return [];
  const candidates = normalizeModelCatalogCandidates(baseUrl, modelListUrl);
  let lastError = null;
  for (const url of candidates) {
    try {
      const headers = {};
      const authHeader = resolveCustomProviderAuthHeader(apiKey, url);
      if (authHeader) headers.Authorization = authHeader;
      const payload = await fetchJson(url, { headers });
      const models = mapGenericModelCatalog(payload);
      if (models.length) return models;
    } catch (error) { lastError = error; }
  }
  if (lastError) throw lastError;
  return [];
}

function createAuthWindow(authWindow, loginUrl, setBrowserAuthState, AUTH_PARTITION, BrowserWindow) {
  if (authWindow && !authWindow.isDestroyed()) { authWindow.focus(); return authWindow; }
  const win = new BrowserWindow({ width: 980, height: 760, minWidth: 860, minHeight: 640, title: "登录 VGO AI", modal: false, autoHideMenuBar: true, backgroundColor: "#0f172a", webPreferences: { partition: AUTH_PARTITION + "-" + Date.now(), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  win.on("closed", () => { const wasSuccess = false; if (win) { /* closed */ } });
  win.loadURL(loginUrl);
  return win;
}

function registerHandlers(ipcMain, ctx) {
  const { loadSettings, saveSettings, DEFAULT_PROFILE_ID, buildGuestModelCatalog } = require("../core/settings");
  const { getEngine, listEngines } = require("../core/engineRegistry");
  const { listInstalledSkills, installSkillFromSource } = require("../core/localSkillDiscovery");
  const { resolveModelContextWindow } = require("../core/contextCompression");

  let settingsWriteQueue = Promise.resolve();
  function saveAllSettings(nextSettings) {
    ctx.setSettings(nextSettings);
    settingsWriteQueue = settingsWriteQueue.then(() => saveSettings(nextSettings));
    return settingsWriteQueue;
  }

  function serializeState() {
    const state = ctx.store.serialize();
    state.engines = listEngines();
    state.settings = serializeSettings(ctx.getSettings());
    state.mockServerInfo = ctx.mockServerInfo;
    state.skills = listInstalledSkills(ctx.getSettings());
    const activeSession = ctx.store.getActiveSession();
    const preferredModel = activeSession?.actualModel || ctx.getSettings().vgoAI?.preferredModel || ctx.getSettings().remote?.model;
    const contextWindow = activeSession?.actualContextWindow || resolveModelContextWindow(ctx.getSettings(), preferredModel);
    const estimatedTokens = activeSession?.usageTotalTokens || (activeSession ? (() => { try { return require("../core/contextCompression").estimateSessionTokens(activeSession); } catch { return 0; } })() : 0);
    const thresholdRatio = (() => { try { return require("../core/contextCompression").resolveCompressionThresholdRatio(ctx.getSettings()); } catch { return 0.85; } })();
    const thresholdTokens = Math.floor(contextWindow * thresholdRatio);
    const usagePercent = thresholdTokens > 0 ? Math.min(100, Math.round((estimatedTokens / thresholdTokens) * 100)) : 0;
    state.contextStats = { estimatedTokens, thresholdTokens, contextWindow, usageSource: activeSession?.usageTotalTokens ? "provider" : "estimated", thresholdRatio, usagePercent, remainingTokens: Math.max(0, thresholdTokens - estimatedTokens), compressionCount: Number(activeSession?.compressionCount) || 0, lastCompressionAt: activeSession?.lastCompressionAt || "" };
    return state;
  }

  function setRuntimeToRemoteEngine() { ctx.setRuntimeEngine("vgo-remote"); }

  function applyRealVgoAiSession({ email = "", displayName, preferredModel, accessToken, profile = null, modelCatalog = [], rememberedPassword = ctx.getSettings().vgoAI.rememberedPassword, rememberPassword = ctx.getSettings().vgoAI.rememberPassword }) {
    const activeProfile = (ctx.getSettings().remoteProfiles || []).find((item) => item.id === ctx.getSettings().activeRemoteProfileId) || null;
    const activeIsRemote = !activeProfile || ctx.resolveEngineIdForProfile(activeProfile) !== "ollama";
    let nextSettings = { ...ctx.getSettings(), vgoAI: { ...ctx.getSettings().vgoAI, loggedIn: true, email, rememberedPassword: rememberPassword ? rememberedPassword || "" : "", rememberPassword, displayName, accessToken, preferredModel, linkedAt: new Date().toISOString(), profile, modelCatalog: modelCatalog.length ? modelCatalog : ctx.getSettings().vgoAI.modelCatalog } };
    if (activeIsRemote) nextSettings = syncRemoteProfileState(nextSettings, { ...nextSettings.remote, model: preferredModel }, {}, nextSettings.vgoAI);
    saveAllSettings(nextSettings);
    if (activeIsRemote) setRuntimeToRemoteEngine();
  }

  function clearRealVgoAiSession() {
    const guestCatalog = buildGuestModelCatalog();
    const clearedProfiles = (ctx.getSettings().remoteProfiles || []).map((profile) => isVgoManagedCloudProfile(profile) ? { ...profile, modelCatalog: [], model: profile.id === DEFAULT_PROFILE_ID ? "vgo-coder-pro" : profile.model } : profile);
    const activeProfile = clearedProfiles.find((item) => item.id === ctx.getSettings().activeRemoteProfileId) || clearedProfiles[0] || null;
    const activeProfileIsRemote = activeProfile && ctx.resolveEngineIdForProfile(activeProfile) !== "ollama";
    saveAllSettings({ ...ctx.getSettings(), remoteProfiles: clearedProfiles, remote: activeProfileIsRemote ? { ...ctx.getSettings().remote, provider: activeProfile.provider || ctx.getSettings().remote.provider, baseUrl: activeProfile.baseUrl || ctx.getSettings().remote.baseUrl, modelListUrl: activeProfile.modelListUrl || ctx.getSettings().remote.modelListUrl || "", model: activeProfile.model || "vgo-coder-pro", apiKey: activeProfile.apiKey, systemPrompt: activeProfile.systemPrompt } : ctx.getSettings().remote, vgoAI: { ...ctx.getSettings().vgoAI, loggedIn: false, email: "", displayName: "Guest", accessToken: "", preferredModel: "vgo-coder-pro", linkedAt: "", profile: null, modelCatalog: guestCatalog } });
  }

  async function validateStoredRealLogin() {
    if (!ctx.getSettings().vgoAI?.loggedIn || !ctx.getSettings().vgoAI?.accessToken) return;
    if (String(ctx.getSettings().vgoAI.accessToken).startsWith("vgo-local-")) { clearRealVgoAiSession(); return; }
    try {
      const profile = await fetchVgoAiProfile(ctx.getSettings().vgoAI.accessToken);
      saveAllSettings({ ...ctx.getSettings(), vgoAI: { ...ctx.getSettings().vgoAI, displayName: resolveProfileName(profile, ctx.getSettings().vgoAI.email), profile } });
    } catch (error) {
      clearRealVgoAiSession();
      ctx.setBrowserAuthState({ status: "error", message: `登录态已失效（${error.message}），请重新登录。` });
      ctx.mainWindow?.webContents?.send("auth:stateUpdate", { status: "logged_out", reason: "token_invalid", message: "登录态已失效，请重新登录。" });
    }
  }

  async function clearAuthBrowserSession() {
    try { await require("electron").session.fromPartition(ctx.AUTH_PARTITION).clearStorageData({ storages: ["cookies", "localstorage", "indexdb", "serviceworkers", "cachestorage"] }); } catch {}
  }

  function savePreferredModelIfChanged(modelId) {
    if (!modelId) return;
    const activeProfile = (ctx.getSettings().remoteProfiles || []).find((item) => item.id === ctx.getSettings().activeRemoteProfileId) || null;
    const activeIsRemote = !activeProfile || ctx.resolveEngineIdForProfile(activeProfile) !== "ollama";
    if (!activeIsRemote || ctx.getSettings().vgoAI.preferredModel === modelId) return;
    let nextSettings = { ...ctx.getSettings(), vgoAI: { ...ctx.getSettings().vgoAI, preferredModel: modelId } };
    if (activeIsRemote) nextSettings = syncRemoteProfileState(nextSettings, { ...nextSettings.remote, model: modelId }, {});
    saveAllSettings(nextSettings);
  }

  async function loginRealVgoAi(payload = {}) {
    const email = (payload.email || "").trim();
    const password = payload.password || "";
    const preferredModel = payload.preferredModel || "vgo-coder-pro";
    if (!email || !password) throw new Error("请输入网页登录账号对应的邮箱和密码。");
    const loginPayload = await requestRealVgoAiLogin(email, password);
    const accessToken = extractAccessToken(loginPayload);
    if (!accessToken) throw new Error("登录接口未返回有效 accessToken。");
    const profile = loginPayload.user || (await fetchVgoAiProfile(accessToken));
    const modelCatalog = await fetchRealVgoModels(accessToken).catch(() => []);
    applyRealVgoAiSession({ email, displayName: resolveProfileName(profile, email), preferredModel, accessToken, profile: profile || null, modelCatalog, rememberedPassword: payload.password || ctx.getSettings().vgoAI.rememberedPassword, rememberPassword: payload.rememberPassword ?? ctx.getSettings().vgoAI.rememberPassword });
    return serializeState();
  }

  async function validateStoredLogin() { await validateStoredRealLogin(); }
  validateStoredLogin();

  const browserAuthStateFlag = { value: false };

  ipcMain.handle("logs:normalizeEngine", () => { const { normalizeEngineLogFile } = require("../core/engineLog"); normalizeEngineLogFile(path.join(process.cwd(), "logs", "agent.log")); });

  ipcMain.handle("runtime:installWhisper", () => installWhisperRuntime());
  ipcMain.handle("runtime:installSkill", (_event, payload = {}) => { const result = installSkillFromSource(payload.sourcePath, payload.name); ctx.sendStateRefresh(); return result; });

  ipcMain.handle("settings:get", () => serializeSettings(ctx.getSettings()));

  ipcMain.handle("settings:updateAppearance", (_event, payload = {}) => {
    saveAllSettings(mergeSettingsSection(ctx.getSettings(), "appearance", { theme: payload.theme || ctx.getSettings().appearance?.theme || "paper-light", uiMode: payload.uiMode || ctx.getSettings().appearance?.uiMode || "standard", compactMode: typeof payload.compactMode === "boolean" ? payload.compactMode : ctx.getSettings().appearance?.compactMode, messageDensity: payload.messageDensity || ctx.getSettings().appearance?.messageDensity || "comfortable" }));
    return serializeState();
  });

  ipcMain.handle("settings:updateLocalization", (_event, payload = {}) => {
    saveAllSettings(mergeSettingsSection(ctx.getSettings(), "localization", { locale: payload.locale === "en-US" ? "en-US" : "zh-CN" }));
    return serializeState();
  });

  ipcMain.handle("settings:updateBehavior", (_event, payload = {}) => {
    saveAllSettings(mergeSettingsSection(ctx.getSettings(), "behavior", { enterToSend: typeof payload.enterToSend === "boolean" ? payload.enterToSend : ctx.getSettings().behavior?.enterToSend, autoScroll: typeof payload.autoScroll === "boolean" ? payload.autoScroll : ctx.getSettings().behavior?.autoScroll, showTaskPanel: typeof payload.showTaskPanel === "boolean" ? payload.showTaskPanel : ctx.getSettings().behavior?.showTaskPanel, confirmDangerousOps: typeof payload.confirmDangerousOps === "boolean" ? payload.confirmDangerousOps : ctx.getSettings().behavior?.confirmDangerousOps }));
    return serializeState();
  });

  ipcMain.handle("settings:updateAgentPreferences", (_event, payload = {}) => {
    saveAllSettings(mergeSettingsSection(ctx.getSettings(), "agent", { autoSummarizeContext: typeof payload.autoSummarizeContext === "boolean" ? payload.autoSummarizeContext : ctx.getSettings().agent?.autoSummarizeContext, contextCompressionThreshold: typeof payload.contextCompressionThreshold === "number" ? Math.max(0.5, Math.min(0.98, payload.contextCompressionThreshold)) : ctx.getSettings().agent?.contextCompressionThreshold, showRuntimeMeta: typeof payload.showRuntimeMeta === "boolean" ? payload.showRuntimeMeta : ctx.getSettings().agent?.showRuntimeMeta, showExecutionPlan: typeof payload.showExecutionPlan === "boolean" ? payload.showExecutionPlan : ctx.getSettings().agent?.showExecutionPlan, fallbackModel: typeof payload.fallbackModel === "string" ? payload.fallbackModel.trim() : ctx.getSettings().agent?.fallbackModel, suggestSkillAugmentation: typeof payload.suggestSkillAugmentation === "boolean" ? payload.suggestSkillAugmentation : ctx.getSettings().agent?.suggestSkillAugmentation, autoSearchSkillsOnApproval: typeof payload.autoSearchSkillsOnApproval === "boolean" ? payload.autoSearchSkillsOnApproval : ctx.getSettings().agent?.autoSearchSkillsOnApproval, maxToolSteps: typeof payload.maxToolSteps === "number" ? Math.max(20, Math.min(300, Math.floor(payload.maxToolSteps))) : ctx.getSettings().agent?.maxToolSteps, maxTaskRuntimeMinutes: typeof payload.maxTaskRuntimeMinutes === "number" ? Math.max(30, Math.min(720, Math.floor(payload.maxTaskRuntimeMinutes))) : ctx.getSettings().agent?.maxTaskRuntimeMinutes }));
    return serializeState();
  });

  ipcMain.handle("settings:updateSkillState", (_event, payload = {}) => {
    const skillId = String(payload.id || "").trim();
    if (!skillId) return { ok: false, error: "missing_skill_id" };
    const disabled = new Set(ctx.getSettings().skills?.disabled || []);
    if (payload.enabled === false) disabled.add(skillId); else disabled.delete(skillId);
    saveAllSettings({ ...ctx.getSettings(), skills: { ...(ctx.getSettings().skills || {}), disabled: [...disabled].sort() } });
    return serializeState();
  });

  ipcMain.handle("settings:updateRemote", (_event, payload) => {
    const nextRemote = { ...ctx.getSettings().remote, ...payload, model: normalizeExternalModelId(payload.model || ctx.getSettings().remote.model), apiKey: typeof payload.apiKey === "string" && payload.apiKey.trim() === "********" ? ctx.getSettings().remote.apiKey : payload.apiKey };
    const extraProfileFields = {};
    if ((payload.name || "").trim()) extraProfileFields.name = payload.name.trim();
    if ((payload.provider || "").trim()) extraProfileFields.provider = payload.provider.trim();
    saveAllSettings(syncRemoteProfileState(ctx.getSettings(), nextRemote, extraProfileFields));
    return serializeState();
  });

  ipcMain.handle("settings:updatePermissions", (_event, payload = {}) => { saveAllSettings({ ...ctx.getSettings(), permissions: { ...ctx.getSettings().permissions, mode: payload.mode === "full" ? "full-access" : "default" } }); return serializeState(); });
  ipcMain.handle("settings:updateAccess", (_event, payload = {}) => { const allowedScopes = new Set(["workspace-only", "workspace-and-desktop", "full-system"]); saveAllSettings({ ...ctx.getSettings(), access: { ...ctx.getSettings().access, scope: allowedScopes.has(payload.scope) ? payload.scope : "workspace-and-desktop" } }); return serializeState(); });

  ipcMain.handle("settings:createRemoteProfile", async (_event, payload = {}) => {
    const profileId = `profile-${Date.now()}`;
    const normalizedProvider = (payload.provider || "").trim() || "VGO Remote";
    const incomingApiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
    const currentApiKey = String(ctx.getSettings().remote.apiKey || "").trim();
    const resolvedApiKey = incomingApiKey === "********" ? (currentApiKey === "********" ? "" : currentApiKey) : incomingApiKey;
    const profile = { id: profileId, name: (payload.name || "").trim() || `远程配置 ${(ctx.getSettings().remoteProfiles || []).length + 1}`, provider: normalizedProvider, baseUrl: payload.baseUrl || ctx.getSettings().remote.baseUrl, modelListUrl: payload.modelListUrl || "", modelCatalog: Array.isArray(payload.modelCatalog) ? payload.modelCatalog : [], model: normalizeExternalModelId(payload.model || ctx.getSettings().remote.model), apiKey: resolvedApiKey, systemPrompt: payload.systemPrompt || ctx.getSettings().remote.systemPrompt };
    saveAllSettings({ ...ctx.getSettings(), remote: { provider: profile.provider || "VGO Remote", baseUrl: profile.baseUrl, modelListUrl: profile.modelListUrl || "", model: profile.model, apiKey: profile.apiKey, systemPrompt: profile.systemPrompt }, remoteProfiles: [...(ctx.getSettings().remoteProfiles || []), profile], activeRemoteProfileId: profileId });
    ctx.applyRuntimeForProfile(profile);
    return serializeState();
  });

  ipcMain.handle("settings:updateRemoteProfile", async (_event, payload = {}) => {
    const profileId = payload.id;
    const profile = (ctx.getSettings().remoteProfiles || []).find((item) => item.id === profileId);
    if (!profile) return serializeState();
    const incomingApiKey = typeof payload.apiKey === "string" ? payload.apiKey : null;
    const nextApiKey = incomingApiKey === null ? profile.apiKey : incomingApiKey.trim() === "********" ? profile.apiKey : incomingApiKey;
    const nextProvider = (payload.provider || "").trim() || profile.provider || "VGO Remote";
    const baseUrlFromPayload = payload.baseUrl || profile.baseUrl;
    const modelListUrlFromPayload = typeof payload.modelListUrl === "string" ? payload.modelListUrl : profile.modelListUrl || "";
    const endpointChanged = String(profile.provider || "") !== String(nextProvider || "") || normalizeUrlForCompare(profile.baseUrl) !== normalizeUrlForCompare(baseUrlFromPayload) || normalizeUrlForCompare(profile.modelListUrl) !== normalizeUrlForCompare(modelListUrlFromPayload);
    const nextProfile = { ...profile, name: (payload.name || "").trim() || profile.name, provider: nextProvider, baseUrl: baseUrlFromPayload, modelListUrl: modelListUrlFromPayload, modelCatalog: Array.isArray(payload.modelCatalog) ? payload.modelCatalog : endpointChanged ? [] : profile.modelCatalog || [], model: normalizeExternalModelId(payload.model || profile.model), apiKey: nextApiKey, systemPrompt: typeof payload.systemPrompt === "string" ? payload.systemPrompt : profile.systemPrompt };
    const nextProfiles = (ctx.getSettings().remoteProfiles || []).map((item) => item.id === profileId ? nextProfile : item);
    const shouldActivate = payload.activate === true || ctx.getSettings().activeRemoteProfileId === profileId;
    saveAllSettings({ ...ctx.getSettings(), remoteProfiles: nextProfiles, remote: shouldActivate ? { provider: nextProfile.provider || "VGO Remote", baseUrl: nextProfile.baseUrl, modelListUrl: nextProfile.modelListUrl || "", model: nextProfile.model, apiKey: nextProfile.apiKey, systemPrompt: nextProfile.systemPrompt } : ctx.getSettings().remote });
    if (shouldActivate) ctx.applyRuntimeForProfile(nextProfile);
    return serializeState();
  });

  ipcMain.handle("settings:selectRemoteProfile", async (_event, profileId) => {
    const profile = (ctx.getSettings().remoteProfiles || []).find((item) => item.id === profileId);
    if (!profile) return serializeState();
    saveAllSettings({ ...ctx.getSettings(), activeRemoteProfileId: profileId, remote: { provider: profile.provider || "VGO Remote", baseUrl: profile.baseUrl, modelListUrl: profile.modelListUrl || "", model: profile.model, apiKey: profile.apiKey, systemPrompt: profile.systemPrompt } });
    ctx.applyRuntimeForProfile(profile);
    return serializeState();
  });

  ipcMain.handle("settings:refreshRemoteProfileModels", async (_event, profileId) => {
    const profile = (ctx.getSettings().remoteProfiles || []).find((item) => item.id === profileId);
    if (!profile) return serializeState();
    const models = await fetchRemoteProfileModelCatalog(profile).catch(() => []);
    const resolvedModel = profile.model && models.some((item) => item.id === profile.model) ? profile.model : models.length ? models[0].id : profile.model;
    const nextProfiles = (ctx.getSettings().remoteProfiles || []).map((item) => item.id === profileId ? { ...item, modelCatalog: models, model: resolvedModel } : item);
    const isActive = ctx.getSettings().activeRemoteProfileId === profileId;
    const activeProfile = nextProfiles.find((item) => item.id === ctx.getSettings().activeRemoteProfileId) || nextProfiles[0];
    saveAllSettings({ ...ctx.getSettings(), remoteProfiles: nextProfiles, remote: isActive ? { ...ctx.getSettings().remote, provider: activeProfile.provider || ctx.getSettings().remote.provider, baseUrl: activeProfile.baseUrl || ctx.getSettings().remote.baseUrl, modelListUrl: activeProfile.modelListUrl || ctx.getSettings().remote.modelListUrl || "", model: activeProfile.model || ctx.getSettings().remote.model, apiKey: activeProfile.apiKey, systemPrompt: activeProfile.systemPrompt } : ctx.getSettings().remote });
    return serializeState();
  });

  ipcMain.handle("settings:deleteRemoteProfile", (_event, profileId) => {
    const profiles = (ctx.getSettings().remoteProfiles || []).filter((item) => item.id !== profileId);
    const nextProfiles = profiles.length ? profiles : [{ id: "default", name: "默认 VGO AI", provider: "VGO Remote", baseUrl: ctx.getSettings().remote.baseUrl, modelListUrl: ctx.getSettings().remote.modelListUrl || "", modelCatalog: [], model: ctx.getSettings().remote.model, apiKey: ctx.getSettings().remote.apiKey, systemPrompt: ctx.getSettings().remote.systemPrompt }];
    const activeProfile = nextProfiles.find((item) => item.id === ctx.getSettings().activeRemoteProfileId) || nextProfiles[0];
    saveAllSettings({ ...ctx.getSettings(), remoteProfiles: nextProfiles, activeRemoteProfileId: activeProfile.id, remote: { provider: activeProfile.provider || "VGO Remote", baseUrl: activeProfile.baseUrl, modelListUrl: activeProfile.modelListUrl || "", model: activeProfile.model, apiKey: activeProfile.apiKey, systemPrompt: activeProfile.systemPrompt } });
    ctx.applyRuntimeForProfile(activeProfile);
    return serializeState();
  });

  ipcMain.handle("settings:updateVgoAiProfile", (_event, payload) => {
    const profile = (ctx.getSettings().remoteProfiles || []).find((item) => item.id === ctx.getSettings().activeRemoteProfileId) || null;
    const activeIsRemote = !profile || ctx.resolveEngineIdForProfile(profile) !== "ollama";
    let nextSettings = { ...ctx.getSettings(), vgoAI: { ...ctx.getSettings().vgoAI, ...payload } };
    if (activeIsRemote && payload.preferredModel) nextSettings = syncRemoteProfileState(nextSettings, { ...nextSettings.remote, model: payload.preferredModel }, {});
    saveAllSettings(nextSettings);
    if (activeIsRemote) setRuntimeToRemoteEngine();
    return serializeState();
  });

  ipcMain.handle("settings:logoutVgoAi", async () => {
    clearRealVgoAiSession();
    if (ctx.authWindow && !ctx.authWindow.isDestroyed()) ctx.authWindow.close();
    await clearAuthBrowserSession().catch(() => {});
    ctx.sendStateRefresh();
    ctx.setBrowserAuthState({ status: "idle", message: "已退出登录。" });
    return serializeState();
  });

  ipcMain.handle("settings:bindVgoAi", () => ({ bound: !!(ctx.getSettings().vgoAI?.loggedIn && ctx.getSettings().vgoAI?.accessToken), email: ctx.getSettings().vgoAI?.email || "", displayName: ctx.getSettings().vgoAI?.displayName || "" }));
  ipcMain.handle("settings:loginAndBindVgoAi", (_event, payload) => loginRealVgoAi(payload));

  ipcMain.handle("settings:startBrowserVgoAiAuth", async (_event, payload = {}) => {
    const closePendingAuthServer = () => { if (ctx.pendingAuthServer) { try { ctx.pendingAuthServer.close(); } catch {} ctx.pendingAuthServer = null; } };
    const setBrowserAuthStateFn = ctx.setBrowserAuthState;
    closePendingAuthServer();
    clearRealVgoAiSession();
    ctx.authCheckInFlight = false;
    ctx.setBrowserAuthState({ status: "starting", message: "", loginUrl: "", redirectUri: "" });
    const displayName = (payload.displayName || "").trim() || "VGO AI Developer";
    const preferredModel = payload.preferredModel || "vgo-coder-pro";
    const server = http.createServer(async (req, res) => {
      const requestUrl = new URL(req.url, "http://127.0.0.1");
      if (requestUrl.pathname !== "/auth/callback") { res.writeHead(404); res.end("Not Found"); return; }
      const accessToken = requestUrl.searchParams.get("access_token") || requestUrl.searchParams.get("token") || "";
      if (!accessToken) {
        clearRealVgoAiSession();
        setBrowserAuthStateFn({ status: "error", message: "网页已回调，但没有返回 accessToken，桌面端仍保持未登录状态。" });
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!doctype html><html><body style=\"font-family:Segoe UI;padding:24px;background:#08111d;color:#e8eefc;\"><h2>VGO CODE 未完成授权</h2><p>网页没有回传 accessToken，因此桌面端不会写入登录状态。</p></body></html>");
        closePendingAuthServer();
        return;
      }
      try {
        const profile = await fetchVgoAiProfile(accessToken);
        const modelCatalog = await fetchRealVgoModels(accessToken).catch(() => []);
        applyRealVgoAiSession({ email: profile?.email || "", displayName: resolveProfileName(profile, payload.email || ""), preferredModel: requestUrl.searchParams.get("model") || preferredModel, accessToken, profile, modelCatalog, rememberedPassword: ctx.getSettings().vgoAI.rememberedPassword, rememberPassword: ctx.getSettings().vgoAI.rememberPassword });
        setBrowserAuthStateFn({ status: "success", message: "网页登录授权成功。", loginUrl: "", redirectUri: "" });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!doctype html><html><body style=\"font-family:Segoe UI;padding:24px;background:#08111d;color:#e8eefc;\"><h2>VGO CODE 登录成功</h2><p>授权已完成，现在可以回到桌面端继续使用。</p></body></html>");
        closePendingAuthServer();
      } catch (error) {
        clearRealVgoAiSession();
        setBrowserAuthStateFn({ status: "error", message: `已收到网页登录回调，但验证真实账户失败：${error.message}` });
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<!doctype html><html><body style=\"font-family:Segoe UI;padding:24px;background:#08111d;color:#e8eefc;\"><h2>VGO CODE 授权失败</h2><p>收到回调但无法验证真实账户信息，请回到桌面端重试。</p></body></html>");
        closePendingAuthServer();
      }
    });
    server.on("error", (error) => { clearRealVgoAiSession(); setBrowserAuthStateFn({ status: "error", message: `启动本地回调监听失败：${error.message}` }); closePendingAuthServer(); });
    await new Promise((resolve, reject) => { server.listen(0, "127.0.0.1", () => resolve()); server.once("error", reject); });
    ctx.pendingAuthServer = server;
    const address = server.address();
    const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
    const loginUrl = `https://vgoai.cn/login?redirect_uri=${encodeURIComponent(redirectUri)}&display_name=${encodeURIComponent(displayName)}&model=${encodeURIComponent(preferredModel)}`;
    ctx.setBrowserAuthState({ status: "waiting", message: "网页登录页已打开，正在等待授权回调。", loginUrl, redirectUri });
    try {
      if (ctx.authWindow && !ctx.authWindow.isDestroyed()) ctx.authWindow.close();
      const win = createAuthWindow(ctx.authWindow, loginUrl, setBrowserAuthStateFn, ctx.AUTH_PARTITION, ctx.BrowserWindow);
      ctx.authWindow = win;
      ctx.setBrowserAuthState({ status: "waiting", message: "网页登录窗口已打开，正在等待授权结果。", loginUrl, redirectUri });
      const authPollInterval = setInterval(async () => {
        if (!ctx.authWindow || ctx.authWindow.isDestroyed()) { clearInterval(authPollInterval); return; }
        try {
          const token = await (async () => {
            const cookies = await ctx.authWindow.webContents.session.cookies.get({ name: "token" });
            const cookieVal = cookies.find((item) => item.value)?.value;
            if (cookieVal) return cookieVal;
            try { const localVal = await ctx.authWindow.webContents.executeJavaScript("window.localStorage.getItem('token') || window.localStorage.getItem('accessToken') || ''", true); if (typeof localVal === "string" && localVal) return localVal; } catch {}
            return "";
          })();
          if (token) {
            try {
              const profile = await fetchVgoAiProfile(token);
              const modelCatalog = await fetchRealVgoModels(token).catch(() => []);
              applyRealVgoAiSession({ email: profile?.email || "", displayName: resolveProfileName(profile, ""), preferredModel, accessToken: token, profile, modelCatalog });
              setBrowserAuthStateFn({ status: "success", message: "网页登录授权成功。" });
              ctx.sendStateRefresh();
              if (ctx.authWindow && !ctx.authWindow.isDestroyed()) ctx.authWindow.close();
              clearInterval(authPollInterval);
            } catch (error) { clearInterval(authPollInterval); clearRealVgoAiSession(); setBrowserAuthStateFn({ status: "error", message: `已检测到登录态，但校验账户失败：${error.message}` }); }
          }
        } catch { clearInterval(authPollInterval); }
      }, 1500);
      win.on("closed", () => { clearInterval(authPollInterval); ctx.authWindow = null; });
      win.webContents.on("did-navigate", async () => {
        try {
          const cookies = await win.webContents.session.cookies.get({ name: "token" });
          const token = cookies.find((item) => item.value)?.value;
          if (token) {
            const profile = await fetchVgoAiProfile(token);
            const modelCatalog = await fetchRealVgoModels(token).catch(() => []);
            applyRealVgoAiSession({ email: profile?.email || "", displayName: resolveProfileName(profile, ""), preferredModel, accessToken: token, profile, modelCatalog });
            setBrowserAuthStateFn({ status: "success", message: "网页登录授权成功。" });
            clearInterval(authPollInterval);
            ctx.sendStateRefresh();
            if (ctx.authWindow && !ctx.authWindow.isDestroyed()) ctx.authWindow.close();
          }
        } catch {}
      });
    } catch (error) {
      clearRealVgoAiSession();
      ctx.setBrowserAuthState({ status: "error", message: `无法打开网页登录窗口：${error.message}`, loginUrl, redirectUri });
      closePendingAuthServer();
    }
    setTimeout(() => {
      if (ctx.pendingAuthServer === server && ctx.getBrowserAuthStatus?.().status === "waiting") {
        clearInterval(authPollInterval);
        clearRealVgoAiSession();
        ctx.setBrowserAuthState({ status: "timeout", message: "已打开网页登录页，但暂未收到有效回调。桌面端仍保持未登录状态。", loginUrl, redirectUri });
        closePendingAuthServer();
      }
    }, 180000);
    return { ok: false, pending: true, loginUrl, redirectUri, message: "网页登录页已打开，正在等待授权回调。" };
  });

  ipcMain.handle("settings:getBrowserAuthStatus", () => ({ status: ctx.browserAuthState?.status || "idle", message: ctx.browserAuthState?.message || "", loginUrl: ctx.browserAuthState?.loginUrl || "", redirectUri: ctx.browserAuthState?.redirectUri || "" }));

  ipcMain.handle("settings:openVgoAiLoginPage", async (_event, payload = {}) => {
    const displayName = (payload.displayName || "").trim() || "VGO AI Developer";
    const preferredModel = payload.preferredModel || "vgo-coder-pro";
    const redirectUri = "https://vgoai.cn/auth/callback/desktop";
    const loginUrl = `https://vgoai.cn/login?redirect_uri=${encodeURIComponent(redirectUri)}&display_name=${encodeURIComponent(displayName)}&model=${encodeURIComponent(preferredModel)}`;
    ctx.setBrowserAuthState({ status: "starting", message: "正在打开网页登录页面...", loginUrl, redirectUri });
    try { require("electron").shell.openExternal(loginUrl); } catch {}
    return { ok: true, loginUrl, redirectUri, message: "网页登录页已打开。" };
  });

  ipcMain.handle("settings:syncVgoAiModels", async () => {
    const { buildGuestModelCatalog } = require("../core/settings");
    if ((ctx.getSettings().vgoAI?.loggedIn && ctx.getSettings().vgoAI?.accessToken)) {
      const modelCatalog = await fetchRealVgoModels(ctx.getSettings().vgoAI.accessToken);
      saveAllSettings({ ...ctx.getSettings(), vgoAI: { ...ctx.getSettings().vgoAI, modelCatalog } });
    } else {
      saveAllSettings({ ...ctx.getSettings(), vgoAI: { ...ctx.getSettings().vgoAI, modelCatalog: buildGuestModelCatalog() } });
    }
    return serializeState();
  });

  ipcMain.handle("runtime:setEngine", (_event, engineId) => {
    const nextEngine = getEngine(engineId);
    ctx.store.setRuntime({ engineId: nextEngine.engineId, engineLabel: nextEngine.engineLabel, providerLabel: nextEngine.providerLabel });
    const remoteSettings = ctx.getSettings().remote;
    const activeProfileId = ctx.getSettings().activeRemoteProfileId;
    if (engineId === "vgo-remote" && !activeProfileId) {
      const profile = (ctx.getSettings().remoteProfiles || []).find((item) => item.id === "default") || (ctx.getSettings().remoteProfiles || []).find((item) => ctx.resolveEngineIdForProfile(item) === "vgo-remote") || null;
      if (profile) { saveAllSettings({ ...ctx.getSettings(), activeRemoteProfileId: profile.id, remote: { provider: profile.provider || "VGO Remote", baseUrl: profile.baseUrl, model: profile.model, apiKey: profile.apiKey, systemPrompt: profile.systemPrompt } }); }
    }
    ctx.setRuntimeEngine(engineId);
    return serializeState();
  });
}

module.exports = { registerHandlers };
