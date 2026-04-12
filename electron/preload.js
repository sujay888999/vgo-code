const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vgoDesktop", {
  // State
  getState: () => ipcRenderer.invoke("app:getState"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  normalizeEngineLog: () => ipcRenderer.invoke("logs:normalizeEngine"),
  
  // Session management
  createSession: () => ipcRenderer.invoke("chat:createSession"),
  resetSession: () => ipcRenderer.invoke("chat:resetSession"),
  renameSession: (title, sessionId) => ipcRenderer.invoke("chat:renameSession", { sessionId: sessionId || null, title }),
  switchSession: (sessionId) => ipcRenderer.invoke("chat:switchSession", sessionId),
  togglePinSession: (sessionId) => ipcRenderer.invoke("chat:togglePinSession", sessionId),
  deleteSession: (sessionId) => ipcRenderer.invoke("chat:deleteSession", sessionId),
  updateSession: (sessionId, meta) => ipcRenderer.invoke("chat:updateSession", { sessionId, ...meta }),
  
  // Chat
  submitPrompt: (payload) => ipcRenderer.invoke("chat:send", payload),
  stopPrompt: () => ipcRenderer.invoke("chat:abort"),
  
  // Workspace
  pickWorkspace: () => ipcRenderer.invoke("dialog:pickWorkspace"),
  analyze: () => ipcRenderer.invoke("workspace:analyze"),
  
  // Auth
  login: () => ipcRenderer.invoke("settings:startBrowserVgoAiAuth", { displayName: "VGO Developer", preferredModel: "vgo-coder-pro" }),
  loginWithCredentials: (payload) => ipcRenderer.invoke("settings:loginAndBindVgoAi", payload),
  logout: () => ipcRenderer.invoke("settings:logoutVgoAi"),
  getAuthStatus: () => ipcRenderer.invoke("settings:getBrowserAuthStatus"),
  syncModels: () => ipcRenderer.invoke("settings:syncVgoAiModels"),
  
  // Files
  attachFile: () => ipcRenderer.invoke("dialog:pickFiles"),
  removeAttachment: (index) => ipcRenderer.invoke("attachments:remove", index),
  
  // Settings
  updateAppearance: (payload) => ipcRenderer.invoke("settings:updateAppearance", payload),
  updateLocalization: (payload) => ipcRenderer.invoke("settings:updateLocalization", payload),
  updateBehavior: (payload) => ipcRenderer.invoke("settings:updateBehavior", payload),
  updateAgentPreferences: (payload) => ipcRenderer.invoke("settings:updateAgentPreferences", payload),
  updateSkillState: (payload) => ipcRenderer.invoke("settings:updateSkillState", payload),
  updateVgoAiProfile: (payload) => ipcRenderer.invoke("settings:updateVgoAiProfile", payload),
  updatePermissions: (payload) => ipcRenderer.invoke("settings:updatePermissions", payload),
  updateAccess: (payload) => ipcRenderer.invoke("settings:updateAccess", payload),
  respondPermission: (payload) => ipcRenderer.invoke("permissions:respond", payload),
  updateRemote: (payload) => ipcRenderer.invoke("settings:updateRemote", payload),
  createRemoteProfile: (payload) => ipcRenderer.invoke("settings:createRemoteProfile", payload),
  updateRemoteProfile: (profileId, payload) =>
    ipcRenderer.invoke("settings:updateRemoteProfile", { profileId, payload }),
  deleteRemoteProfile: (profileId) =>
    ipcRenderer.invoke("settings:deleteRemoteProfile", profileId),
  selectRemoteProfile: (profileId) => ipcRenderer.invoke("settings:selectRemoteProfile", profileId),
  
  // Runtime
  setEngine: (engineId) => ipcRenderer.invoke("runtime:setEngine", engineId),
  installWhisper: () => ipcRenderer.invoke("runtime:installWhisper"),
  installSkill: (payload) => ipcRenderer.invoke("runtime:installSkill", payload),
  
  // Update
  checkForUpdates: (payload) => ipcRenderer.invoke("update:check", payload || {}),
  skipVersion: (version) => ipcRenderer.invoke("update:skipVersion", version),
  resetSkipVersion: () => ipcRenderer.invoke("update:resetSkip"),
  setAutoCheck: (enabled, intervalHours) => ipcRenderer.invoke("update:setAutoCheck", enabled, intervalHours),
  getUpdateSettings: () => ipcRenderer.invoke("update:getSettings"),
  
  // Events
  on: (channel, callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  }
});

// Forward auth state updates to renderer
ipcRenderer.on("auth:stateUpdate", (_event, state) => {
  console.log("Received auth:stateUpdate:", state.status);
  window.dispatchEvent(new CustomEvent("vgoAuthStateUpdate", { detail: state }));
});

// Forward state refresh to renderer
ipcRenderer.on("app:stateRefresh", (_event, state) => {
  console.log("Received app:stateRefresh");
  window.dispatchEvent(new CustomEvent("vgoStateRefresh", { detail: state }));
});

// Forward agent events to renderer
ipcRenderer.on("agent:event", (_event, payload) => {
  console.log("Received agent:event:", payload);
  window.dispatchEvent(new CustomEvent("vgoAgentEvent", { detail: payload }));
});

// Forward update available events to renderer
ipcRenderer.on("update:available", (_event, payload) => {
  console.log("Received update:available:", payload);
  window.dispatchEvent(new CustomEvent("vgoUpdateAvailable", { detail: payload }));
});
