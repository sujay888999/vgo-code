const fs = require("node:fs");
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

function appendEngineLog(logFile, event, payload = {}) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    if (!fs.existsSync(logFile)) {
      fs.writeFileSync(logFile, UTF8_BOM, "utf8");
    }
    const record = normalizeStrings({
      ts: new Date().toISOString(),
      event,
      ...payload
    });
    fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`, "utf8");
  } catch {}
}

function normalizeEngineLogFile(logFile) {
  if (!fs.existsSync(logFile)) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, UTF8_BOM, "utf8");
    return { ok: true, changed: 0, total: 0, rewrote: true };
  }

  const raw = fs.readFileSync(logFile, "utf8");
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
    fs.writeFileSync(logFile, `${UTF8_BOM}${normalizedLines.join("\n")}\n`, "utf8");
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
