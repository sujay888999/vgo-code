const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const { spawn } = require("node:child_process");

function sanitizeFileName(name = "") {
  return String(name || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
}

function resolveInstallerFileName(downloadUrl = "", latestVersion = "") {
  try {
    const parsedUrl = new URL(downloadUrl);
    const fromUrl = sanitizeFileName(path.basename(decodeURIComponent(parsedUrl.pathname || "")));
    if (fromUrl) return fromUrl;
  } catch {}
  return `VGO CODE Setup ${String(latestVersion || "").trim() || "latest"}.exe`;
}

async function downloadInstallerFile(downloadUrl, targetPath, onProgress) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const fetchFile = (url, redirectCount = 0) => {
      if (redirectCount > 5) { reject(new Error("Too many redirects")); return; }
      const client = String(url).startsWith("https://") ? https : http;
      const request = client.get(url, (response) => {
        const statusCode = Number(response.statusCode || 0);
        const redirectLocation = response.headers?.location;
        if (statusCode >= 300 && statusCode < 400 && redirectLocation) {
          response.resume();
          fetchFile(new URL(redirectLocation, url).toString(), redirectCount + 1);
          return;
        }
        if (statusCode !== 200) { response.resume(); reject(new Error(`Download failed with HTTP ${statusCode}`)); return; }
        const output = fs.createWriteStream(targetPath);
        const totalBytes = Number(response.headers?.["content-length"] || 0);
        let downloadedBytes = 0;
        const startedAt = Date.now();
        let lastEmitAt = 0;
        const emitProgress = (force) => {
          if (typeof onProgress !== "function") return;
          const now = Date.now();
          if (!force && now - lastEmitAt < 200) return;
          lastEmitAt = now;
          onProgress({ downloadedBytes, totalBytes, speedBytesPerSec: Math.max(0, Math.round((downloadedBytes * 1000) / Math.max(1, now - startedAt))), progressPercent: totalBytes > 0 ? Math.min(100, (downloadedBytes / totalBytes) * 100) : 0 });
        };
        response.on("data", (chunk) => { downloadedBytes += chunk?.length || 0; emitProgress(false); });
        response.on("end", () => emitProgress(true));
        response.pipe(output);
        output.on("finish", () => output.close(() => resolve(targetPath)));
        output.on("error", (error) => { output.destroy(); fsp.unlink(targetPath).catch(() => {}); reject(error); });
      });
      request.on("error", reject);
      request.setTimeout(120000, () => request.destroy(new Error("Installer download timed out")));
    };
    fetchFile(downloadUrl);
  });
}

function resolveUpgradeScriptTemplatePath(app, isPackaged) {
  if (isPackaged) return path.join(process.resourcesPath, "app.asar", "electron", "core", "scripts", "install-update.ps1");
  return path.join(app.getAppPath(), "electron", "core", "scripts", "install-update.ps1");
}

function launchWindowsInstallerDirect(installerPath) {
  const child = spawn(installerPath, ["/S"], { detached: true, stdio: "ignore", windowsHide: true, cwd: path.dirname(installerPath) });
  child.unref();
  return Boolean(child?.pid);
}

async function launchWindowsUpgradeScript(installerPath, app, isPackaged) {
  const updateDir = path.join(app.getPath("userData"), "updates");
  await fsp.mkdir(updateDir, { recursive: true });
  const scriptContent = await fsp.readFile(resolveUpgradeScriptTemplatePath(app, isPackaged), "utf8");
  const tempScriptPath = path.join(updateDir, `install-update-${Date.now()}.ps1`);
  await fsp.writeFile(tempScriptPath, scriptContent, "utf8");
  const logPath = path.join(updateDir, "install-update.log");
  try { await fsp.appendFile(logPath, `${new Date().toISOString()} launch script=${tempScriptPath} installer=${installerPath}\n`, "utf8"); } catch {}
  const processHandle = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tempScriptPath, "-InstallerPath", installerPath, "-AppExePath", process.execPath, "-LogPath", logPath], { detached: true, stdio: "ignore", windowsHide: true });
  processHandle.unref();
  return Boolean(processHandle?.pid);
}

