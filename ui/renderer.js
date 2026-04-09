const messages = document.getElementById("messages");
const promptInput = document.getElementById("promptInput");
const sendButton = document.getElementById("sendButton");
const uploadButton = document.getElementById("uploadButton");
const attachmentList = document.getElementById("attachmentList");
const contextMeterText = document.getElementById("contextMeterText");
const contextCompressionMeta = document.getElementById("contextCompressionMeta");
const contextMeterFill = document.getElementById("contextMeterFill");
const statusText = document.getElementById("statusText");
const taskStateBar = document.getElementById("taskStateBar");
const taskStateText = document.getElementById("taskStateText");
const taskPanelMeta = document.getElementById("taskPanelMeta");
const taskStepList = document.getElementById("taskStepList");
const authStatusPill = document.getElementById("authStatusPill");
const engineBadge = document.getElementById("engineBadge");
const engineSelect = document.getElementById("engineSelect");
const engineLabel = document.getElementById("engineLabel");
const providerLabel = document.getElementById("providerLabel");
const vgoAiEmail = document.getElementById("vgoAiEmail");
const vgoAiPassword = document.getElementById("vgoAiPassword");
const vgoAiDisplayName = document.getElementById("vgoAiDisplayName");
const vgoAiModelSelect = document.getElementById("vgoAiModelSelect");
const vgoAiStatus = document.getElementById("vgoAiStatus");
const mockServerStatus = document.getElementById("mockServerStatus");
const accountNameValue = document.getElementById("accountNameValue");
const accountModelValue = document.getElementById("accountModelValue");
const accountLinkedAtValue = document.getElementById("accountLinkedAtValue");
const bindVgoAiButton = document.getElementById("bindVgoAiButton");
const syncModelsButton = document.getElementById("syncModelsButton");
const saveProfileButton = document.getElementById("saveProfileButton");
const logoutButton = document.getElementById("logoutButton");
const remoteProfileSelect = document.getElementById("remoteProfileSelect");
const remoteProfileName = document.getElementById("remoteProfileName");
const remoteProviderName = document.getElementById("remoteProviderName");
const remoteProfileHint = document.getElementById("remoteProfileHint");
const newRemoteProfileButton = document.getElementById("newRemoteProfileButton");
const applyRemoteProfileButton = document.getElementById("applyRemoteProfileButton");
const deleteRemoteProfileButton = document.getElementById("deleteRemoteProfileButton");
const remoteBaseUrl = document.getElementById("remoteBaseUrl");
const remoteModel = document.getElementById("remoteModel");
const remoteApiKey = document.getElementById("remoteApiKey");
const remoteSystemPrompt = document.getElementById("remoteSystemPrompt");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const workspacePath = document.getElementById("workspacePath");
const sessionIdText = document.getElementById("sessionIdText");
const sessionList = document.getElementById("sessionList");
const sessionSearchInput = document.getElementById("sessionSearchInput");
const conversationTitle = document.getElementById("conversationTitle");
const newSessionButton = document.getElementById("newSessionButton");
const pickWorkspaceButton = document.getElementById("pickWorkspaceButton");
const renameSessionButton = document.getElementById("renameSessionButton");
const resetSessionButton = document.getElementById("resetSessionButton");
const loginButton = document.getElementById("loginButton");
const docsButton = document.getElementById("docsButton");
const analyzeButton = document.getElementById("analyzeButton");
const healthButton = document.getElementById("healthButton");
const exportButton = document.getElementById("exportButton");
const clearButton = document.getElementById("clearButton");
const templateButtons = document.querySelectorAll(".template-button");
const permissionModeLabel = document.getElementById("permissionModeLabel");
const permissionModeHint = document.getElementById("permissionModeHint");
const accessScopeLabel = document.getElementById("accessScopeLabel");
const accessScopeHint = document.getElementById("accessScopeHint");
const accessWorkspaceButton = document.getElementById("accessWorkspaceButton");
const accessDesktopButton = document.getElementById("accessDesktopButton");
const accessGlobalButton = document.getElementById("accessGlobalButton");
const permissionDefaultButton = document.getElementById("permissionDefaultButton");
const permissionFullAccessButton = document.getElementById("permissionFullAccessButton");
const sidebarSettingsButton = document.getElementById("sidebarSettingsButton");
const closeSettingsButton = document.getElementById("closeSettingsButton");
const settingsOverlay = document.getElementById("settingsOverlay");
const renameOverlay = document.getElementById("renameOverlay");
const settingsNavItems = document.querySelectorAll(".settings-nav-item");
const settingsTabs = document.querySelectorAll(".settings-tab");
const themeCards = document.querySelectorAll(".theme-card");
const uiModeButtons = document.querySelectorAll("[data-ui-mode-value]");
const localeButtons = document.querySelectorAll("[data-locale-value]");
const messageDensitySelect = document.getElementById("messageDensitySelect");
const compactModeToggle = document.getElementById("compactModeToggle");
const enterToSendToggle = document.getElementById("enterToSendToggle");
const autoScrollToggle = document.getElementById("autoScrollToggle");
const showTaskPanelToggle = document.getElementById("showTaskPanelToggle");
const confirmDangerousOpsToggle = document.getElementById("confirmDangerousOpsToggle");
const autoSummarizeToggle = document.getElementById("autoSummarizeToggle");
const showRuntimeMetaToggle = document.getElementById("showRuntimeMetaToggle");
const showExecutionPlanToggle = document.getElementById("showExecutionPlanToggle");
const compressionThresholdRange = document.getElementById("compressionThresholdRange");
const compressionThresholdValue = document.getElementById("compressionThresholdValue");
const fallbackModelSelect = document.getElementById("fallbackModelSelect");
const settingsRuntimeEngine = document.getElementById("settingsRuntimeEngine");
const settingsRuntimeModel = document.getElementById("settingsRuntimeModel");
const settingsRuntimeAccess = document.getElementById("settingsRuntimeAccess");
const settingsRuntimePermission = document.getElementById("settingsRuntimePermission");
const settingsRuntimeWorkspace = document.getElementById("settingsRuntimeWorkspace");
const renameSessionInput = document.getElementById("renameSessionInput");
const closeRenameButton = document.getElementById("closeRenameButton");
const cancelRenameButton = document.getElementById("cancelRenameButton");
const confirmRenameButton = document.getElementById("confirmRenameButton");

let currentState = null;
let sessionSearch = "";
let authFlowState = "idle";
let attachments = [];
let authPollTimer = null;
let taskSteps = [];
let liveEventKeys = new Set();
let permissionCards = new Map();
let promptRunning = false;
let activeSettingsTab = "appearance";

const LOCALES = {
  "zh-CN": {
    settingsCenter: "设置中心",
    settings: "设置",
    close: "关闭",
    settingsTitle: "VGO Code 设置中心",
    settingsSubtitle: "统一管理主题、语言、交互和 Agent 偏好。",
    openSettings: "设置中心",
    runtimeDefault: "默认权限",
    runtimeFull: "完全访问",
    accessWorkspace: "工作区",
    accessDesktop: "工作区 + 桌面",
    accessGlobal: "全局访问",
    send: "发送给 Agent",
    stop: "停止推理",
    taskWaiting: "等待新的任务。",
    enterHint: "例如：分析当前目录结构，并给出需要补齐的模块与改造步骤。按 Enter 发送，Shift+Enter 换行。"
  },
  "en-US": {
    settingsCenter: "Settings",
    settings: "Settings",
    close: "Close",
    settingsTitle: "VGO Code Settings",
    settingsSubtitle: "Manage themes, language, behavior, and Agent preferences in one place.",
    openSettings: "Settings",
    runtimeDefault: "Default",
    runtimeFull: "Full Access",
    accessWorkspace: "Workspace",
    accessDesktop: "Workspace + Desktop",
    accessGlobal: "Full System",
    send: "Send to Agent",
    stop: "Stop",
    taskWaiting: "Waiting for the next task.",
    enterHint: "Example: Analyze the current project structure and outline the missing modules and next refactor steps. Press Enter to send, Shift+Enter for newline."
  }
};

