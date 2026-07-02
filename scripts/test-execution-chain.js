#!/usr/bin/env node
// Comprehensive end-to-end test for vgoRemoteAdapter's fallback chain.
// Mocks global.fetch with scripted responses so we can verify:
//
// 1) HTTP 400 with embedded "HTTP 404" message → triggers retry + cross-family fallback
// 2) HTTP 200 with provider_refusal → marks unhealthy + switches to next candidate
// 3) Fallback candidate that yields a *valid* response → hydrates cleanText and succeeds
// 4) All catalog candidates unhealthy → returns clear failure
// 5) Cross-family takes priority when same-family is exhausted
//
// Run with: node scripts/test-execution-chain.js

const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");

// -------------------------------------------------------------------------
// 1. Capture symbol handles by injecting a global fetch mock, then load the
//    adapter in a child environment where fetch is intercepted per call.

// We can't easily get to internal helpers without exporting them, so we
// install a global.fetch stub and use the adapter's exported `runPrompt`
// (which is what the renderer actually calls). The adapter's
// `shouldUseRealVgoChannel` must be free of `loggedIn` checks.
// Provide a fake `process.cwd` (so LOG_DIR exists) and stub things the
// adapter requires.
// -------------------------------------------------------------------------

process.chdir(path.resolve(__dirname, ".."));

// Provide a writable directory before requiring engineLog (which writes at
// module load to fs.mkdirSync(path.join(process.cwd(), "logs"))).
const logsDir = path.resolve("logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// Load the adapter.
const vram = require(path.resolve("electron/core/vgoRemoteAdapter.js"));

let passed = 0;
let failed = 0;
function assert(name, cond, info) {
  if (cond) { passed += 1; console.log(`✔ ${name}`); }
  else { failed += 1; console.log(`✘ ${name}${info ? " — " + info : ""}`); }
}

// Track every fetch call so we can assert chain order.
const fetchCalls = [];

// Helper to install a programmatic fetch responder.
// Each entry is { forModel, status, body } — match by JSON body's model field.
function installFetch(scenarios) {
  // scenarios: array of { forModel?: string|null, status: number, body: object | string, delayMs?: number }
  // if forModel is null/undefined → match any model (used as a default)
  fetchCalls.length = 0;
  global.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const forModel = body.model;
    fetchCalls.push({ url: typeof url === "string" ? url : url.url, model: forModel, t: Date.now() });
    // Pick first scenario matching forModel; else pick first null.
    const scenario =
      scenarios.find((s) => s.forModel === forModel) ||
      scenarios.find((s) => !s.forModel) ||
      scenarios[scenarios.length - 1];
    if (scenario.delayMs) await new Promise((r) => setTimeout(r, scenario.delayMs));
    const body2 = typeof scenario.body === "string" ? scenario.body : JSON.stringify(scenario.body);
    return {
      ok: scenario.status >= 200 && scenario.status < 300,
      status: scenario.status,
      text: async () => body2,
      json: async () => typeof scenario.body === "string" ? {} : scenario.body,
    };
  };
}

function makeSettings(catalog) {
  return {
    vgoAI: {
      loggedIn: true,
      accessToken: "fake-token-test",
      preferredModel: "minimax/m3", // current preferred
      modelCatalog: catalog.map(id => ({ id, label: id })),
    },
    remote: { model: "minimax/m3" },
    agent: { maxToolSteps: 200, promptIdleWatchdogMs: 300000, maxRemoteRequestTimeoutMs: 5000 }
  };
}

async function scenario(name, fn) {
  console.log(`\n--- ${name} ---`);
  try { await fn(); }
  catch (e) { failed += 1; console.log(`✘ ${name} threw:`, e.message); }
}

function traceEvents(label) {
  return (event) => {
    console.log(`    [event:${label}]`, event.type, event.message || (event.text?event.text.slice(0,60):''), '|', 'model=', event.model || '-');
  };
}

