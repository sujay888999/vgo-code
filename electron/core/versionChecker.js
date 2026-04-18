const http = require("node:http");
const https = require("node:https");
const { app } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "version-check.log");

const DEFAULT_UPDATE_SETTINGS = {
  autoCheck: true,
  checkIntervalHours: 6,
  skipVersion: "",
  lastCheckTime: 0,
  updateChannel: "stable"
};

let updateSettings = { ...DEFAULT_UPDATE_SETTINGS };

function getSettingsFilePath() {
  return path.join(app.getPath("userData"), "version-update-settings.json");
}

function loadUpdateSettings() {
  const file = getSettingsFilePath();
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      updateSettings = { ...DEFAULT_UPDATE_SETTINGS, ...parsed };
    }
  } catch {}
  return updateSettings;
}

function saveUpdateSettings() {
  const file = getSettingsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(updateSettings, null, 2), "utf8");
}

function appendVersionLog(message) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, logEntry, "utf8");
  } catch {}
}

function compareVersions(current, latest) {
  const currentParts = current.split(".").map(Number);
  const latestParts = latest.split(".").map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const a = currentParts[i] || 0;
    const b = latestParts[i] || 0;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

function isNewerVersion(currentVersion, latestVersion) {
  return compareVersions(currentVersion, latestVersion) < 0;
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const timeout = options.timeout || 10000;

    const request = protocol.get(url, { timeout }, (response) => {
      let data = "";
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ version: null, error: "Invalid JSON response" });
        }
      });
    });

    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Request timeout"));
    });

    request.on("error", (error) => {
      reject(error);
    });
  });
}

async function fetchLatestVersion(updateUrl) {
  if (!updateUrl) {
    return { ok: false, error: "No update URL configured" };
  }

  appendVersionLog(`Fetching latest version from: ${updateUrl}`);

  try {
    const response = await httpRequest(updateUrl, { timeout: 15000 });

    if (response.error) {
      appendVersionLog(`Error fetching version: ${response.error}`);
      return { ok: false, error: response.error };
    }

    const latestVersion = response.version || response.tag?.replace(/^v/, "") || null;
    const downloadUrl =
      response.downloadUrl ||
      response.download_url ||
      response.html_url ||
      response.url ||
      "";
    const releaseNotes =
      response.releaseNotes ||
      response.release_notes ||
      response.body ||
      response.description ||
      "";
    const releaseDate = response.published_at || response.releaseDate || response.date || "";

    appendVersionLog(`Latest version: ${latestVersion}, Download URL: ${downloadUrl}`);

    return {
      ok: true,
      version: latestVersion,
      downloadUrl,
      releaseNotes,
      releaseDate
    };
  } catch (error) {
    appendVersionLog(`Exception fetching version: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

async function checkForUpdates(appVersion, updateConfig = {}) {
  const {
    updateUrl = "https://vgoai.cn/downloads/vgo-code/version.json",
    force = false
  } = updateConfig;

  const currentVersion = appVersion || app.getVersion() || "1.0.0";

  appendVersionLog(`Checking for updates. Current version: ${currentVersion}`);

  if (!force) {
    loadUpdateSettings();

    if (updateSettings.skipVersion === currentVersion) {
      appendVersionLog("Current version is marked to skip");
      return { ok: true, updateAvailable: false, reason: "version_skipped" };
    }

    const now = Date.now();
    const intervalMs = (updateSettings.checkIntervalHours || 6) * 60 * 60 * 1000;
    if (now - updateSettings.lastCheckTime < intervalMs) {
      appendVersionLog("Skipping check: within interval");
      return { ok: true, updateAvailable: false, reason: "too_soon" };
    }
  }

  const result = await fetchLatestVersion(updateUrl);

  updateSettings.lastCheckTime = Date.now();
  saveUpdateSettings();

  if (!result.ok) {
    return { ok: false, error: result.error, updateAvailable: false };
  }

  const updateAvailable = result.version && isNewerVersion(currentVersion, result.version);

  appendVersionLog(`Update check complete. Available: ${updateAvailable}, Latest: ${result.version}`);

  return {
    ok: true,
    updateAvailable,
    currentVersion,
    latestVersion: result.version,
    downloadUrl: result.downloadUrl,
    releaseNotes: result.releaseNotes,
    releaseDate: result.releaseDate
  };
}

function skipVersion(version) {
  loadUpdateSettings();
  updateSettings.skipVersion = version;
  saveUpdateSettings();
  appendVersionLog(`Skipped version: ${version}`);
}

function resetSkipVersion() {
  loadUpdateSettings();
  updateSettings.skipVersion = "";
  saveUpdateSettings();
  appendVersionLog("Skip version reset");
}

function setAutoCheck(enabled, intervalHours = 6) {
  loadUpdateSettings();
  updateSettings.autoCheck = enabled;
  updateSettings.checkIntervalHours = intervalHours;
  saveUpdateSettings();
  appendVersionLog(`Auto check: ${enabled}, Interval: ${intervalHours}h`);
}

function getUpdateSettings() {
  loadUpdateSettings();
  return { ...updateSettings };
}

async function initializeAutoCheck(appVersion, updateConfig = {}) {
  loadUpdateSettings();

  if (!updateSettings.autoCheck) {
    appendVersionLog("Auto check disabled");
    return null;
  }

  const now = Date.now();
  const intervalMs = (updateSettings.checkIntervalHours || 6) * 60 * 60 * 1000;

  if (now - updateSettings.lastCheckTime < intervalMs) {
    appendVersionLog("Skipping initial check: within interval");
    return null;
  }

  return await checkForUpdates(appVersion, updateConfig);
}

module.exports = {
  checkForUpdates,
  skipVersion,
  resetSkipVersion,
  setAutoCheck,
  getUpdateSettings,
  initializeAutoCheck,
  compareVersions,
  isNewerVersion,
  DEFAULT_UPDATE_SETTINGS
};