function scrollMessagesToBottom() {
  if (!shouldAutoScroll()) return;
  requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
}

function scrollTaskPanelToBottom() {
  if (!shouldAutoScroll()) return;
  requestAnimationFrame(() => {
    taskStepList.scrollTop = taskStepList.scrollHeight;
  });
}

function setStatus(text) {
  statusText.textContent = text || "空闲";
}

function getLocale() {
  return currentState?.settings?.localization?.locale === "en-US" ? "en-US" : "zh-CN";
}

function t(key) {
  const locale = getLocale();
  return LOCALES[locale]?.[key] || LOCALES["zh-CN"][key] || key;
}

function shouldAutoScroll() {
  return currentState?.settings?.behavior?.autoScroll !== false;
}

function getAccessScope() {
  return currentState?.settings?.access?.scope || "workspace-and-desktop";
}

function getAccessScopeLabel(scope = getAccessScope()) {
  if (scope === "workspace-only") {
    return t("accessWorkspace");
  }
  if (scope === "full-system") {
    return t("accessGlobal");
  }
  return t("accessDesktop");
}

function showTaskPanelEnabled() {
  return currentState?.settings?.behavior?.showTaskPanel !== false;
}

function showRuntimeMetaEnabled() {
  return currentState?.settings?.agent?.showRuntimeMeta !== false;
}

function showExecutionPlanEnabled() {
  return currentState?.settings?.agent?.showExecutionPlan !== false;
}

function applyAppearanceSettings(state) {
  const appearance = state?.settings?.appearance || {};
  document.body.dataset.theme = appearance.theme || "aurora";
  document.body.dataset.uiMode = appearance.uiMode || "standard";
  document.body.dataset.compact = appearance.compactMode ? "true" : "false";
  document.body.dataset.density = appearance.messageDensity || "comfortable";
  document.documentElement.lang = getLocale();
}

function applyLocalization() {
  const locale = getLocale();
  document.title = "VGO Code";
  sidebarSettingsButton.textContent = t("settings");
  closeSettingsButton.textContent = t("close");
  document.getElementById("settingsTitle").textContent = t("settingsTitle");
  document.getElementById("settingsSubtitle").textContent = t("settingsSubtitle");
  permissionModeLabel.textContent =
    currentState?.settings?.permissions?.mode === "full-access" ? t("runtimeFull") : t("runtimeDefault");
  accessScopeLabel.textContent = getAccessScopeLabel();
  accessWorkspaceButton.textContent = t("accessWorkspace");
  accessDesktopButton.textContent = t("accessDesktop");
  accessGlobalButton.textContent = t("accessGlobal");
  permissionDefaultButton.textContent = t("runtimeDefault");
  permissionFullAccessButton.textContent = t("runtimeFull");
  taskStateText.textContent = taskStateText.textContent || t("taskWaiting");
  promptInput.placeholder = t("enterHint");
  document.querySelector(".task-state-pill").textContent = promptRunning ? "Running" : "Agent Idle";
  renderSendButton();
}

function setActiveSettingsTab(tab) {
  activeSettingsTab = tab;
  settingsNavItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.settingsTab === tab);
  });
  settingsTabs.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.settingsPanel === tab);
  });
}

function openSettings() {
  settingsOverlay.classList.remove("hidden");
}

function closeSettings() {
  settingsOverlay.classList.add("hidden");
}

function openRenameDialog() {
  const active = currentState?.sessions?.find((session) => session.id === currentState.activeSessionId);
  renameSessionInput.value = active?.title || "";
  renameOverlay.classList.remove("hidden");
  requestAnimationFrame(() => {
    renameSessionInput.focus();
    renameSessionInput.select();
  });
}

function closeRenameDialog() {
  renameOverlay.classList.add("hidden");
}

function renderSettingsCenter(state) {
  const appearance = state?.settings?.appearance || {};
  const behavior = state?.settings?.behavior || {};
  const agent = state?.settings?.agent || {};
  const localization = state?.settings?.localization || {};
  const permissionMode = state?.settings?.permissions?.mode || "default";
  const accessScope = state?.settings?.access?.scope || "workspace-and-desktop";

  themeCards.forEach((card) => {
    card.classList.toggle("active", card.dataset.themeValue === (appearance.theme || "aurora"));
  });
  uiModeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.uiModeValue === (appearance.uiMode || "standard"));
  });
  localeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.localeValue === (localization.locale || "zh-CN"));
  });

  messageDensitySelect.value = appearance.messageDensity || "comfortable";
  compactModeToggle.checked = Boolean(appearance.compactMode);
  enterToSendToggle.checked = behavior.enterToSend !== false;
  autoScrollToggle.checked = behavior.autoScroll !== false;
  showTaskPanelToggle.checked = behavior.showTaskPanel !== false;
  confirmDangerousOpsToggle.checked = behavior.confirmDangerousOps !== false;
  autoSummarizeToggle.checked = agent.autoSummarizeContext !== false;
  showRuntimeMetaToggle.checked = agent.showRuntimeMeta !== false;
  showExecutionPlanToggle.checked = agent.showExecutionPlan !== false;
  compressionThresholdRange.value = String(
    Math.round((agent.contextCompressionThreshold || 0.9) * 100)
  );
  compressionThresholdValue.textContent = `${compressionThresholdRange.value}%`;
  renderFallbackModelOptions(state);

  settingsRuntimeEngine.textContent = state?.runtime?.engineLabel || "-";
  settingsRuntimeModel.textContent = getModelLabel(state, getActiveConfiguredModelId(state)) || "-";
  settingsRuntimeAccess.textContent = getAccessScopeLabel(accessScope);
  settingsRuntimePermission.textContent = permissionMode === "full-access" ? t("runtimeFull") : t("runtimeDefault");
  settingsRuntimeWorkspace.textContent = state?.workspace || "-";
}

function renderFallbackModelOptions(state) {
  const catalog = getCatalog(state);
  const currentSelected = state?.settings?.agent?.fallbackModel || "";
  fallbackModelSelect.innerHTML = "";

  const autoOption = document.createElement("option");
  autoOption.value = "";
  autoOption.textContent = "自动选择";
  autoOption.selected = !currentSelected;
  fallbackModelSelect.appendChild(autoOption);

  for (const item of catalog) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label || item.id;
    option.selected = item.id === currentSelected;
    fallbackModelSelect.appendChild(option);
  }
}

function renderSendButton() {
  sendButton.textContent = promptRunning ? t("stop") : t("send");
  sendButton.classList.toggle("stop-mode", promptRunning);
}

function setTaskState(mode, text) {
  taskStateBar.dataset.state = mode || "idle";
  taskStateText.textContent = text || t("taskWaiting");
}

function resetTaskPanel() {
  taskSteps = [];
  liveEventKeys.clear();
  permissionCards.clear();
  renderTaskPanel();
  setTaskState("idle", "等待新的任务。");
}

function pushTaskStep(title, detail = "", state = "idle") {
  taskSteps.push({ title, detail, state, time: new Date().toISOString() });
  taskSteps = taskSteps.slice(-12);
  renderTaskPanel();
}

