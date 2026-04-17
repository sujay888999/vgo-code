"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * electron-builder hook: keep it lightweight and deterministic.
 * Missing hook file previously caused packaging to fail.
 */
module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir || "";
  const executableName = `${context.packager.appInfo.productFilename || "VGO CODE"}.exe`;
  const exePath = path.join(appOutDir, executableName);

  if (!appOutDir) {
    console.warn("[afterPack] appOutDir is empty, skip post-pack checks.");
    return;
  }

  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPack] executable not found: ${exePath}`);
    return;
  }

  const stat = fs.statSync(exePath);
  console.log(`[afterPack] verified executable: ${exePath} (${stat.size} bytes)`);
};
