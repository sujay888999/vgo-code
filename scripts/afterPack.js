"use strict";

const fs = require("node:fs");
const path = require("node:path");

function currentPlatformSuffix() {
  const archMap = { x64: "x64", arm64: "arm64" };
  const platformMap = { win32: "win32", darwin: "darwin", linux: "linux" };
  return `${archMap[process.arch] || "x64"}-${platformMap[process.platform] || process.platform}`;
}

function dirSize(dirPath) {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) total += dirSize(fullPath);
      else if (entry.isFile()) total += fs.statSync(fullPath).size;
    }
  } catch { /* ignore */ }
  return total;
}

function cleanVendor(vendorDir) {
  const appDir = path.join(vendorDir, "..");
  if (!fs.existsSync(vendorDir)) {
    console.warn(`[afterPack] vendor dir not found: ${vendorDir}`);
    return;
  }

  const currentSuffix = currentPlatformSuffix();
  let totalSaved = 0;

  const metadataFiles = ["cli.js.map", "bun.lock", "LICENSE.md", "README.md", "sdk-tools.d.ts"];
  for (const file of metadataFiles) {
    const fp = path.join(vendorDir, file);
    if (fs.existsSync(fp)) {
      const sz = fs.statSync(fp).size;
      fs.unlinkSync(fp);
      totalSaved += sz;
      console.log(`  [cleanVendor] removed ${file} (${(sz / 1024 / 1024).toFixed(1)} MB)`);
    }
  }

  for (const sub of ["vendor/ripgrep", "vendor/audio-capture"]) {
    const subDir = path.join(vendorDir, sub);
    if (!fs.existsSync(subDir)) continue;
    const entries = fs.readdirSync(subDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== currentSuffix) {
        const fp = path.join(subDir, entry.name);
        const sz = dirSize(fp);
        fs.rmSync(fp, { recursive: true, force: true });
        totalSaved += sz;
        console.log(`  [cleanVendor] removed cross-platform ${sub}/${entry.name} (${(sz / 1024 / 1024).toFixed(1)} MB)`);
      }
    }
  }

  console.log(`[afterPack] vendor cleanup saved ${(totalSaved / 1024 / 1024).toFixed(1)} MB`);
}

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir || "";
  const exeName = `${context.packager.appInfo.productFilename || "VGO CODE"}.exe`;
  const exePath = path.join(appOutDir, exeName);

  if (!appOutDir) {
    console.warn("[afterPack] appOutDir is empty, skip.");
    return;
  }

  const vendorDir = path.join(appOutDir, "resources", "app", "vendor", "package");
  cleanVendor(vendorDir);

  if (!fs.existsSync(exePath)) {
    console.warn(`[afterPack] executable not found: ${exePath}`);
    return;
  }

  const stat = fs.statSync(exePath);
  console.log(`[afterPack] verified executable: ${exePath} (${stat.size} bytes)`);

  const iconPath = path.join(context.packager.projectDir, "build", "icon.ico");
  if (!fs.existsSync(iconPath)) {
    console.warn(`[afterPack] icon not found, skip rcedit: ${iconPath}`);
    return;
  }

  try {
    const { rcedit } = await import("rcedit");
    await rcedit(exePath, {
      icon: iconPath,
      "version-string": {
        ProductName: "VGO CODE",
        FileDescription: "VGO CODE Desktop",
        OriginalFilename: path.basename(exePath),
        InternalName: "VGO CODE"
      }
    });
    console.log(`[afterPack] rcedit icon applied: ${iconPath}`);
  } catch (error) {
    console.warn(`[afterPack] rcedit failed: ${error?.message || error}`);
  }
};
