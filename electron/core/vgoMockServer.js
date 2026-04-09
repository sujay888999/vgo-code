const http = require("node:http");
const { URL } = require("node:url");
const { createMockDatabase } = require("../../server/lib/mockDatabase");
const { makeChatResponse } = require("../../server/lib/handlers");

let serverRef = null;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function fetchOllamaModels(baseUrl) {
  const normalized = String(baseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const response = await fetch(`${normalized}/api/tags`);
  if (!response.ok) {
    throw new Error(`ollama_http_${response.status}`);
  }
  const payload = await response.json();
  const models = Array.isArray(payload.models) ? payload.models : [];
  return models.map((item) => ({
    id: item.name,
    label: item.name,
    size: item.size || 0,
    modifiedAt: item.modified_at || "",
    digest: item.digest || ""
  }));
}

function startMockServer(options = {}) {
  return new Promise((resolve, reject) => {
    if (serverRef?.server?.listening) {
      resolve({
        server: serverRef.server,
        baseUrl: serverRef.baseUrl
      });
      return;
    }

    const db = createMockDatabase();
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");

      if (req.method === "GET" && req.url === "/health") {
        sendJson(res, 200, {
          status: "ok",
          provider: "VGO AI Local API"
        });
        return;
      }

      if (req.method === "GET" && req.url === "/models") {
        sendJson(res, 200, {
          items: db.models
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/desktop/config/state") {
        sendJson(res, 200, {
          ok: true,
          settings: typeof options.getSettings === "function" ? options.getSettings() : null,
          state: typeof options.serializeState === "function" ? options.serializeState() : null
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/desktop/config/profiles") {
        const settings = typeof options.getSettings === "function" ? options.getSettings() : null;
        sendJson(res, 200, {
          ok: true,
          activeRemoteProfileId: settings?.activeRemoteProfileId || "",
          profiles: Array.isArray(settings?.remoteProfiles) ? settings.remoteProfiles : []
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/desktop/config/profiles") {
        try {
          const body = await readJsonBody(req);
          if (typeof options.createRemoteProfile !== "function") {
            throw new Error("profile_api_unavailable");
          }
          const state = await options.createRemoteProfile(body, { activate: body.activate !== false });
          sendJson(res, 200, { ok: true, state });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message || "create_profile_failed" });
        }
        return;
      }

      if (req.method === "PUT" && url.pathname.startsWith("/desktop/config/profiles/")) {
        try {
          const profileId = decodeURIComponent(url.pathname.split("/").pop() || "");
          const body = await readJsonBody(req);
          if (typeof options.updateRemoteProfile !== "function") {
            throw new Error("profile_api_unavailable");
          }
          const state = await options.updateRemoteProfile(profileId, body, { activate: body.activate === true });
          sendJson(res, 200, { ok: true, state });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message || "update_profile_failed" });
        }
        return;
      }

      if (req.method === "DELETE" && url.pathname.startsWith("/desktop/config/profiles/")) {
        try {
          const profileId = decodeURIComponent(url.pathname.split("/").pop() || "");
          if (typeof options.deleteRemoteProfile !== "function") {
            throw new Error("profile_api_unavailable");
          }
          const state = await options.deleteRemoteProfile(profileId);
          sendJson(res, 200, { ok: true, state });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message || "delete_profile_failed" });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/desktop/config/select-profile") {
        try {
          const body = await readJsonBody(req);
          if (typeof options.selectRemoteProfile !== "function") {
            throw new Error("profile_api_unavailable");
          }
          const state = await options.selectRemoteProfile(body.id || body.profileId || "");
          sendJson(res, 200, { ok: true, state });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message || "select_profile_failed" });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/desktop/config/ollama/models") {
        try {
          const baseUrl = url.searchParams.get("baseUrl") || url.searchParams.get("url") || "http://127.0.0.1:11434";
          const items = await fetchOllamaModels(baseUrl);
          sendJson(res, 200, { ok: true, baseUrl, items });
        } catch (error) {
          sendJson(res, 502, { ok: false, error: error.message || "ollama_unavailable" });
        }
        return;
      }

      if (req.method === "POST" && req.url === "/auth/register") {
        try {
          const body = await readJsonBody(req);
          const user = db.ensureUser(body.displayName);
          sendJson(res, 200, {
            ok: true,
            displayName: user.displayName,
            accessToken: user.token
          });
        } catch (error) {
          sendJson(res, 400, { error: error.message || "invalid_json" });
        }
        return;
      }

      if (req.method === "POST" && req.url === "/auth/login") {
        try {
          const body = await readJsonBody(req);
          const user = db.ensureUser(body.displayName);
          sendJson(res, 200, {
            ok: true,
            displayName: user.displayName,
            accessToken: user.token,
            preferredModel: body.preferredModel || "vgo-coder-pro"
          });
        } catch (error) {
          sendJson(res, 400, { error: error.message || "invalid_json" });
        }
        return;
      }

      if (req.method === "POST" && req.url === "/chat") {
        try {
          const body = await readJsonBody(req);
          const modelMeta = db.models.find((item) => item.id === (body.model || "vgo-coder-pro"));
          const promptText = String(body.prompt || "");
          const historyText = Array.isArray(body.history)
            ? body.history.map((item) => item.text || "").join("\n")
            : "";
          const inputTokens = Math.ceil((promptText.length + historyText.length) / 4) + 120;
          const outputText = makeChatResponse(body, db);
          const outputTokens = Math.ceil(outputText.length / 4);
          sendJson(res, 200, {
            output: outputText,
            model: body.model || "vgo-coder-pro",
            provider: "VGO AI Local API",
            channel: "local-mock",
            contextWindow: modelMeta?.contextWindow || 32000,
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: inputTokens + outputTokens
            }
          });
        } catch (error) {
          sendJson(res, 400, { error: error.message || "invalid_json" });
        }
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    });

    server.on("error", reject);
    server.listen(3210, "127.0.0.1", () => {
      serverRef = {
        server,
        baseUrl: "http://127.0.0.1:3210"
      };
      resolve({
        server,
        baseUrl: serverRef.baseUrl
      });
    });
  });
}

module.exports = {
  startMockServer
};