(async () => {
  await scenario("S1: HTTP 400 with \"HTTP 404\" message → chain recovers with healthy candidate", async () => {
    installFetch([
      // First model (m3) returns 400 with body containing "HTTP 404"
      { forModel: "minimax/m3", status: 400, body: { message: "当前模型服务 返回异常（HTTP 404），请稍后重试或切换模型" } },
      // Retry of m3 same body (still 400)
      { forModel: "minimax/m3", status: 400, body: { message: "当前模型服务 返回异常（HTTP 404），请稍后重试或切换模型" } },
      // Fallback candidate m2.7 same error
      { forModel: "minimax/m2.7", status: 400, body: { message: "当前模型服务 返回异常（HTTP 404），请稍后重试或切换模型" } },
      // glmini-5 healthy real response
      { forModel: "glm/gl5", status: 200, body: { data: { message: { content: "Here is my analysis." } }, message: "Here is my analysis." } },
    ]);
    const settings = makeSettings([
      "minimax/m3", "minimax/m2.7", "glm/gl5", "deepseek/v4",
    ]);
    const result = await vram.runPrompt({
      workspace: process.cwd(),
      sessionId: "test-session-s1",
      prompt: "分析项目",
      history: [{role:"user", content:"分析项目"}],
      settings,
      onEvent: traceEvents("S1"),
      signal: new AbortController().signal,
    });
    console.log('    [S1 chain]', fetchCalls.map(c => `${c.model}@${c.t % 100000}`).join(' → '));
    assert("S1 ok=true", result.ok === true, JSON.stringify(result));
    assert("S1 text=healthy response", /Here is my analysis/.test(result.text || ""), result.text);
    assert("S1 chain reached glm", fetchCalls.some(c => c.model === "glm/gl5"));
  });

  await scenario("S2: provider_refusal (HTTP 200 with empty/placeholder) → mark + fallback to healthy model returns success", async () => {
    installFetch([
      { forModel: "minimax/m3", status: 200, body: { message: { content: "No response was returned from the model." } } },
      { forModel: "minimax/m3", status: 200, body: { message: { content: "No response was returned from the model." } } },
      { forModel: "minimax/m2.7", status: 200, body: { message: { content: "No response was returned from the model." } } },
      { forModel: "glm/gl5", status: 200, body: { message: { content: "Healthy fallback reply." } } },
    ]);
    const settings = makeSettings(["minimax/m3", "minimax/m2.7", "glm/gl5"]);
    const result = await vram.runPrompt({
      workspace: process.cwd(),
      sessionId: "test-session-s2",
      prompt: "分析",
      history: [{role:"user", content:"分析"}],
      settings,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    assert("S2 ok=true", result.ok === true, JSON.stringify(result));
    assert("S2 final text is healthy candidate", result.text === "Healthy fallback reply." || /Healthy fallback/.test(result.text || ""), result.text);
  });

  await scenario("S3: single model in catalog returns refusal → task fails cleanly", async () => {
    installFetch([
      { forModel: "minimax/m3", status: 200, body: { message: { content: "No response was returned from the model." } } },
      { forModel: "minimax/m3", status: 200, body: { message: { content: "No response was returned from the model." } } },
      { forModel: "minimax/m3", status: 200, body: { message: { content: "No response was returned from the model." } } },
    ]);
    const settings = makeSettings(["minimax/m3"]);
    const result = await vram.runPrompt({
      workspace: process.cwd(),
      sessionId: "test-session-s3",
      prompt: "ask",
      history: [{role:"user", content:"ask"}],
      settings,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    assert("S3 ok=false", result.ok === false, JSON.stringify(result));
    assert("S3 error mentions refusal", /refusal/i.test(result.error || ""));
  });

  await scenario("S4: upstream 502 transient → retry recovers on same model", async () => {
    installFetch([
      { forModel: "minimax/m3", status: 502, body: { message: "Upstream busy" } },
      { forModel: "minimax/m3", status: 200, body: { message: { content: "Got it." } } },
    ]);
    const settings = makeSettings(["minimax/m3", "glm/gl5"]);
    const result = await vram.runPrompt({
      workspace: process.cwd(),
      sessionId: "test-session-s4",
      prompt: "ask",
      history: [{role:"user", content:"ask"}],
      settings,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    assert("S4 ok=true after retry", result.ok === true, JSON.stringify(result));
    assert("S4 text=Got it.", /Got it\./.test(result.text || ""), result.text);
  });

  await scenario("S5: HTTP 429 rate-limit → respects MAX_UPSTREAM_RATE_LIMIT_RETRIES, then fallback", async () => {
    installFetch([
      { forModel: "minimax/m3", status: 429, body: { message: "Too Many Requests" } },
      { forModel: "minimax/m3", status: 429, body: { message: "Too Many Requests" } },
      { forModel: "minimax/m3", status: 200, body: { message: { content: "Recovered after RL." } } },
    ]);
    const settings = makeSettings(["minimax/m3", "glm/gl5"]);
    const result = await vram.runPrompt({
      workspace: process.cwd(),
      sessionId: "test-session-s5",
      prompt: "ask",
      history: [{role:"user", content:"ask"}],
      settings,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    assert("S5 ok=true", result.ok === true, JSON.stringify(result));
  });

  await scenario("S6: cross-family chain — only non-minimax survives", async () => {
    installFetch([
      { forModel: "minimax/m3", status: 200, body: { message: { content: "No response was returned from the model." } } },
      { forModel: "minimax/m2.7", status: 200, body: { message: { content: "No response was returned from the model." } } },
      { forModel: "deepseek/v4", status: 200, body: { message: { content: "DeepSeek: yes." } } },
    ]);
    const settings = makeSettings(["minimax/m3", "minimax/m2.7", "deepseek/v4"]);
    const result = await vram.runPrompt({
      workspace: process.cwd(),
      sessionId: "test-session-s6",
      prompt: "ask",
      history: [{role:"user", content:"ask"}],
      settings,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    assert("S6 ok=true", result.ok === true, JSON.stringify(result));
    assert("S6 used deepseek", fetchCalls.some(c => c.model === "deepseek/v4"));
    assert("S6 text from deepseek", /DeepSeek/.test(result.text || ""), result.text);
  });

  console.log(`\n────────────────────────────────────────`);
  console.log(`  Passed: ${passed}    Failed: ${failed}`);
  console.log(`────────────────────────────────────────`);
  process.exit(failed === 0 ? 0 : 1);
})();
