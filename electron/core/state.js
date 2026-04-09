const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { app } = require("electron");
const { tryRecoverMojibake } = require("./agentProtocol");

const DEFAULT_SESSION_TITLE = "新会话";

function isUsableWorkspace(targetPath) {
  try {
    return Boolean(targetPath && fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory());
  } catch {
    return false;
  }
}

function scoreWorkspaceCandidate(targetPath) {
  if (!isUsableWorkspace(targetPath)) {
    return -1;
  }

  let score = 0;
  const packageJson = path.join(targetPath, "package.json");
  const electronDir = path.join(targetPath, "electron");
  const uiDir = path.join(targetPath, "ui");
  const srcDir = path.join(targetPath, "src");

  if (fs.existsSync(packageJson)) score += 4;
  if (fs.existsSync(electronDir)) score += 3;
  if (fs.existsSync(uiDir)) score += 2;
  if (fs.existsSync(srcDir)) score += 1;
  return score;
}

function resolveDefaultWorkspace() {
  const candidates = [];
  const cwd = process.cwd();
  const appPath = app.getAppPath();
  const exeDir = path.dirname(app.getPath("exe"));
  const desktopDir = app.getPath("desktop");
  const documentsDir = app.getPath("documents");
  const homeDir = app.getPath("home");

  candidates.push(cwd, appPath, exeDir, desktopDir, documentsDir);

  let bestPath = desktopDir;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = scoreWorkspaceCandidate(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestPath = candidate;
    }
  }

  if (bestPath === homeDir && isUsableWorkspace(desktopDir)) {
    return desktopDir;
  }

  return bestPath || cwd || desktopDir;
}

function normalizeWorkspace(workspace) {
  const homeDir = app.getPath("home");
  if (!isUsableWorkspace(workspace)) {
    return resolveDefaultWorkspace();
  }

  const normalized = path.resolve(workspace);
  if (path.resolve(homeDir) === normalized) {
    return resolveDefaultWorkspace();
  }

  return normalized;
}

function sanitizeStoredText(value) {
  return tryRecoverMojibake(String(value || ""))
    .replace(/\uFFFD/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
}

function normalizeHistoryEntry(entry = {}) {
  return {
    id: entry.id || crypto.randomUUID(),
    role: entry.role || "assistant",
    text: sanitizeStoredText(entry.text),
    status: entry.status || "done",
    createdAt: entry.createdAt || new Date().toISOString()
  };
}

function createSession(title = DEFAULT_SESSION_TITLE, directory = null) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    directory: directory || null,
    manualTitle: false,
    history: [],
    pinned: false,
    contextSummary: "",
    compressionCount: 0,
    lastCompressionAt: "",
    actualModel: "",
    actualChannel: "",
    actualContextWindow: 0,
    usageInputTokens: 0,
    usageOutputTokens: 0,
    usageTotalTokens: 0,
    createdAt: now,
    updatedAt: now
  };
}

function createInitialState() {
  const session = createSession();
  return {
    workspace: resolveDefaultWorkspace(),
    activeSessionId: session.id,
    sessions: [session],
    runtime: {
      engineId: "bundled-cli",
      engineLabel: "Bundled CLI Compatibility Layer",
      providerLabel: "Claude Code 2.1.88 Package"
    }
  };
}

function getStateFilePath() {
  return path.join(app.getPath("userData"), "vgo-state.json");
}

function touchSession(session) {
  session.updatedAt = new Date().toISOString();
}

