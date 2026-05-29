const path = require("node:path");
const fs = require("node:fs");

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".js", ".ts", ".jsx", ".tsx", ".css", ".html", ".xml", ".yml", ".yaml", ".py", ".java", ".cs", ".go", ".rs", ".sh", ".ps1", ".bat", ".env"]);

function readAttachmentPreview(filePath) {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isText = TEXT_EXTENSIONS.has(ext) && stat.size <= 256 * 1024;
  const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
  const audioExtensions = new Set([".mp3", ".wav", ".m4a", ".flac", ".ogg"]);
  const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm"]);
  const imageBase64 = imageExtensions.has(ext) && stat.size <= 10 * 1024 * 1024 ? fs.readFileSync(filePath).toString("base64") : "";
  const mediaType = imageExtensions.has(ext) ? "image" : audioExtensions.has(ext) ? "audio" : videoExtensions.has(ext) ? "video" : "file";
  return { name: path.basename(filePath), path: filePath, size: stat.size, isText, mediaType, imageBase64, content: isText ? fs.readFileSync(filePath, "utf8") : "" };
}

async function exportHistory(store, dialog) {
  const state = store.getState();
  const session = store.getActiveSession();
  if (!session) return { ok: false, canceled: true };
  const defaultFile = path.join(state.workspace, `vgo-session-${session.id.slice(0, 8)}.md`);
  const result = await dialog.showSaveDialog({ defaultPath: defaultFile, filters: [{ name: "Markdown", extensions: ["md"] }] });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  const body = ["# VGO CODE Session Export", "", `Workspace: ${state.workspace}`, `Session ID: ${session.id}`, `Session Title: ${session.title}`, `Runtime: ${state.runtime.engineLabel}`, `Provider: ${state.runtime.providerLabel}`, `Exported At: ${new Date().toISOString()}`, "", ...session.history.map((item) => [`## ${item.role.toUpperCase()}`, "", item.text, ""].join("\n"))].join("\n");
  fs.writeFileSync(result.filePath, body, "utf8");
  return { ok: true, filePath: result.filePath };
}

function registerHandlers(ipcMain, ctx) {
  ipcMain.handle("workspace:analyze", async () => {
    const workspace = ctx.store.getState().workspace;
    if (!workspace) return { ok: false, error: "no_workspace", summary: "请先选择工作区目录。" };
    const { analyzeWorkspace } = require("../core/workspaceTools");
    const result = analyzeWorkspace(workspace);
    ctx.store.appendHistory("system", result.summary);
    ctx.sendAgentEvent({ sessionId: ctx.store.getState().activeSessionId || "global", type: "task_status", status: "completed", message: "Workspace analysis completed." });
    ctx.sendStateRefresh();
    return result;
  });

  ipcMain.handle("app:getState", () => ctx.serializeState());
  ipcMain.handle("app:healthCheck", () => ctx.activeEngine().runHealthCheck(ctx.store.getState().workspace, ctx.getSettings()));
  ipcMain.handle("history:export", () => exportHistory(ctx.store, ctx.dialog));
  ipcMain.handle("shell:openPath", (_event, target) => ctx.shell.openPath(target));
  ipcMain.handle("shell:openExternal", (_event, target) => ctx.shell.openExternal(target));
  ipcMain.handle("auth:openLoginTerminal", () => { ctx.activeEngine().openLoginShell(ctx.store.getState().workspace, ctx.getSettings()); return { ok: true }; });

  ipcMain.handle("dialog:pickWorkspace", async () => {
    const result = await ctx.dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    ctx.store.setWorkspace(result.filePaths[0]);
    return ctx.serializeState();
  });

  ipcMain.handle("dialog:pickFiles", async () => {
    const result = await ctx.dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
    if (result.canceled || result.filePaths.length === 0) return [];
    return result.filePaths.map((filePath) => readAttachmentPreview(filePath));
  });

  ipcMain.handle("attachments:remove", async (_event, index) => {
    if (typeof index !== "number" || index < 0) return { ok: false, error: "Invalid attachment index" };
    return { ok: true };
  });
}

module.exports = { registerHandlers };
