const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { tryRecoverMojibake } = require("./agentProtocol");
const UTF8_BOM = "\uFEFF";

function normalizeStrings(value) {
  if (typeof value === "string") {
    return tryRecoverMojibake(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeStrings(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeStrings(item)])
    );
  }
  return value;
}

async function appendEngineLog(logFile, event, payload = {}) {
  try {
    await fsp.mkdir(path.dirname(logFile), { recursive: true });
    try { await fsp.access(logFile, fs.constants.F_OK); } catch {
      await fsp.writeFile(logFile, UTF8_BOM, "utf8");
    }
    const record = normalizeStrings({
      ts: new Date().toISOString(),
      event,
      ...payload
    });
    await fsp.appendFile(logFile, `${JSON.stringify(record)}\n`, "utf8");
  } catch {}
}

async function normalizeEngineLogFile(logFile) {
  let exists = false;
  try { await fsp.access(logFile, fs.constants.F_OK); exists = true; } catch {}

  if (!exists) {
    await fsp.mkdir(path.dirname(logFile), { recursive: true });
    await fsp.writeFile(logFile, UTF8_BOM, "utf8");
    return { ok: true, changed: 0, total: 0, rewrote: true };
  }

  const raw = await fsp.readFile(logFile, "utf8");
  const hadBom = raw.startsWith(UTF8_BOM);
  const sanitizedRaw = hadBom ? raw.slice(1) : raw;
  const lines = sanitizedRaw.split(/\r?\n/).filter(Boolean);
  let changed = 0;

  const normalizedLines = lines.map((line) => {
    try {
      const parsed = JSON.parse(line);
      const normalized = normalizeStrings(parsed);
      const nextLine = JSON.stringify(normalized);
      if (nextLine !== line) {
        changed += 1;
      }
      return nextLine;
    } catch {
      const recovered = tryRecoverMojibake(line);
      if (recovered !== line) {
        changed += 1;
      }
      return recovered;
    }
  });

  if (changed > 0 || !hadBom) {
    await fsp.writeFile(logFile, `${UTF8_BOM}${normalizedLines.join("\n")}\n`, "utf8");
  }

  return {
    ok: true,
    changed,
    total: lines.length,
    rewrote: changed > 0 || !hadBom
  };
}

module.exports = {
  appendEngineLog,
  normalizeEngineLogFile
};