function settlePendingTaskSteps(finalState = "completed") {
  const nextState = finalState === "completed" ? "completed" : "error";
  const transientStates = new Set([
    "idle",
    "planning",
    "thinking",
    "continuing",
    "working",
    "tool_running",
    "permission_requested",
    "verifying"
  ]);

  taskSteps = taskSteps.map((step) =>
    transientStates.has(step.state)
      ? {
          ...step,
          state: nextState
        }
      : step
  );
}

function finalizeTaskPanel(state, detail) {
  settlePendingTaskSteps(state);
  const title = state === "completed" ? "Task Completed" : "Task Failed";
  const exists = taskSteps.some((step) => step.title === title && step.detail === detail);
  if (!exists) {
    pushTaskStep(title, detail, state === "completed" ? "completed" : "error");
  } else {
    renderTaskPanel();
  }
  setTaskState(
    state,
    state === "completed" ? "Agent 已完成本轮任务。" : "Agent 本轮任务执行失败。"
  );
  scrollTaskPanelToBottom();
}

function renderTaskPanel() {
  document.getElementById("taskPanel").classList.toggle("hidden", !showTaskPanelEnabled());
  taskStepList.innerHTML = "";
  const lastActiveIndex = taskSteps.length - 1;
  taskPanelMeta.textContent = taskSteps.length
    ? `共 ${taskSteps.length} 步 | 当前第 ${lastActiveIndex + 1} 步`
    : "No active steps";
  for (const [index, step] of taskSteps.entries()) {
    const item = document.createElement("div");
    item.className = "task-step";
    item.dataset.state = step.state || "idle";
    if (index === lastActiveIndex) {
      item.classList.add("current");
    }

    const dot = document.createElement("div");
    dot.className = "task-step-dot";

    const body = document.createElement("div");
    const title = document.createElement("div");
    title.className = "task-step-title";
    title.textContent = `${index + 1}. ${step.title}`;

    const detail = document.createElement("div");
    detail.className = "task-step-detail";
    detail.textContent = step.detail;

    body.append(title, detail);
    item.append(dot, body);
    taskStepList.append(item);
  }
  scrollTaskPanelToBottom();
}

function setAuthPill(label, online = false) {
  authStatusPill.textContent = label;
  authStatusPill.classList.toggle("online", online);
}

function setBusyState(isBusy) {
  bindVgoAiButton.disabled = isBusy;
}

function stopAuthPolling() {
  if (authPollTimer) {
    clearInterval(authPollTimer);
    authPollTimer = null;
  }
}

function formatTime(value) {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatBytes(size) {
  if (!size) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function createMessage(role, text = "", extraClass = "") {
  const item = document.createElement("article");
  item.className = ["message", role, extraClass].filter(Boolean).join(" ");
  item.textContent = text;
  messages.appendChild(item);
  scrollMessagesToBottom();
  return item;
}

function addMessage(role, text, extraClass = "") {
  return createMessage(role, text, extraClass);
}

function getTraceStateLabel(state = "working") {
  if (state === "completed" || state === "permission_granted") return "已完成";
  if (state === "failed" || state === "error" || state === "permission_denied") return "失败";
  if (state === "planning") return "规划中";
  if (state === "thinking" || state === "continuing") return "思考中";
  if (state === "tool_running") return "执行中";
  if (state === "permission_requested") return "待确认";
  if (state === "verifying") return "复检中";
  return "进行中";
}

function addTraceMessage(title, detail = "", state = "working", meta = "") {
  const item = document.createElement("article");
  item.className = `message system trace-card trace-${state}`;

  const head = document.createElement("div");
  head.className = "trace-card-head";

  const titleWrap = document.createElement("div");
  titleWrap.className = "trace-card-title-wrap";

  const badge = document.createElement("span");
  badge.className = "trace-card-badge";
  badge.textContent = getTraceStateLabel(state);

  const titleNode = document.createElement("div");
  titleNode.className = "trace-card-title";
  titleNode.textContent = title;

  titleWrap.append(badge, titleNode);

  const metaNode = document.createElement("div");
  metaNode.className = "trace-card-meta";
  metaNode.textContent = meta || new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  head.append(titleWrap, metaNode);

  const detailNode = document.createElement("div");
  detailNode.className = "trace-card-detail";
  detailNode.textContent = detail;

  item.append(head, detailNode);
  messages.appendChild(item);
  scrollMessagesToBottom();
  return item;
}

function renderPermissionCardState(card, state, text) {
  const status = card.querySelector(".permission-card-status");
  const allowButton = card.querySelector(".permission-allow");
  const denyButton = card.querySelector(".permission-deny");
  card.dataset.state = state;
  status.textContent = text;
  if (allowButton) allowButton.disabled = state !== "pending";
  if (denyButton) denyButton.disabled = state !== "pending";
}

function addPermissionCard(event) {
  const requestId = event.requestId;
  if (!requestId || permissionCards.has(requestId)) {
    return permissionCards.get(requestId) || null;
  }

  const card = document.createElement("article");
  card.className = "message system permission-card";
  card.dataset.state = "pending";

  const title = document.createElement("div");
  title.className = "permission-card-title";
  title.textContent = "权限确认";

  const body = document.createElement("div");
  body.className = "permission-card-body";
  body.textContent = `${event.tool || "tool"}\n${event.detail || ""}`;

  const status = document.createElement("div");
  status.className = "permission-card-status";
  status.textContent = "等待你的确认";

  const actions = document.createElement("div");
  actions.className = "permission-card-actions";

  const allowButton = document.createElement("button");
  allowButton.className = "permission-action permission-allow";
  allowButton.type = "button";
  allowButton.textContent = "允许";
  allowButton.addEventListener("click", async () => {
    renderPermissionCardState(card, "working", "正在提交允许...");
    const result = await window.vgoDesktop.respondPermission({ requestId, approved: true });
    if (!result?.ok) {
      renderPermissionCardState(card, "pending", "提交失败，请重试");
    }
  });

  const denyButton = document.createElement("button");
  denyButton.className = "permission-action permission-deny";
  denyButton.type = "button";
  denyButton.textContent = "拒绝";
  denyButton.addEventListener("click", async () => {
    renderPermissionCardState(card, "working", "正在提交拒绝...");
    const result = await window.vgoDesktop.respondPermission({ requestId, approved: false });
    if (!result?.ok) {
      renderPermissionCardState(card, "pending", "提交失败，请重试");
    }
  });

  actions.append(allowButton, denyButton);
  card.append(title, body, status, actions);
  messages.appendChild(card);
  scrollMessagesToBottom();
  permissionCards.set(requestId, card);
  return card;
}

function renderAttachments() {
  attachmentList.innerHTML = "";
  for (const item of attachments) {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    chip.textContent = `${item.name} | ${formatBytes(item.size)}`;

    const remove = document.createElement("span");
    remove.className = "attachment-remove";
    remove.textContent = "x";
    remove.addEventListener("click", () => {
      attachments = attachments.filter((entry) => entry.path !== item.path);
      renderAttachments();
    });

    chip.appendChild(remove);
    attachmentList.appendChild(chip);
  }
}

function buildPromptWithAttachments(prompt) {
  if (!attachments.length) return prompt;
  const attachmentText = attachments
    .map((item, index) => {
      const head = `附件 ${index + 1}: ${item.name}\n路径: ${item.path}`;
      if (item.isText && item.content) {
        return `${head}\n内容:\n${item.content}`;
      }
      return `${head}\n说明: 文件内容未展开，请按路径继续处理。`;
    })
    .join("\n\n");

  return `${prompt}\n\n已上传附件如下，请结合处理：\n\n${attachmentText}`;
}

function getCatalog(state) {
  return state?.settings?.vgoAI?.modelCatalog || [];
}

function getModelLabel(state, modelId) {
  const match = getCatalog(state).find((item) => item.id === modelId);
  return match?.label || modelId || "未选择";
}

function getActiveProfile(state) {
  const settings = state?.settings || {};
  const profiles = settings.remoteProfiles || [];
  const activeId = settings.activeRemoteProfileId;
  return profiles.find((item) => item.id === activeId) || profiles[0] || null;
}

function getActiveConfiguredModelId(state) {
  return getActiveProfile(state)?.model || state?.settings?.remote?.model || state?.settings?.vgoAI?.preferredModel || "";
}

function renderHistory(history) {
  messages.innerHTML = "";
  for (const item of history || []) {
    addMessage(item.role, item.text, item.status === "error" ? "error" : item.role === "system" ? "tool-event" : "");
  }
  scrollMessagesToBottom();
}

function renderSessionItem(session, activeSessionId) {
  const item = document.createElement("button");
  item.className = `session-item${session.id === activeSessionId ? " active" : ""}`;
  item.type = "button";

  const meta = document.createElement("div");
  meta.className = "session-item-meta";

  const pin = document.createElement("span");
  pin.className = `session-pin${session.pinned ? " active" : ""}`;
  pin.textContent = session.pinned ? "置顶" : "未置顶";
  pin.addEventListener("click", async (event) => {
    event.stopPropagation();
    hydrate(await window.vgoDesktop.togglePinSession(session.id));
  });

  const time = document.createElement("span");
  time.className = "session-item-time";
  time.textContent = formatTime(session.updatedAt);
  meta.append(pin, time);

  const title = document.createElement("div");
  title.className = "session-item-title";
  title.textContent = session.title || "新会话";

  const preview = document.createElement("div");
  preview.className = "session-item-preview";
  preview.textContent = session.preview || "暂无消息";

  const remove = document.createElement("span");
  remove.className = "session-item-remove";
  remove.textContent = "x";
  remove.addEventListener("click", async (event) => {
    event.stopPropagation();
    hydrate(await window.vgoDesktop.deleteSession(session.id));
  });

  item.append(meta, title, preview, remove);
  item.addEventListener("click", async () => {
    const next = await window.vgoDesktop.switchSession(session.id);
    if (next) {
      hydrate(next);
      resetTaskPanel();
    }
  });
  return item;
}

function renderSessionGroup(title, sessions, activeSessionId) {
  if (!sessions.length) return null;
  const group = document.createElement("section");
  group.className = "session-group";

  const heading = document.createElement("div");
  heading.className = "session-group-title";
  heading.textContent = title;
  group.appendChild(heading);

  for (const session of sessions) {
    group.appendChild(renderSessionItem(session, activeSessionId));
  }
  return group;
}

function renderSessionList(state) {
  const keyword = sessionSearch.trim().toLowerCase();
  sessionList.innerHTML = "";
  const filtered = (state.sessions || []).filter((session) => {
    if (!keyword) return true;
    return (session.title || "").toLowerCase().includes(keyword) || (session.preview || "").toLowerCase().includes(keyword);
  });

  const pinned = filtered.filter((session) => session.pinned);
  const recent = filtered.filter((session) => !session.pinned).slice(0, 5);
  const backlog = filtered.filter((session) => !session.pinned).slice(5);

  const groups = [
    renderSessionGroup("置顶线程", pinned, state.activeSessionId),
    renderSessionGroup("最近线程", recent, state.activeSessionId),
    renderSessionGroup("更多线程", backlog, state.activeSessionId)
  ].filter(Boolean);

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "helper-text";
    empty.textContent = "当前没有匹配的线程。";
    sessionList.appendChild(empty);
    return;
  }

  for (const group of groups) {
    sessionList.appendChild(group);
  }
}

function renderEngines(state) {
  engineSelect.innerHTML = "";
  for (const engine of state.engines || []) {
    const option = document.createElement("option");
    option.value = engine.id;
    option.textContent = `${engine.label} | ${engine.provider}`;
    option.selected = engine.id === state.runtime?.engineId;
    engineSelect.appendChild(option);
  }
}

function renderModelCatalog(state) {
  const items = getCatalog(state);
  const source = items.length
    ? items
    : [
        { id: "vgo-coder-pro", label: "VGO Coder Pro" },
        { id: "vgo-coder-fast", label: "VGO Coder Fast" },
        { id: "vgo-architect-max", label: "VGO Architect Max" }
      ];
  const current = state.settings?.vgoAI?.preferredModel || state.settings?.remote?.model || source[0].id;

  vgoAiModelSelect.innerHTML = "";
  for (const item of source) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label || item.id;
    option.selected = item.id === current;
    vgoAiModelSelect.appendChild(option);
  }
}