async function installUpdatePackage(payload, ctx) {
  const { app, sendUpdateEvent } = ctx;
  const updateInfo = {
    currentVersion: app.getVersion(),
    latestVersion: payload.latestVersion || ctx.lastDetectedUpdate?.latestVersion || "",
    downloadUrl: payload.downloadUrl || ctx.lastDetectedUpdate?.downloadUrl || "",
    releaseNotes: payload.releaseNotes || ctx.lastDetectedUpdate?.releaseNotes || "",
    releaseDate: payload.releaseDate || ctx.lastDetectedUpdate?.releaseDate || ""
  };
  if (!updateInfo.downloadUrl) return { ok: false, error: "missing_download_url" };
  if (process.platform !== "win32") { await ctx.shell.openExternal(updateInfo.downloadUrl); return { ok: true, mode: "external_download" }; }
  try {
    sendUpdateEvent("update:status", { status: "downloading", ...updateInfo });
    const targetPath = path.join(app.getPath("userData"), "updates", resolveInstallerFileName(updateInfo.downloadUrl, updateInfo.latestVersion));
    await downloadInstallerFile(updateInfo.downloadUrl, targetPath, (progress) => sendUpdateEvent("update:status", { status: "downloading", ...updateInfo, ...progress }));
    const installerStat = await fsp.stat(targetPath);
    if (!installerStat?.size || installerStat.size < 1024 * 1024) throw new Error("Downloaded installer is invalid or incomplete");
    sendUpdateEvent("update:status", { status: "downloaded", installerPath: targetPath, ...updateInfo });
    sendUpdateEvent("update:status", { status: "installing", installerPath: targetPath, ...updateInfo });
    let launched = launchWindowsInstallerDirect(targetPath);
    if (!launched) launched = await launchWindowsUpgradeScript(targetPath, app, ctx.appIsPackaged);
    if (!launched) throw new Error("Failed to launch updater script");
    sendUpdateEvent("update:status", { status: "restarting", installerPath: targetPath, ...updateInfo });
    setTimeout(() => { app.isQuitting = true; app.exit(0); }, 1500);
    return { ok: true, mode: "auto_upgrade", installerPath: targetPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendUpdateEvent("update:status", { status: "failed", error: message, ...updateInfo });
    return { ok: false, error: message };
  }
}

function registerHandlers(ipcMain, ctx) {
  const updateUrl = ctx.UPDATE_URL;
  const { checkForUpdates, skipVersion, resetSkipVersion, setAutoCheck, getUpdateSettings, initializeAutoCheck } = require("../core/versionChecker");

  if (ctx.mainWindow) {
    ctx.mainWindow.webContents.once("did-finish-load", async () => {
      const hasUpdate = await (async () => {
        try {
          const result = await checkForUpdates(ctx.app.getVersion(), { updateUrl, force: true });
          if (result?.updateAvailable) { ctx.lastDetectedUpdate = { currentVersion: result.currentVersion, latestVersion: result.latestVersion, downloadUrl: result.downloadUrl, releaseNotes: result.releaseNotes, releaseDate: result.releaseDate }; return true; }
        } catch {} return false;
      })();
      if (hasUpdate && ctx.lastDetectedUpdate) setTimeout(() => ctx.sendUpdateEvent("update:available", ctx.lastDetectedUpdate), 1000);
    });
  }

  setInterval(async () => {
    const hasUpdate = await (async () => {
      try {
        const result = await checkForUpdates(ctx.app.getVersion(), { updateUrl, force: true });
        if (result?.updateAvailable) { ctx.lastDetectedUpdate = { currentVersion: result.currentVersion, latestVersion: result.latestVersion, downloadUrl: result.downloadUrl, releaseNotes: result.releaseNotes, releaseDate: result.releaseDate }; return true; }
      } catch {} return false;
    })();
    if (hasUpdate && ctx.lastDetectedUpdate) ctx.sendUpdateEvent("update:available", ctx.lastDetectedUpdate);
  }, 6 * 60 * 60 * 1000);

  ipcMain.handle("update:check", async (_event, payload = {}) => {
    const result = await checkForUpdates(ctx.app.getVersion(), { updateUrl: payload.updateUrl || updateUrl, force: payload.force || false });
    if (result.ok && result.updateAvailable && ctx.mainWindow) {
      ctx.lastDetectedUpdate = { currentVersion: result.currentVersion, latestVersion: result.latestVersion, downloadUrl: result.downloadUrl, releaseNotes: result.releaseNotes, releaseDate: result.releaseDate };
      ctx.sendUpdateEvent("update:available", ctx.lastDetectedUpdate);
    }
    return result;
  });
  ipcMain.handle("update:install", async (_event, payload = {}) => installUpdatePackage(payload, ctx));
  ipcMain.handle("update:skipVersion", (_event, version) => { skipVersion(version); return { ok: true }; });
  ipcMain.handle("update:resetSkip", () => { resetSkipVersion(); return { ok: true }; });
  ipcMain.handle("update:setAutoCheck", (_event, enabled, intervalHours) => { setAutoCheck(enabled, intervalHours); return { ok: true }; });
  ipcMain.handle("update:getSettings", () => getUpdateSettings());
}

module.exports = { registerHandlers };
