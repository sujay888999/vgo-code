#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SETTINGS_PATH = path.join(
  process.env.APPDATA || "",
  "vgo-code",
  "vgo-settings.json"
);
const MODELS_ENDPOINT = "https://vgoai.cn/api/v1/chat/models";
const CHANNELS_ENDPOINT = "https://vgoai.cn/api/v1/channels";
const CHAT_ENDPOINT = "https://vgoai.cn/api/v1/chat/send";
const REQUEST_TIMEOUT_MS = 45000;

function parseJsonResponse(text = "") {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { rawText: text };
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const payload = parseJsonResponse(text);
  return { response, payload, text };
}

function toModelItem(item) {
  const id = String(item?.id || "").trim();
  if (!id) return null;
  return {
    id,
    label: String(item?.name || item?.label || id).trim() || id,
    description: String(item?.description || "").trim(),
    contextWindow: Number(
      item?.contextWindow ||
        item?.contextTokens ||
        item?.maxContextTokens ||
        item?.max_input_tokens ||
        item?.maxTokens ||
        0
    )
  };
}

function makeTimeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function probeModel(accessToken, modelId) {
  const body = JSON.stringify({
    model: modelId,
    messages: [{ role: "user", content: "reply with OK only" }]
  });
  const { signal, clear } = makeTimeoutSignal(REQUEST_TIMEOUT_MS);
  try {
    const { response, payload } = await requestJson(CHAT_ENDPOINT, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body
    });
    const detail = String(
      payload?.message ||
        payload?.error ||
        payload?.rawText ||
        payload?.data?.message?.content ||
        ""
    );
    return {
      model: modelId,
      ok: response.ok,
      status: Number(response.status || 0),
      detail: detail.slice(0, 120)
    };
  } catch (error) {
    return {
      model: modelId,
      ok: false,
      status: 0,
      detail: String(error?.message || error || "").slice(0, 120)
    };
  } finally {
    clear();
  }
}

function classifyProbeResult(result = {}) {
  if (result.ok) {
    return "ok";
  }
  const detail = String(result.detail || "");
  if (/No available channel for this model/i.test(detail)) {
    return "permanent_unavailable";
  }
  return "transient_failure";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeModelWithRetry(accessToken, modelId, maxAttempts = 3) {
  const attempts = [];
  for (let index = 0; index < maxAttempts; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const result = await probeModel(accessToken, modelId);
    const category = classifyProbeResult(result);
    attempts.push({ ...result, category });

    if (category === "ok" || category === "permanent_unavailable") {
      return { final: { ...result, category }, attempts };
    }

    // eslint-disable-next-line no-await-in-loop
    await wait(500 + index * 250);
  }

  const last = attempts[attempts.length - 1] || {
    model: modelId,
    ok: false,
    status: 0,
    detail: "unknown_probe_failure",
    category: "transient_failure"
  };
  return { final: last, attempts };
}

function dedupeModels(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const model = toModelItem(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    result.push(model);
  }
  return result;
}

async function main() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    throw new Error(`settings_not_found: ${SETTINGS_PATH}`);
  }

  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  const accessToken = String(settings?.vgoAI?.accessToken || "").trim();
  if (!accessToken) {
    throw new Error("missing_access_token");
  }

  const modelResp = await requestJson(MODELS_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const officialModels = Array.isArray(modelResp.payload?.data)
    ? modelResp.payload.data
    : Array.isArray(modelResp.payload?.items)
      ? modelResp.payload.items
      : Array.isArray(modelResp.payload?.models)
        ? modelResp.payload.models
        : [];

  const channelResp = await requestJson(CHANNELS_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const channels = Array.isArray(channelResp.payload)
    ? channelResp.payload
    : Array.isArray(channelResp.payload?.data)
      ? channelResp.payload.data
      : [];

  const nvidiaChannel = channels.find((ch) =>
    String(ch?.name || "").toLowerCase().includes("nvidia")
  );
  const nvidiaModels = Array.isArray(nvidiaChannel?.models)
    ? nvidiaChannel.models.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  const probeResults = [];
  for (const modelId of nvidiaModels) {
    // eslint-disable-next-line no-await-in-loop
    const probe = await probeModelWithRetry(accessToken, modelId);
    probeResults.push(probe);
  }

  const usableFromNvidia = new Set(
    probeResults
      .filter((item) => item?.final?.category === "ok")
      .map((item) => item.final.model)
  );
  const permanentlyUnavailableFromNvidia = new Set(
    probeResults
      .filter((item) => item?.final?.category === "permanent_unavailable")
      .map((item) => item.final.model)
  );
  const transientFailuresFromNvidia = new Set(
    probeResults
      .filter((item) => item?.final?.category === "transient_failure")
      .map((item) => item.final.model)
  );

  const mergedCatalog = dedupeModels([
    ...officialModels,
    ...nvidiaModels
      .filter((id) => usableFromNvidia.has(id))
      .map((id) => ({ id, name: id }))
  ]).filter((item) => {
    if (/^nvidia\//i.test(item.id)) {
      return usableFromNvidia.has(item.id);
    }
    if (permanentlyUnavailableFromNvidia.has(item.id)) {
      return false;
    }
    return true;
  });

  const preferredModel = String(settings?.vgoAI?.preferredModel || "").trim();
  const preferredStillExists = mergedCatalog.some((item) => item.id === preferredModel);
  const fallbackPreferred = preferredStillExists
    ? preferredModel
    : mergedCatalog[0]?.id || preferredModel;

  settings.vgoAI = {
    ...(settings.vgoAI || {}),
    preferredModel: fallbackPreferred,
    modelCatalog: mergedCatalog
  };

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");

  const summary = {
    officialModelCount: officialModels.length,
    nvidiaChannelModelCount: nvidiaModels.length,
    nvidiaUsableCount: [...usableFromNvidia].length,
    nvidiaPermanentUnavailableCount: [...permanentlyUnavailableFromNvidia].length,
    nvidiaTransientFailureCount: [...transientFailuresFromNvidia].length,
    mergedCatalogCount: mergedCatalog.length,
    nvidiaUsableModels: [...usableFromNvidia],
    nvidiaPermanentUnavailableModels: [...permanentlyUnavailableFromNvidia],
    nvidiaTransientFailureModels: [...transientFailuresFromNvidia],
    probes: probeResults.map((item) => ({
      model: item.final.model,
      finalCategory: item.final.category,
      finalStatus: item.final.status,
      attempts: item.attempts.map((attempt) => ({
        status: attempt.status,
        category: attempt.category,
        detail: attempt.detail
      }))
    }))
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`sync_failed: ${String(error?.message || error)}\n`);
  process.exitCode = 1;
});