function sortSessions(sessions) {
  return sessions.slice().sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1;
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function normalizeSession(session) {
  return {
    id: session.id || crypto.randomUUID(),
    title: sanitizeStoredText(session.title) || DEFAULT_SESSION_TITLE,
    directory: session.directory || null,
    manualTitle: Boolean(session.manualTitle),
    history: Array.isArray(session.history) ? session.history.slice(-120).map(normalizeHistoryEntry) : [],
    pinned: Boolean(session.pinned),
    contextSummary: sanitizeStoredText(session.contextSummary),
    compressionCount: Number.isFinite(session.compressionCount) ? session.compressionCount : 0,
    lastCompressionAt: session.lastCompressionAt || "",
    actualModel: session.actualModel || "",
    actualChannel: session.actualChannel || "",
    actualContextWindow: Number.isFinite(session.actualContextWindow) ? session.actualContextWindow : 0,
    usageInputTokens: Number.isFinite(session.usageInputTokens) ? session.usageInputTokens : 0,
    usageOutputTokens: Number.isFinite(session.usageOutputTokens) ? session.usageOutputTokens : 0,
    usageTotalTokens: Number.isFinite(session.usageTotalTokens) ? session.usageTotalTokens : 0,
    createdAt: session.createdAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString()
  };
}

function normalizeState(parsed) {
  const fallback = createInitialState();
  const sessions = Array.isArray(parsed.sessions)
    ? sortSessions(parsed.sessions.map(normalizeSession).slice(-30))
    : fallback.sessions;

  const activeSessionId = sessions.some((session) => session.id === parsed.activeSessionId)
    ? parsed.activeSessionId
    : sessions[0].id;

  return {
    workspace: normalizeWorkspace(parsed.workspace || fallback.workspace),
    activeSessionId,
    sessions,
    runtime: {
      ...fallback.runtime,
      ...(parsed.runtime || {})
    }
  };
}

function getPreview(history) {
  return (
    history
      .slice()
      .reverse()
      .find((entry) => entry.role === "user" || entry.role === "assistant")?.text
      ?.slice(0, 60) || "暂无消息"
  );
}

function createStore() {
  let state = createInitialState();

  function save() {
    const stateFile = getStateFilePath();
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
  }

  function load() {
    const stateFile = getStateFilePath();
    try {
      if (!fs.existsSync(stateFile)) {
        return state;
      }
      const raw = fs.readFileSync(stateFile, "utf8");
      state = normalizeState(JSON.parse(raw));
    } catch {
      state = createInitialState();
    }
    return state;
  }

  function persistAndSort() {
    state.sessions = sortSessions(state.sessions).slice(0, 30);
    save();
  }

  function getState() {
    return state;
  }

  function setRuntime(runtime) {
    state.runtime = {
      ...state.runtime,
      ...runtime
    };
    save();
  }

  function getActiveSession() {
    return state.sessions.find((session) => session.id === state.activeSessionId) || null;
  }

  function getSessionById(sessionId) {
    return state.sessions.find((session) => session.id === sessionId) || null;
  }

function appendHistory(role, text, status = "done") {
    const session = getActiveSession();
    if (!session) {
      return;
    }

    session.history.push(
      normalizeHistoryEntry({
        id: crypto.randomUUID(),
        role,
        text,
        status,
        createdAt: new Date().toISOString()
      })
    );
    session.history = session.history.slice(-120);
    touchSession(session);
    persistAndSort();
  }

  function replaceSessionHistory(sessionId, history = []) {
    const session = getSessionById(sessionId);
    if (!session) {
      return null;
    }

    session.history = Array.isArray(history) ? history.slice(-120).map(normalizeHistoryEntry) : [];
    touchSession(session);
    persistAndSort();
    return session;
  }

  function renameSessionFromFirstPrompt(prompt) {
    const session = getActiveSession();
    if (!session || session.manualTitle || session.title !== DEFAULT_SESSION_TITLE || session.history.length > 1) {
      return;
    }

    const trimmed = sanitizeStoredText(prompt).replace(/\s+/g, " ").trim();
    if (!trimmed) {
      return;
    }

    session.title = trimmed.slice(0, 28);
    session.manualTitle = false;
    touchSession(session);
    persistAndSort();
  }

  function renameSession(sessionId, title) {
    const session = sessionId ? getSessionById(sessionId) : getActiveSession();
    if (!session) {
      return null;
    }

    session.title = sanitizeStoredText(title) || DEFAULT_SESSION_TITLE;
    session.manualTitle = Boolean(sanitizeStoredText(title));
    touchSession(session);
    persistAndSort();
    return session;
  }

  function updateSessionMeta(sessionId, meta = {}) {
    const session = getSessionById(sessionId);
    if (!session) {
      return null;
    }

    if (typeof meta.title === "string" && sanitizeStoredText(meta.title) && !session.manualTitle) {
      session.title = sanitizeStoredText(meta.title);
    }
    if (typeof meta.contextSummary === "string") session.contextSummary = sanitizeStoredText(meta.contextSummary);
    if (typeof meta.compressionCount === "number") session.compressionCount = meta.compressionCount;
    if (typeof meta.lastCompressionAt === "string") session.lastCompressionAt = meta.lastCompressionAt;
    if (typeof meta.actualModel === "string") session.actualModel = meta.actualModel;
    if (typeof meta.actualChannel === "string") session.actualChannel = meta.actualChannel;
    if (typeof meta.actualContextWindow === "number") session.actualContextWindow = meta.actualContextWindow;
    if (typeof meta.directory === "string" && meta.directory) session.directory = meta.directory;
    if (typeof meta.usageInputTokens === "number") session.usageInputTokens = meta.usageInputTokens;
    if (typeof meta.usageOutputTokens === "number") session.usageOutputTokens = meta.usageOutputTokens;
    if (typeof meta.usageTotalTokens === "number") session.usageTotalTokens = meta.usageTotalTokens;

    touchSession(session);
    persistAndSort();
    return session;
  }

  function togglePinSession(sessionId) {
    const session = getSessionById(sessionId);
    if (!session) {
      return null;
    }
    session.pinned = !session.pinned;
    touchSession(session);
    persistAndSort();
    return session;
  }

  function serialize() {
    const session = getActiveSession();
    return {
      workspace: state.workspace,
      activeSessionId: state.activeSessionId,
      runtime: state.runtime,
      sessions: sortSessions(state.sessions).map((item) => ({
        id: item.id,
        title: item.title,
        manualTitle: item.manualTitle,
        pinned: item.pinned,
        compressionCount: item.compressionCount,
        lastCompressionAt: item.lastCompressionAt,
        actualModel: item.actualModel,
        actualChannel: item.actualChannel,
        actualContextWindow: item.actualContextWindow,
        usageInputTokens: item.usageInputTokens,
        usageOutputTokens: item.usageOutputTokens,
        usageTotalTokens: item.usageTotalTokens,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        preview: getPreview(item.history)
      })),
      history: session?.history || [],
      contextSummary: session?.contextSummary || "",
      compressionCount: session?.compressionCount || 0,
      lastCompressionAt: session?.lastCompressionAt || "",
      actualModel: session?.actualModel || "",
      actualChannel: session?.actualChannel || "",
      actualContextWindow: session?.actualContextWindow || 0,
      usageInputTokens: session?.usageInputTokens || 0,
      usageOutputTokens: session?.usageOutputTokens || 0,
      usageTotalTokens: session?.usageTotalTokens || 0
    };
  }

  function createAndActivateSession(directory = null) {
    const session = createSession(DEFAULT_SESSION_TITLE, directory || state.workspace);
    state.sessions.unshift(session);
    state.activeSessionId = session.id;
    persistAndSort();
    return session;
  }

  function switchSession(sessionId) {
    if (!state.sessions.some((session) => session.id === sessionId)) {
      return null;
    }
    state.activeSessionId = sessionId;
    save();
    return serialize();
  }

  function deleteSession(sessionId) {
    const nextSessions = state.sessions.filter((session) => session.id !== sessionId);
    if (!nextSessions.length) {
      const session = createSession();
      state.sessions = [session];
      state.activeSessionId = session.id;
    } else {
      state.sessions = nextSessions;
      if (!state.sessions.some((session) => session.id === state.activeSessionId)) {
        state.activeSessionId = sortSessions(state.sessions)[0].id;
      }
    }
    persistAndSort();
  }

  function resetActiveSession() {
    const session = getActiveSession();
    if (!session) {
      return "";
    }
    session.history = [];
    session.contextSummary = "";
    session.compressionCount = 0;
    session.lastCompressionAt = "";
    session.actualModel = "";
    session.actualChannel = "";
    session.actualContextWindow = 0;
    session.usageInputTokens = 0;
    session.usageOutputTokens = 0;
    session.usageTotalTokens = 0;
    session.title = DEFAULT_SESSION_TITLE;
    session.manualTitle = false;
    touchSession(session);
    persistAndSort();
    return session.id;
  }

  function clearActiveHistory() {
    const session = getActiveSession();
    if (!session) {
      return;
    }
    session.history = [];
    session.contextSummary = "";
    session.manualTitle = false;
    session.compressionCount = 0;
    session.lastCompressionAt = "";
    session.actualModel = "";
    session.actualChannel = "";
    session.actualContextWindow = 0;
    session.usageInputTokens = 0;
    session.usageOutputTokens = 0;
    session.usageTotalTokens = 0;
    touchSession(session);
    persistAndSort();
  }

  function setWorkspace(workspace) {
    state.workspace = normalizeWorkspace(workspace);
    save();
  }

  load();

  return {
    appendHistory,
    clearActiveHistory,
    createAndActivateSession,
    deleteSession,
    getActiveSession,
    getSessionById,
    getState,
    load,
    renameSession,
    renameSessionFromFirstPrompt,
    replaceSessionHistory,
    resetActiveSession,
    save,
    serialize,
    setRuntime,
    setWorkspace,
    switchSession,
    togglePinSession,
    updateSessionMeta
  };
}

module.exports = {
  createStore
};
