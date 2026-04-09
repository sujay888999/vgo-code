const http = require("node:http");
const { createMockDatabase } = require("./lib/mockDatabase");
const { makeChatResponse } = require("./lib/handlers");

const PORT = Number(process.env.VGO_AI_PORT || 3210);
const HOST = process.env.VGO_AI_HOST || "127.0.0.1";

const db = createMockDatabase();

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

const server = http.createServer(async (req, res) => {
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
      sendJson(res, 200, {
        output: makeChatResponse(body, db),
        model: body.model || "vgo-coder-pro",
        provider: "VGO AI Local API"
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "invalid_json" });
    }
    return;
  }

  sendJson(res, 404, { error: "not_found" });
});

server.listen(PORT, HOST, () => {
  console.log(`VGO AI Local API running at http://${HOST}:${PORT}`);
});