function renderRemoteProfiles(state) {
  const settings = state.settings || {};
  const profiles = settings.remoteProfiles || [];
  const activeId = settings.activeRemoteProfileId;

  remoteProfileSelect.innerHTML = "";
  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name} | ${profile.provider}`;
    option.selected = profile.id === activeId;
    remoteProfileSelect.appendChild(option);
  }

  const active = profiles.find((item) => item.id === activeId) || profiles[0];
  remoteProfileName.value = active?.name || "";
  remoteProviderName.value = active?.provider || "";
  remoteProfileHint.textContent = active
    ? `当前配置档：${active.name} | ${active.provider}`
    : "当前还没有可用配置档。";
}

function renderAccountSummary(state) {
  const vgoAI = state.settings?.vgoAI || {};
  const loggedIn = Boolean(vgoAI.loggedIn && vgoAI.hasAccessToken);
  accountNameValue.textContent = loggedIn ? vgoAI.displayName || "未命名账户" : "未登录";
  accountModelValue.textContent = loggedIn ? getModelLabel(state, vgoAI.preferredModel) : "未选择";
  accountLinkedAtValue.textContent = loggedIn ? formatTime(vgoAI.linkedAt) : "未绑定";
}

function renderSettings(state) {
  const remote = state.settings?.remote || {};
  const vgoAI = state.settings?.vgoAI || {};
  const permissionMode = state.settings?.permissions?.mode || "default";
  const accessScope = state.settings?.access?.scope || "workspace-and-desktop";
  const loggedIn = Boolean(vgoAI.loggedIn && vgoAI.hasAccessToken);

  remoteBaseUrl.value = remote.baseUrl || "";
  remoteModel.value = remote.model || "";
  remoteApiKey.value = remote.apiKey || "";
  remoteSystemPrompt.value = remote.systemPrompt || "";
  vgoAiEmail.value = vgoAI.email || "";
  vgoAiPassword.value = vgoAI.rememberPassword ? vgoAI.rememberedPassword || "" : "";
  vgoAiDisplayName.value = vgoAI.displayName || "";

  renderModelCatalog(state);
  renderRemoteProfiles(state);
  renderAccountSummary(state);

  if (loggedIn) {
    setAuthPill("已登录", true);
    vgoAiStatus.textContent = `已绑定真实 VGO AI 账户：${vgoAI.displayName || "未命名账户"}，默认模型为 ${getModelLabel(state, vgoAI.preferredModel)}。`;
  } else if (authFlowState === "working") {
    setAuthPill("登录中");
    vgoAiStatus.textContent = "正在等待网页授权完成。只有拿到真实 token 并校验成功后，桌面端才会显示已登录。";
  } else {
    setAuthPill("未登录");
    vgoAiStatus.textContent = "可以直接打开网页登录窗授权，也可以输入邮箱密码同步真实账户。";
  }

  mockServerStatus.textContent = state.mockServer
    ? `Local API: ${state.mockServer.status} | ${state.mockServer.baseUrl}`
    : "Local API 未启动";

  permissionDefaultButton.dataset.mode = "default";
  permissionFullAccessButton.dataset.mode = "full-access";
  accessWorkspaceButton.classList.toggle("active", accessScope === "workspace-only");
  accessDesktopButton.classList.toggle("active", accessScope === "workspace-and-desktop");
  accessGlobalButton.classList.toggle("active", accessScope === "full-system");
  accessScopeLabel.textContent = getAccessScopeLabel(accessScope);
  accessScopeHint.textContent =
    accessScope === "full-system"
      ? "当前允许访问整台电脑的本地路径；危险写入、删除和命令仍会根据权限模式确认。"
      : accessScope === "workspace-only"
        ? "当前仅允许访问工作区目录；工作区外路径会被拦截。"
        : "当前允许访问工作区和 Desktop；危险写入与命令仍会二次确认。";
  permissionDefaultButton.classList.toggle("active", permissionMode === "default");
  permissionFullAccessButton.classList.toggle("active", permissionMode === "full-access");
  permissionModeLabel.textContent = permissionMode === "full-access" ? t("runtimeFull") : t("runtimeDefault");
  permissionModeHint.textContent =
    permissionMode === "full-access"
      ? "完全访问下，Agent 执行写文件和命令时会直接放行。"
      : "默认权限下，写文件和运行命令这类危险操作会二次确认。";
  renderSettingsCenter(state);
  applyAppearanceSettings(state);
  applyLocalization();
}

function renderContextStats(state) {
  const estimatedTokens = state?.contextStats?.estimatedTokens || 0;
  const thresholdTokens = state?.contextStats?.thresholdTokens || 0;
  const percentage = thresholdTokens ? Math.min(100, Math.max(0, Math.round((estimatedTokens / thresholdTokens) * 100))) : 0;

  contextMeterText.textContent = `${percentage}% | ${estimatedTokens} / ${thresholdTokens} tokens`;
  contextMeterFill.style.width = `${percentage}%`;

  if (percentage >= 90) {
    contextMeterFill.style.background = "linear-gradient(90deg, rgba(251,113,133,0.95), rgba(255,209,102,0.95))";
  } else if (percentage >= 70) {
    contextMeterFill.style.background = "linear-gradient(90deg, rgba(255,209,102,0.95), rgba(255,159,67,0.95))";
  } else {
    contextMeterFill.style.background = "linear-gradient(90deg, rgba(66,197,255,0.95), rgba(141,240,169,0.95))";
  }

  const actualModel = state?.history?.length
    ? state?.sessions?.find((item) => item.id === state.activeSessionId)?.actualModel
    : getActiveConfiguredModelId(state);
  const actualChannel = state?.sessions?.find((item) => item.id === state.activeSessionId)?.actualChannel || "待发送";
  const contextWindow = state?.contextStats?.contextWindow || 0;
  const usageSource = state?.contextStats?.usageSource || "estimated";
  const active = state?.sessions?.find((item) => item.id === state.activeSessionId);
  const compressionCount = active?.compressionCount || 0;

  const parts = showRuntimeMetaEnabled()
    ? [
        getModelLabel(state, actualModel),
        actualChannel,
        contextWindow ? `${contextWindow} tokens` : "",
        usageSource === "provider" ? "真实" : "估算",
        compressionCount ? `压缩 ${compressionCount} 次` : "尚未压缩"
      ].filter(Boolean)
    : [compressionCount ? `压缩 ${compressionCount} 次` : "尚未压缩"];
  contextCompressionMeta.textContent = parts.join(" | ");
}

function hydrate(state) {
  currentState = state;
  window.currentState = state;
  renderEngines(state);
  renderSettings(state);
  renderContextStats(state);
  renderHistory(state.history || []);
  renderSessionList(state);
  renderAttachments();

  engineLabel.textContent = state.runtime?.engineLabel || "Unknown Engine";
  providerLabel.textContent = state.runtime?.providerLabel || "";
  engineBadge.textContent = state.runtime?.engineId || "engine";
  workspacePath.textContent = state.workspace || "";
  sessionIdText.textContent = state.activeSessionId || "";

  const active = (state.sessions || []).find((session) => session.id === state.activeSessionId);
  conversationTitle.textContent = active?.title || "新会话";
  scrollMessagesToBottom();
  scrollTaskPanelToBottom();
}

async function refreshState() {
  hydrate(await window.vgoDesktop.getState());
}

async function streamAssistantMessage(fullText, extraClass = "") {
  const bubble = createMessage("assistant", "", extraClass);
  const text = fullText || "已完成，但没有返回文本。";
  for (let index = 0; index < text.length; index += 12) {
    bubble.textContent = text.slice(0, index + 12);
    scrollMessagesToBottom();
    await new Promise((resolve) => setTimeout(resolve, 14));
  }
  bubble.textContent = text;
  scrollMessagesToBottom();
}

function buildRuntimeMetaText(result) {
  if (!showRuntimeMetaEnabled()) {
    return "响应完成";
  }
  const parts = [];
  if (result?.usedModel) parts.push(`模型: ${result.usedModel}`);
  if (result?.actualChannel) parts.push(`通道: ${result.actualChannel}`);
  if (result?.usageTotalTokens) parts.push(`上下文: ${result.usageTotalTokens} tokens`);
  return parts.join(" | ");
}

function formatRuntimeEvent(event) {
  if (!event || typeof event !== "object") return "";

  if (event.type === "plan") {
    const steps = Array.isArray(event.steps) ? event.steps : [];
    const lines = [];
    if (event.summary) {
      lines.push(`目标: ${event.summary}`);
    }
    if (steps.length) {
      lines.push(...steps.map((step, index) => `${index + 1}. ${step}`));
    }
    return lines.join("\n");
  }

  if (event.type === "model_response" && Array.isArray(event.toolCalls) && event.toolCalls.length) {
    const lines = event.toolCalls.map((call) => {
      const args = call?.arguments && typeof call.arguments === "object" ? call.arguments : {};
      const parts = [];
      if (args.path) parts.push(`path=${args.path}`);
      if (args.query) parts.push(`query=${args.query}`);
      if (args.command) parts.push(`command=${args.command}`);
      return `- ${call.name}${parts.length ? ` | ${parts.join(" | ")}` : ""}`;
    });
    return `Agent 正在调用工具\n${lines.join("\n")}`;
  }

  if (event.type === "tool_result") {
    return event.ok
      ? `工具已完成：${event.tool}\n${event.summary || "执行成功"}`
      : `工具执行失败：${event.tool}\n${event.summary || "执行失败"}`;
  }

  if (event.type === "verification") {
    if (event.status === "dependency_pending") {
      return `依赖复检待完成\n${event.detail || "已修改依赖清单，但锁文件或安装状态尚未验证。"}`;
    }
    if (event.status === "passed") {
      return `复检通过\n${event.detail || "本轮修复已完成验证。"}`;
    }
    return `等待复检\n${event.detail || "已修改文件，正在继续执行验证。"}`
  }

  return "";
}

function handleAgentEvent(event) {
  if (!event) return;
  if (currentState?.activeSessionId && event.sessionId && event.sessionId !== currentState.activeSessionId) return;

  if (event.type === "plan") {
    if (!showExecutionPlanEnabled()) return;
    const message = formatRuntimeEvent(event);
    if (!message) return;
    const key = `plan:${event.step || 0}:${event.summary || ""}:${(event.steps || []).join("|")}`;
    if (liveEventKeys.has(key)) return;
    liveEventKeys.add(key);
    setTaskState("planning", "Agent 已生成执行计划。");
    addTraceMessage("执行计划", message, "planning");
    pushTaskStep("Execution Plan", message, "planning");
    return;
  }

  if (event.type === "skill_selection" && Array.isArray(event.skills) && event.skills.length) {
    const message = event.skills
      .map((skill) => `${skill.name}${skill.category ? ` | ${skill.category}` : ""}`)
      .join("\n");
    addTraceMessage("已激活技能", message, "planning");
    pushTaskStep("Skill Routing", message, "planning");
    return;
  }

  if (event.type === "task_status") {
    setTaskState(event.status || "working", event.message || "Agent 正在处理中...");
    pushTaskStep("Task Status", event.message || "Agent 正在处理中...", event.status || "working");
    if (event.status === "completed" || event.status === "failed") {
      liveEventKeys.clear();
    }
    return;
  }

  if (event.type === "permission_requested") {
    const key = `permission_requested:${event.requestId || ""}`;
    if (liveEventKeys.has(key)) return;
    liveEventKeys.add(key);
    setTaskState("permission_requested", "等待工具权限确认...");
    addPermissionCard(event);
    addTraceMessage(`权限确认 | ${event.tool || "tool"}`, event.detail || "", "permission_requested");
    pushTaskStep("Permission Request", `${event.tool || "tool"}\n${event.detail || ""}`, "permission_requested");
    return;
  }

  if (event.type === "permission_granted") {
    const key = `permission_granted:${event.requestId || ""}`;
    if (liveEventKeys.has(key)) return;
    liveEventKeys.add(key);
    const card = permissionCards.get(event.requestId);
    if (card) {
      renderPermissionCardState(card, "approved", "已允许，Agent 继续执行");
      permissionCards.delete(event.requestId);
    }
    pushTaskStep("Permission Granted", `${event.tool || "tool"} 已允许`, "permission_granted");
    return;
  }

  if (event.type === "permission_denied") {
    const key = `permission_denied:${event.requestId || ""}`;
    if (liveEventKeys.has(key)) return;
    liveEventKeys.add(key);
    const card = permissionCards.get(event.requestId);
    if (card) {
      renderPermissionCardState(card, "denied", "已拒绝，本次操作不会执行");
      permissionCards.delete(event.requestId);
    }
    pushTaskStep("Permission Denied", `${event.tool || "tool"} 已拒绝`, "permission_denied");
    return;
  }

  if (event.type === "verification") {
    const message = formatRuntimeEvent(event);
    if (!message) return;

    if (event.status === "passed") {
      setTaskState("completed", "修复后的验证已通过。");
      pushTaskStep("Verification Passed", event.detail || "本轮修复已完成验证。", "completed");
    } else if (event.status === "dependency_pending") {
      setTaskState("verifying", "正在等待依赖相关复检...");
      pushTaskStep("Dependency Verification", event.detail || "依赖复检待完成。", "warning");
    } else {
      setTaskState("verifying", "已完成修改，正在执行复检...");
      pushTaskStep("Verification Pending", event.detail || "正在等待复检步骤。", "working");
    }

    addTraceMessage(
      event.status === "passed" ? "复检通过" : event.status === "dependency_pending" ? "依赖复检" : "等待复检",
      message,
      event.status === "passed" ? "completed" : event.status === "dependency_pending" ? "verifying" : "working"
    );
    return;
  }

  const message = formatRuntimeEvent(event);
  if (!message) return;

  const key = `${event.type}:${event.step || 0}:${event.tool || ""}:${event.detail || ""}`;
  if (liveEventKeys.has(key)) return;
  liveEventKeys.add(key);

  addTraceMessage(
    event.type === "model_response" ? "工具规划" : "工具结果",
    message,
    event.ok === false ? "error" : event.type === "model_response" ? "tool_running" : "completed"
  );
  pushTaskStep(
    event.type === "model_response" ? "Tool Planning" : "Tool Result",
    message,
    event.ok === false ? "error" : event.type === "model_response" ? "tool_running" : "completed"
  );
}

async function sendPrompt(promptOverride = "") {
  if (promptRunning) {
    const result = await window.vgoDesktop.abortPrompt();
    if (result?.ok) {
      setStatus("正在停止任务...");
      setTaskState("failed", "正在停止本轮任务...");
    }
    return;
  }

  const prompt = (promptOverride || promptInput.value).trim();
  if (!prompt) return;

  const finalPrompt = buildPromptWithAttachments(prompt);
  if (!promptOverride) promptInput.value = "";

  addMessage("user", prompt);
  if (attachments.length) {
    addMessage("system", `已附带 ${attachments.length} 个文件到当前任务。`, "tool-event");
  }

  promptRunning = true;
  renderSendButton();
  setStatus("Agent 正在处理...");
  resetTaskPanel();
  setTaskState("planning", "Agent 正在分析任务并规划执行步骤...");
  pushTaskStep("Task Started", "Agent 已收到任务，准备规划。", "planning");
  addTraceMessage("任务开始", "Agent 已收到任务，正在分析并规划执行步骤。", "planning");

  const pending = createMessage("system", "任务进行中，正在等待引擎返回...", "tool-event");
  try {
    const result = await window.vgoDesktop.sendPrompt(finalPrompt);
    pending.remove();

    for (const event of result.rawEvents || []) {
      handleAgentEvent(event);
    }

    if (result.ok) {
      await streamAssistantMessage(result.text || "已完成，但没有返回文本。");
      setStatus(buildRuntimeMetaText(result) || "响应完成");
      finalizeTaskPanel("completed", "本轮任务已完成，结果已写入对话区。");
      addTraceMessage("任务完成", "本轮任务已完成，结果已写入对话区。", "completed");
    } else {
      await streamAssistantMessage(result.text || result.error || "执行失败", "error");
      setStatus("执行失败");
      finalizeTaskPanel(
        "failed",
        result.text || result.error || "任务执行失败，未返回更多信息。"
      );
      addTraceMessage(
        "任务失败",
        result.text || result.error || "任务执行失败，未返回更多信息。",
        "error"
      );
    }

    attachments = [];
    renderAttachments();
    await refreshState();
    finalizeTaskPanel(
      result.ok ? "completed" : "failed",
      result.ok ? "本轮任务已完成，结果已写入对话区。" : result.text || result.error || "任务执行失败，未返回更多信息。"
    );
    scrollMessagesToBottom();
    scrollTaskPanelToBottom();
  } catch (error) {
    pending.remove();
    await streamAssistantMessage(`执行链路异常：${error.message || "未知错误"}`, "error");
    setStatus("执行异常");
    finalizeTaskPanel("failed", error.message || "未知错误");
    pushTaskStep("Runtime Error", error.message || "未知错误", "error");
    addTraceMessage("执行异常", error.message || "未知错误", "error");
    scrollMessagesToBottom();
    scrollTaskPanelToBottom();
  } finally {
    liveEventKeys.clear();
    promptRunning = false;
    renderSendButton();
  }
}

function startAuthPolling() {
  stopAuthPolling();
  authPollTimer = setInterval(async () => {
    const result = await window.vgoDesktop.getBrowserAuthStatus();
    if (!result || result.status === "waiting" || result.status === "starting") return;

    stopAuthPolling();

    if (result.status === "success" && result.state) {
      authFlowState = "done";
      hydrate(result.state);
      addMessage("system", `已完成真实账户绑定，当前同步账户为：${result.state.settings.vgoAI.displayName}`);
      setStatus("真实账户已登录");
      return;
    }

    authFlowState = "idle";
    if (result.state) {
      hydrate(result.state);
    } else {
      await refreshState();
    }
    addMessage("system", result.message || "网页登录未完成，桌面端保持未登录状态。", "error");
    setStatus("未登录");
  }, 1500);
}

async function runDesktopLoginFlow() {
  authFlowState = "working";
  renderSettings(currentState || { settings: { vgoAI: {}, remoteProfiles: [] } });
  setStatus("正在发起网页登录授权...");

  try {
    const email = vgoAiEmail.value.trim();
    const password = vgoAiPassword.value;
    let result;

    if (!email || !password) {
      result = await window.vgoDesktop.startBrowserVgoAiAuth({
        displayName: vgoAiDisplayName.value.trim(),
        preferredModel: vgoAiModelSelect.value
      });

      if (result.pending) {
        startAuthPolling();
        addMessage("system", result.message || "网页登录窗已打开，请完成授权。", "tool-event");
        setStatus("等待网页登录回调");
        return;
      }
    } else {
      setBusyState(true);
      result = await window.vgoDesktop.loginAndBindVgoAi({
        email,
        password,
        rememberPassword: true,
        displayName: vgoAiDisplayName.value.trim(),
        preferredModel: vgoAiModelSelect.value
      });
    }

    authFlowState = "done";
    hydrate(result.state);
    addMessage("system", `已完成真实账户绑定，当前同步账户为：${result.state.settings.vgoAI.displayName}`);
    setStatus("真实账户已登录");
  } catch (error) {
    authFlowState = "idle";
    await refreshState();
    addMessage("system", `登录流程失败：${error.message || "未知错误"}`, "error");
    setStatus("未登录");
  } finally {
    setBusyState(false);
  }
}

sendButton.addEventListener("click", () => sendPrompt());

uploadButton.addEventListener("click", async () => {
  const files = await window.vgoDesktop.pickFiles();
  if (!files?.length) return;
  const known = new Set(attachments.map((item) => item.path));
  attachments = attachments.concat(files.filter((item) => !known.has(item.path)));
  renderAttachments();
  setStatus(`已添加 ${files.length} 个文件`);
});

promptInput.addEventListener("keydown", (event) => {
  if (currentState?.settings?.behavior?.enterToSend !== false && event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendPrompt();
  }
});

sessionSearchInput.addEventListener("input", () => {
  sessionSearch = sessionSearchInput.value;
  if (currentState) renderSessionList(currentState);
});

engineSelect.addEventListener("change", async () => {
  const next = await window.vgoDesktop.setEngine(engineSelect.value);
  hydrate(next);
  addMessage("system", `当前运行内核已切换为：\n${next.runtime.engineLabel}`);
  setStatus("运行内核已切换");
});

renderSendButton();
setActiveSettingsTab(activeSettingsTab);

remoteProfileSelect.addEventListener("change", async () => {
  hydrate(await window.vgoDesktop.selectRemoteProfile(remoteProfileSelect.value));
  addMessage("system", "已切换远程模型配置档。");
  setStatus("配置档已切换");
});

applyRemoteProfileButton.addEventListener("click", async () => {
  hydrate(await window.vgoDesktop.selectRemoteProfile(remoteProfileSelect.value));
  addMessage("system", "当前远程引擎已应用所选配置档。");
  setStatus("远程配置已应用");
});

newRemoteProfileButton.addEventListener("click", async () => {
  const next = await window.vgoDesktop.createRemoteProfile({
    name: remoteProfileName.value.trim(),
    provider: remoteProviderName.value.trim(),
    baseUrl: remoteBaseUrl.value.trim(),
    model: remoteModel.value.trim(),
    apiKey: remoteApiKey.value.trim(),
    systemPrompt: remoteSystemPrompt.value
  });
  hydrate(next);
  addMessage("system", "新的模型配置档已创建。");
  setStatus("配置档已创建");
});

deleteRemoteProfileButton.addEventListener("click", async () => {
  hydrate(await window.vgoDesktop.deleteRemoteProfile(remoteProfileSelect.value));
  addMessage("system", "所选模型配置档已删除。");
  setStatus("配置档已删除");
});

syncModelsButton.addEventListener("click", async () => {
  hydrate(await window.vgoDesktop.syncVgoAiModels());
  addMessage("system", "已同步 VGO AI 模型目录。");
  setStatus("模型已同步");
});

bindVgoAiButton.addEventListener("click", () => runDesktopLoginFlow());

saveProfileButton.addEventListener("click", async () => {
  const next = await window.vgoDesktop.updateVgoAiProfile({
    email: vgoAiEmail.value.trim(),
    password: vgoAiPassword.value,
    rememberPassword: true,
    displayName: vgoAiDisplayName.value.trim(),
    preferredModel: vgoAiModelSelect.value
  });
  hydrate(next);
  addMessage("system", "账号、密码记忆与默认模型已保存。");
  setStatus("账号配置已保存");
});

vgoAiModelSelect.addEventListener("change", async () => {
  const next = await window.vgoDesktop.updateVgoAiProfile({
    email: vgoAiEmail.value.trim(),
    password: vgoAiPassword.value,
    rememberPassword: true,
    displayName: vgoAiDisplayName.value.trim(),
    preferredModel: vgoAiModelSelect.value
  });
  hydrate(next);
  addMessage("system", `默认模型已切换为：${getModelLabel(next, vgoAiModelSelect.value)}`);
  setStatus("默认模型已切换");
});

permissionDefaultButton.addEventListener("click", async () => {
  const next = await window.vgoDesktop.updatePermissions({ mode: "default" });
  hydrate(next);
  addMessage("system", "执行权限已切换为：默认权限。危险操作会二次确认。", "tool-event");
  setStatus("权限模式：默认");
});

accessWorkspaceButton.addEventListener("click", async () => {
  const next = await window.vgoDesktop.updateAccess({ scope: "workspace-only" });
  hydrate(next);
  addMessage("system", "访问范围已切换为：仅工作区。", "tool-event");
  setStatus("访问范围：工作区");
});

accessDesktopButton.addEventListener("click", async () => {
  const next = await window.vgoDesktop.updateAccess({ scope: "workspace-and-desktop" });
  hydrate(next);
  addMessage("system", "访问范围已切换为：工作区 + 桌面。", "tool-event");
  setStatus("访问范围：工作区 + 桌面");
});

accessGlobalButton.addEventListener("click", async () => {
  const next = await window.vgoDesktop.updateAccess({ scope: "full-system" });
  hydrate(next);
  addMessage("system", "访问范围已切换为：全局访问。危险操作仍会按权限模式确认。", "tool-event");
  setStatus("访问范围：全局访问");
});

permissionFullAccessButton.addEventListener("click", async () => {
  const next = await window.vgoDesktop.updatePermissions({ mode: "full-access" });
  hydrate(next);
  addMessage("system", "执行权限已切换为：完全访问。Agent 可以直接执行本地写入和命令操作。", "tool-event");
  setStatus("权限模式：完全访问");
});

logoutButton.addEventListener("click", async () => {
  stopAuthPolling();
  authFlowState = "idle";
  hydrate(await window.vgoDesktop.logoutVgoAi());
  addMessage("system", "已退出 VGO AI 登录状态。");
  setStatus("已退出登录");
});

saveSettingsButton.addEventListener("click", async () => {
  const next = await window.vgoDesktop.updateRemoteSettings({
    baseUrl: remoteBaseUrl.value.trim(),
    model: remoteModel.value.trim(),
    apiKey: remoteApiKey.value.trim(),
    systemPrompt: remoteSystemPrompt.value,
    profileId: remoteProfileSelect.value,
    name: remoteProfileName.value.trim(),
    provider: remoteProviderName.value.trim()
  });
  hydrate(next);
  addMessage("system", "当前模型配置档已保存。");
  setStatus("配置档已保存");
});

newSessionButton.addEventListener("click", async () => {
  const result = await window.vgoDesktop.createSession();
  hydrate(result.state);
  resetTaskPanel();
  addMessage("system", "已创建新线程。");
  setStatus("新线程已创建");
});

pickWorkspaceButton.addEventListener("click", async () => {
  const result = await window.vgoDesktop.pickWorkspace();
  if (!result) return;
  hydrate(result);
  addMessage("system", `工作目录已切换到：\n${result.workspace}`);
  setStatus("目录已切换");
});

renameSessionButton.addEventListener("click", () => {
  openRenameDialog();
});

resetSessionButton.addEventListener("click", async () => {
  await window.vgoDesktop.resetSession();
  await refreshState();
  resetTaskPanel();
  addMessage("system", "当前线程已重置。");
  setStatus("线程已重置");
});

loginButton.addEventListener("click", async () => {
  await window.vgoDesktop.openExternal("https://vgoai.cn/login");
  addMessage("system", "已打开 VGO AI 网页登录页。");
  setStatus("网页登录页已打开");
});

docsButton.addEventListener("click", () => {
  window.vgoDesktop.openPath("E:\\VGO-CODE\\README.md");
});

analyzeButton.addEventListener("click", async () => {
  const result = await window.vgoDesktop.analyzeWorkspace();
  addMessage("system", result.summary);
  setStatus("目录分析已生成");
});

healthButton.addEventListener("click", async () => {
  setStatus("正在检查当前引擎状态...");
  const result = await window.vgoDesktop.runHealthCheck();
  addMessage("system", `${result.title}\n\n${result.details}`, result.ok ? "" : "error");
  setStatus(result.title);
});

exportButton.addEventListener("click", async () => {
  const result = await window.vgoDesktop.exportHistory();
  if (result?.ok) {
    addMessage("system", `线程已导出到：\n${result.filePath}`);
    setStatus("线程已导出");
  }
});

clearButton.addEventListener("click", async () => {
  await window.vgoDesktop.clearHistory();
  await refreshState();
  resetTaskPanel();
  addMessage("system", "当前线程历史已清空。");
  setStatus("历史已清空");
});

for (const button of templateButtons) {
  button.addEventListener("click", () => {
    promptInput.value = button.dataset.template || "";
    promptInput.focus();
  });
}

sidebarSettingsButton.addEventListener("click", openSettings);
closeSettingsButton.addEventListener("click", closeSettings);
settingsOverlay.addEventListener("click", (event) => {
  if (event.target === settingsOverlay) {
    closeSettings();
  }
});

renameOverlay.addEventListener("click", (event) => {
  if (event.target === renameOverlay) {
    closeRenameDialog();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !settingsOverlay.classList.contains("hidden")) {
    closeSettings();
  }
  if (event.key === "Escape" && !renameOverlay.classList.contains("hidden")) {
    closeRenameDialog();
  }
});

closeRenameButton.addEventListener("click", closeRenameDialog);
cancelRenameButton.addEventListener("click", closeRenameDialog);
confirmRenameButton.addEventListener("click", async () => {
  const title = renameSessionInput.value.trim();
  const next = await window.vgoDesktop.renameSession({
    sessionId: currentState.activeSessionId,
    title
  });
  hydrate(next);
  closeRenameDialog();
  addMessage("system", "当前线程名称已更新。");
  setStatus("线程已重命名");
});

renameSessionInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    confirmRenameButton.click();
  }
});

for (const item of settingsNavItems) {
  item.addEventListener("click", () => setActiveSettingsTab(item.dataset.settingsTab));
}

for (const card of themeCards) {
  card.addEventListener("click", async () => {
    hydrate(await window.vgoDesktop.updateAppearance({ theme: card.dataset.themeValue }));
  });
}

for (const button of uiModeButtons) {
  button.addEventListener("click", async () => {
    hydrate(await window.vgoDesktop.updateAppearance({ uiMode: button.dataset.uiModeValue }));
  });
}

for (const button of localeButtons) {
  button.addEventListener("click", async () => {
    hydrate(await window.vgoDesktop.updateLocalization({ locale: button.dataset.localeValue }));
  });
}

messageDensitySelect.addEventListener("change", async () => {
  hydrate(await window.vgoDesktop.updateAppearance({ messageDensity: messageDensitySelect.value }));
});

compactModeToggle.addEventListener("change", async () => {
  hydrate(await window.vgoDesktop.updateAppearance({ compactMode: compactModeToggle.checked }));
});

enterToSendToggle.addEventListener("change", async () => {
  hydrate(await window.vgoDesktop.updateBehavior({ enterToSend: enterToSendToggle.checked }));
});

autoScrollToggle.addEventListener("change", async () => {
  hydrate(await window.vgoDesktop.updateBehavior({ autoScroll: autoScrollToggle.checked }));
});

showTaskPanelToggle.addEventListener("change", async () => {
  hydrate(await window.vgoDesktop.updateBehavior({ showTaskPanel: showTaskPanelToggle.checked }));
});

confirmDangerousOpsToggle.addEventListener("change", async () => {
  hydrate(await window.vgoDesktop.updateBehavior({ confirmDangerousOps: confirmDangerousOpsToggle.checked }));
});

autoSummarizeToggle.addEventListener("change", async () => {
  hydrate(await window.vgoDesktop.updateAgentPreferences({ autoSummarizeContext: autoSummarizeToggle.checked }));
});

showRuntimeMetaToggle.addEventListener("change", async () => {
  hydrate(await window.vgoDesktop.updateAgentPreferences({ showRuntimeMeta: showRuntimeMetaToggle.checked }));
});

showExecutionPlanToggle.addEventListener("change", async () => {
  hydrate(await window.vgoDesktop.updateAgentPreferences({ showExecutionPlan: showExecutionPlanToggle.checked }));
});

compressionThresholdRange.addEventListener("input", () => {
  compressionThresholdValue.textContent = `${compressionThresholdRange.value}%`;
});

compressionThresholdRange.addEventListener("change", async () => {
  hydrate(
    await window.vgoDesktop.updateAgentPreferences({
      contextCompressionThreshold: Number(compressionThresholdRange.value) / 100
    })
  );
});

fallbackModelSelect.addEventListener("change", async () => {
  const next = await window.vgoDesktop.updateAgentPreferences({
    fallbackModel: fallbackModelSelect.value
  });
  hydrate(next);
  addMessage(
    "system",
    fallbackModelSelect.value
      ? `全局保底模型已设置为：${getModelLabel(next, fallbackModelSelect.value)}`
      : "全局保底模型已切回自动选择。",
    "tool-event"
  );
  setStatus("保底模型配置已更新");
});

window.vgoDesktop.onAgentEvent((event) => {
  handleAgentEvent(event);
  if (event?.type === "permission_requested") {
    setStatus("等待工具权限确认");
  } else if (event?.type === "permission_granted") {
    setStatus("工具权限已允许");
  } else if (event?.type === "permission_denied") {
    setStatus("工具权限已拒绝");
  } else if (event?.type === "task_status" && event.message) {
    setStatus(event.message);
  }
});

resetTaskPanel();
refreshState().then(() => {
  if (!messages.children.length) {
    addMessage("system", "VGO-CODE 已就绪。左侧管理账户、模型和线程，右侧直接发起任务。", "tool-event");
  }
});
