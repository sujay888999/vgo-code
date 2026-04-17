"use strict";

const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const HOST = "127.0.0.1";
const PORT = 3210;
const BASE_URL = `http://${HOST}:${PORT}`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: urlPath,
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk.toString();
        });
        res.on("end", () => {
          try {
            const json = raw ? JSON.parse(raw) : {};
            resolve({ status: res.statusCode || 0, json });
          } catch (error) {
            reject(new Error(`Invalid JSON from ${urlPath}: ${raw.slice(0, 300)}`));
          }
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForHealth(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const { status, json } = await requestJson("GET", "/health");
      if (status === 200 && json.status === "ok") return;
    } catch {}
    await delay(400);
  }
  throw new Error(`Health check timed out for ${BASE_URL}/health`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const serverEntry = path.join(process.cwd(), "server", "index.js");
  const child = spawn(process.execPath, [serverEntry], {
    cwd: process.cwd(),
    stdio: "pipe",
    windowsHide: true
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForHealth();

    const modelsResp = await requestJson("GET", "/models");
    assert(modelsResp.status === 200, "GET /models failed");
    const models = modelsResp.json.items || [];
    const byId = new Map(models.map((m) => [m.id, m]));

    assert(byId.has("vgo-coder-pro"), "Missing model: vgo-coder-pro");
    assert(byId.has("vgo-coder-fast"), "Missing model: vgo-coder-fast");
    assert(byId.get("vgo-coder-pro").label === "VGO AI Pro", "Model label mismatch: vgo-coder-pro");
    assert(byId.get("vgo-coder-fast").label === "VGO AI Fast", "Model label mismatch: vgo-coder-fast");

    const loginResp = await requestJson("POST", "/auth/login", {
      displayName: "VGO AI Developer",
      preferredModel: "vgo-coder-pro"
    });
    assert(loginResp.status === 200, "POST /auth/login failed");
    assert(Boolean(loginResp.json.accessToken), "Login missing accessToken");
    assert(loginResp.json.preferredModel === "vgo-coder-pro", "Login preferredModel mismatch");

    const chatResp = await requestJson("POST", "/chat", {
      model: "vgo-coder-fast",
      messages: [{ role: "user", content: "health check" }]
    });
    assert(chatResp.status === 200, "POST /chat failed");
    assert(chatResp.json.model === "vgo-coder-fast", "Chat model mismatch");
    assert(typeof chatResp.json.output === "string" && chatResp.json.output.length > 0, "Chat output missing");

    console.log("[release-smoke] PASS");
  } finally {
    if (!child.killed) child.kill("SIGTERM");
    await delay(300);
    if (!child.killed) child.kill("SIGKILL");
    if (stderr.trim()) {
      console.log(`[release-smoke] server stderr:\n${stderr.trim()}`);
    }
  }
}

run().catch((error) => {
  console.error(`[release-smoke] FAIL: ${error.message}`);
  process.exit(1);
});
