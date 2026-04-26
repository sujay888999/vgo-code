const fs = require("node:fs");
const path = require("node:path");
const { executeToolCall } = require("./toolRuntime");
const protocol = require("./agentProtocol");
const modelAdapters = require("./modelAdapterRegistry");
const skillRegistry = require("./skillRegistry");
const {
  executeToolCallWithResilience
} = require("./toolResilience");
const { appendEngineLog } = require("./engineLog");
const {
  detectWorkflow,
  probeAudioVideoWorkflow,
  buildWorkflowSystemAppendix,
  buildCapabilityGapSummary
} = require("./taskWorkflowRegistry");
const {
  discoverRelevantSkills,
  discoverInstallableSkills,
  installSkillFromSource,
  buildSkillAppendix
} = require("./localSkillDiscovery");

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "ollama-engine.log");

const DEFAULT_MAX_TOOL_STEPS = 120;
const MIN_TOOL_STEPS = 20;
const MAX_TOOL_STEPS = 300;
const DEFAULT_NUM_PREDICT = 16384;
const OLLAMA_MAX_HISTORY_MESSAGES = 24;
const OLLAMA_MAX_MESSAGE_CHARS = 5000;
const OLLAMA_MAX_TOTAL_CHARS = 60000;
const MAX_OLLAMA_RATE_LIMIT_RETRIES = 2;

function isRateLimitErrorText(text = "") {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  return (
    /http\s*429/i.test(raw) ||
    lower.includes("429") ||
    lower.includes("too many requests") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("\u9650\u6d41") ||
    lower.includes("\u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41")
  );
}

function getMaxToolSteps(settings) {
  const configured =
    Number(settings?.agent?.maxToolSteps) || Number(settings?.remote?.maxToolSteps) || DEFAULT_MAX_TOOL_STEPS;
  return Math.max(MIN_TOOL_STEPS, Math.min(MAX_TOOL_STEPS, Math.floor(configured)));
}

function getNumPredict(settings) {
  return Number(settings?.remote?.numPredict) || DEFAULT_NUM_PREDICT;
}

function logRuntime(event, payload = {}) {
  appendEngineLog(LOG_FILE, event, payload);
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { rawText: text };
  }
}

async function parseOllamaStreamResponse(response, onChunk, options = {}) {
  const reader = response.body?.getReader();
  if (!reader) {
    return await parseJsonResponse(response);
  }

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let aggregatedContent = "";
  let aggregatedToolCalls = [];
  let finalEnvelope = null;
  const startTime = Date.now();
  const STREAM_TIMEOUT_MS = options.timeout || 300000;

  while (true) {
    if (Date.now() - startTime > STREAM_TIMEOUT_MS) {
      logRuntime("stream:timeout", { duration: STREAM_TIMEOUT_MS });
      reader.cancel();
      break;
    }

    let readPromise;
    try {
      readPromise = reader.read();
    } catch (err) {
      logRuntime("stream:read_error", { error: err.message });
      break;
    }

    const { value, done } = await Promise.race([
      readPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Stream read timeout")), STREAM_TIMEOUT_MS))
    ]).catch(err => ({ done: true, value: undefined }));

    if (done || !value) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (err) {
        logRuntime("stream:parse_error", { error: err.message, preview: trimmed.slice(0, 100) });
        continue;
      }

      finalEnvelope = parsed;
      const deltaText = String(parsed?.message?.content || "");
      if (deltaText) {
        aggregatedContent += deltaText;
      }

      if (Array.isArray(parsed?.message?.tool_calls) && parsed.message.tool_calls.length) {
        aggregatedToolCalls = aggregatedToolCalls.concat(parsed.message.tool_calls);
      }

      if (typeof onChunk === "function") {
        onChunk({
          done: Boolean(parsed?.done),
          content: aggregatedContent,
          delta: deltaText,
          message: parsed?.message || {}
        });
      }
    }
  }

  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer.trim());
      finalEnvelope = parsed;
      const deltaText = String(parsed?.message?.content || "");
      if (deltaText) {
        aggregatedContent += deltaText;
      }
      if (Array.isArray(parsed?.message?.tool_calls) && parsed.message.tool_calls.length) {
        aggregatedToolCalls = parsed.message.tool_calls;
      }
      if (typeof onChunk === "function") {
        onChunk({
          done: Boolean(parsed?.done),
          content: aggregatedContent,
          delta: deltaText,
          message: parsed?.message || {}
        });
      }
    } catch (err) {
      logRuntime("stream:line_parse_error", { error: err?.message, preview: trimmed?.slice(0, 100) });
    }
  }

  return {
    ...finalEnvelope,
    message: {
      ...(finalEnvelope?.message || {}),
      content: aggregatedContent,
      tool_calls: aggregatedToolCalls
    }
  };
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function safeParseJson(value) {
  if (typeof value !== "string") {
    return value && typeof value === "object" ? value : null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeToolCalls(calls = []) {
  const normalizeKnownArgumentAliases = (name, args = {}) => {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return {};
    }
    const normalized = { ...args };
    const assignFirstString = (targetKey, candidateKeys = []) => {
      const current = normalized[targetKey];
      if (typeof current === "string" && current.trim()) {
        return;
      }
      for (const key of candidateKeys) {
        if (typeof normalized[key] === "string" && normalized[key].trim()) {
          normalized[targetKey] = normalized[key];
          return;
        }
      }
    };

    if (["write_file", "append_file"].includes(name)) {
      assignFirstString("path", ["filePath", "filepath", "file", "filename", "target", "output", "destination"]);
      assignFirstString("content", ["contents", "conten", "text", "body", "value", "data", "code"]);
    }
    if (["read_file", "list_dir", "open_path", "search_code", "make_dir", "delete_file", "delete_dir"].includes(name)) {
      assignFirstString("path", ["filePath", "filepath", "file", "filename", "target", "input", "dir", "directory"]);
    }
    if (name === "run_command") {
      assignFirstString("command", ["cmdline", "cmdLine", "shell", "script", "text", "body", "value", "content"]);
      if (
        (normalized.command === undefined || String(normalized.command || "").trim() === "") &&
        typeof normalized.cmd === "string"
      ) {
        normalized.command = normalized.cmd;
      }
      if (
        (normalized.command === undefined || String(normalized.command || "").trim() === "") &&
        typeof normalized.shell_command === "string"
      ) {
        normalized.command = normalized.shell_command;
      }
      if (
        (normalized.command === undefined || String(normalized.command || "").trim() === "") &&
        typeof normalized.arguments === "string"
      ) {
        normalized.command = normalized.arguments;
      }
      if (
        (normalized.timeoutMs === undefined || normalized.timeoutMs === null) &&
        normalized.timeout_ms !== undefined
      ) {
        normalized.timeoutMs = normalized.timeout_ms;
      }
    }
    return normalized;
  };
  const coerceToolArguments = (name, rawArguments) => {
    const normalizedName = String(name || "").toLowerCase();
    if (rawArguments && typeof rawArguments === "object") {
      return normalizeKnownArgumentAliases(normalizedName, rawArguments);
    }

    if (typeof rawArguments === "string") {
      const trimmed = rawArguments.trim();
      const parsed = safeParseJson(trimmed);
      if (parsed && typeof parsed === "object") {
        return normalizeKnownArgumentAliases(normalizedName, parsed);
      }

      if (trimmed && normalizedName === "run_command") {
        return { command: trimmed };
      }

      if (trimmed) {
        if (["read_file", "list_dir", "open_path", "search_code"].includes(normalizedName)) {
          return { path: trimmed };
        }
      }
    }

    return {};
  };

  return calls
    .filter((call) => call && typeof call === "object" && call.name)
    .map((call) => ({
      name: String(call.name),
      arguments: (() => {
        const normalized = coerceToolArguments(call.name, call.arguments ?? call.args);
        if (normalized && Object.keys(normalized).length) {
          return normalized;
        }
        const fallback = {};
        for (const key of [
          "path",
          "content",
          "command",
          "cwd",
          "query",
          "url",
          "format",
          "source",
          "destination",
          "newName",
          "title",
          "maxLines",
          "maxEntries",
          "maxResults",
          "maxChars",
          "timeoutMs",
          "timeout_ms"
        ]) {
          if (call[key] !== undefined) {
            fallback[key] = call[key];
          }
        }
        return normalizeKnownArgumentAliases(String(call?.name || "").toLowerCase(), fallback);
      })()
    }));
}

function getMissingRequiredToolArgument(call = {}) {
  const name = String(call?.name || "").trim().toLowerCase();
  const args =
    call?.arguments && typeof call.arguments === "object"
      ? call.arguments
      : call?.args && typeof call.args === "object"
        ? call.args
        : {};
  if (name === "run_command") {
    const action = String(args.processAction || args.action || "").trim().toLowerCase();
    if (action === "list") {
      return "";
    }
    if (action === "status" || action === "stop") {
      const pid = Number(args.pid);
      return Number.isInteger(pid) && pid > 0 ? "" : "pid";
    }
  }
  const requiredByTool = {
    read_file: ["path"],
    write_file: ["path", "content"],
    append_file: ["path", "content"],
    run_command: ["command"],
    copy_file: ["source", "destination"],
    move_file: ["source", "destination"],
    rename_file: ["path", "newName"],
    make_dir: ["path"],
    delete_file: ["path"],
    delete_dir: ["path"],
    open_path: ["path"],
    fetch_web: ["url"],
    generate_word_doc: ["path"]
  };
  const required = requiredByTool[name] || [];
  if (!required.length) {
    return "";
  }
  for (const key of required) {
    if (args[key] === undefined || args[key] === null || String(args[key]).trim() === "") {
      return key;
    }
  }
  return "";
}

function extractWriteFileFallbackFromCommand(command = "") {
  const source = String(command || "");
  if (!source) {
    return null;
  }

  const catWriteMatch =
    source.match(/cat\s*>\s*(['"]?)([^'"\r\n]+)\1\s*<<\s*['"]?EOF['"]?\s*\r?\n([\s\S]*?)\r?\nEOF/i) ||
    source.match(/cat\s*<<\s*['"]?EOF['"]?\s*>\s*(['"]?)([^'"\r\n]+)\1\s*\r?\n([\s\S]*?)\r?\nEOF/i);
  if (catWriteMatch) {
    const filePath = String(catWriteMatch[2] || "").trim();
    const content = String(catWriteMatch[3] || "");
    if (filePath && content) {
      return {
        name: "write_file",
        arguments: {
          path: filePath,
          content
        }
      };
    }
  }

  return null;
}

function buildToolFallbackCall(call = {}, result = {}) {
  const name = String(call?.name || "").trim().toLowerCase();
  const args =
    call?.arguments && typeof call.arguments === "object"
      ? call.arguments
      : call?.args && typeof call.args === "object"
        ? call.args
        : {};
  const summary = String(result?.summary || "");

  if (name === "run_command" && /Command exited with code/i.test(summary)) {
    const fallback = extractWriteFileFallbackFromCommand(String(args.command || ""));
    if (fallback) {
      return fallback;
    }
  }

  return null;
}

function extractTaggedToolCallPayloads(text) {
  if (typeof text !== "string" || !text.includes("<vgo_tool_call>")) {
    return [];
  }

  const payloads = [];
  const taggedPattern = /<vgo_tool_call>\s*([\s\S]*?)\s*<\/vgo_tool_call>/gi;
  let match = taggedPattern.exec(text);

  while (match) {
    const payload = String(match[1] || "").trim();
    if (payload) {
      payloads.push(payload);
    }
    match = taggedPattern.exec(text);
  }

  return payloads;
}

function extractJsonFromText(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  
  let braceCount = 0;
  let inString = false;
  let escaped = false;
  
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    
    if (escaped) {
      escaped = false;
      continue;
    }
    
    if (char === "\\") {
      escaped = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (char === "{") {
      braceCount++;
    } else if (char === "}") {
      braceCount--;
      if (braceCount === 0) {
        const jsonStr = trimmed.slice(0, i + 1);
        return safeParseJson(jsonStr);
      }
    }
  }
  
  return null;
}

function recoverSingleToolCallPayload(text = "") {
  if (typeof text !== "string") {
    return [];
  }

  const taggedMatch = text.match(/<vgo_tool_call>([\s\S]*?)<\/vgo_tool_call>/i);
  if (taggedMatch?.[1]) {
    const payload = taggedMatch[1].trim();
    const parsed = extractJsonFromText(payload);
    if (parsed) {
      const parsedCalls = normalizeToolCalls(
        parsed.name ? [parsed] : Array.isArray(parsed.calls) ? parsed.calls : []
      );
      if (parsedCalls.length) {
        return parsedCalls;
      }
    }
  }

  const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
  if (nameMatch) {
    const toolName = nameMatch[1];
    const nameEndIdx = text.indexOf(nameMatch[0]) + nameMatch[0].length;
    const afterName = text.slice(nameEndIdx);
    
    const argsMatch = afterName.match(/"arguments"\s*:\s*(\{)/);
    if (argsMatch) {
      const argsStartIdx = afterName.indexOf(argsMatch[0]) + argsMatch[0].length - 1;
      const afterArgs = afterName.slice(argsStartIdx);
      const parsed = extractJsonFromText(afterArgs);
      if (parsed && typeof parsed === "object") {
        return normalizeToolCalls([{ name: toolName, arguments: parsed }]);
      }
    }
    
    const pathMatch = afterName.match(/"path"\s*:\s*"([^"]+)"/);
    if (pathMatch) {
      return normalizeToolCalls([{ name: toolName, arguments: { path: pathMatch[1] } }]);
    }
    
    const contentMatch = afterName.match(/"content"\s*:\s*"([^"]*)"/);
    if (contentMatch) {
      return normalizeToolCalls([{ name: toolName, arguments: { content: contentMatch[1] } }]);
    }
  }

  const loosePathCallMatch = text.match(
    /"name"\s*:\s*"([^"]+)"[\s\S]*?"path"\s*:\s*"([^"]+)"/i
  );
  if (loosePathCallMatch?.[1] && loosePathCallMatch?.[2]) {
    return normalizeToolCalls([
      {
        name: loosePathCallMatch[1],
        arguments: { path: loosePathCallMatch[2] }
      }
    ]);
  }

  const looseStringArgumentMatch = text.match(
    /"name"\s*:\s*"([^"]+)"[\s\S]*?"arguments"\s*:\s*"([^"]+)"/i
  );
  if (looseStringArgumentMatch?.[1] && looseStringArgumentMatch?.[2]) {
    return normalizeToolCalls([
      {
        name: looseStringArgumentMatch[1],
        arguments: looseStringArgumentMatch[2]
      }
    ]);
  }

  return [];
}

function buildSafeSystemPrompt(settings, sessionMeta = {}, activeSkills = []) {
  const appendix = skillRegistry.buildSkillSystemAppendix(activeSkills);
  try {
    return [modelAdapters.buildDesktopSystemPrompt(settings, sessionMeta), appendix]
      .filter(Boolean)
      .join("\n\n");
  } catch (error) {
    logRuntime("system_prompt:build_fallback", { error: error.message });
    return "You are a local coding assistant. Use tools when needed.";
  }
}

function buildSkillPreflightNudge(skills = []) {
  const required = [];
  for (const skill of skills) {
    for (const file of skill.requiredInspectionPaths || []) {
      if (!required.includes(file)) {
        required.push(file);
      }
    }
  }
  if (!required.length) return "";
  return [
    "Before giving conclusions, inspect these project files first if they exist:",
    ...required.map((file, index) => `${index + 1}. ${file}`),
    ""
  ].join("\n");
}

function resolveSkillRequiredInspectionPaths(skills = [], workspace = "") {
  const normalizedWorkspace = String(workspace || "").trim();
  if (!normalizedWorkspace) {
    return skills;
  }

  return skills.map((skill) => {
    const requiredInspectionPaths = (skill.requiredInspectionPaths || []).filter((relativePath) => {
      try {
        const absolutePath = path.resolve(normalizedWorkspace, relativePath);
        return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
      } catch (_error) {
        return false;
      }
    });

    return {
      ...skill,
      requiredInspectionPaths
    };
  });
}

async function sendOllamaRequest({ baseUrl, model, messages, signal, onChunk, timeout = 300000, numPredict = 16384 }) {
  logRuntime("request:start", { model, baseUrl });
  
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      num_predict: numPredict,
      tools: [
        {
          type: "function",
          function: {
            name: "list_dir",
            description: "List files and directories in a path",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Directory path to list" },
                maxEntries: { type: "number", description: "Maximum entries to return", default: 50 }
              },
              required: ["path"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read content of a file",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "File path to read" },
                maxLines: { type: "number", description: "Maximum lines to read", default: 200 }
              },
              required: ["path"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "write_file",
            description: "Write content to a file (overwrites existing file). IMPORTANT: Keep content concise and complete. For content >500 chars, use write_file first then append_file.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "File path to write" },
                content: { type: "string", description: "Content to write" }
              },
              required: ["path", "content"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "append_file",
            description: "Append content to an existing file. Use write_file first, then use this to add more.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "File path to append to" },
                content: { type: "string", description: "Content to append" }
              },
              required: ["path", "content"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "run_command",
            description: "Run a shell command",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string", description: "Command to execute" },
                cwd: { type: "string", description: "Working directory" },
                timeoutMs: { type: "number", description: "Timeout in milliseconds", default: 30000 }
              },
              required: ["command"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "search_code",
            description: "Search for text in files",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Directory to search in" },
                query: { type: "string", description: "Search query" },
                maxResults: { type: "number", description: "Maximum results", default: 30 }
              },
              required: ["path", "query"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "copy_file",
            description: "Copy a file",
            parameters: {
              type: "object",
              properties: {
                source: { type: "string", description: "Source file path" },
                destination: { type: "string", description: "Destination file path" }
              },
              required: ["source", "destination"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "move_file",
            description: "Move a file",
            parameters: {
              type: "object",
              properties: {
                source: { type: "string", description: "Source file path" },
                destination: { type: "string", description: "Destination file path" }
              },
              required: ["source", "destination"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "make_dir",
            description: "Create a directory",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Directory path to create" }
              },
              required: ["path"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "delete_file",
            description: "Delete a file",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "File path to delete" }
              },
              required: ["path"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "delete_dir",
            description: "Delete a directory",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Directory path to delete" }
              },
              required: ["path"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "fetch_web",
            description: "Fetch content from a URL",
            parameters: {
              type: "object",
              properties: {
                url: { type: "string", description: "URL to fetch" },
                format: { type: "string", description: "Format: text, html, news, links", default: "text" },
                maxChars: { type: "number", description: "Maximum characters", default: 8000 }
              },
              required: ["url"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "transcribe_media",
            description: "Transcribe an audio or video file into UTF-8 text using the local Whisper runtime",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Media file path" },
                outputDir: { type: "string", description: "Directory to place the transcript text file" },
                model: { type: "string", description: "Whisper model name", default: "tiny" },
                language: { type: "string", description: "Language code such as zh or en", default: "zh" },
                task: { type: "string", description: "Whisper task: transcribe or translate", default: "transcribe" },
                timeoutMs: { type: "number", description: "Transcription timeout in milliseconds", default: 1800000 }
              },
              required: ["path"]
            }
          }
        },
        {
          type: "function",
          function: {
            name: "generate_word_doc",
            description: "Generate a Word document",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Output file path" },
                title: { type: "string", description: "Document title" },
                items: { type: "array", description: "Items to include", items: {} }
              },
              required: ["path"]
            }
          }
        }
      ]
    })
  });

  if (!response.ok) {
    const failurePayload = await parseJsonResponse(response);
    const detail =
      failurePayload?.error?.message ||
      failurePayload?.error ||
      failurePayload?.message ||
      failurePayload?.rawText ||
      `HTTP ${response.status}`;
    return {
      error: `HTTP ${response.status}: ${String(detail || "").slice(0, 300)}`
    };
  }

  return await parseOllamaStreamResponse(response, onChunk, { timeout });
}

function buildUserMessageContent(prompt = "", attachments = []) {
  const imagePayloads = attachments
    .map((item) => String(item?.imageBase64 || "").trim())
    .filter(Boolean);

  const nonImageAttachmentLines = attachments
    .filter((item) => item && item.mediaType && item.mediaType !== "image")
    .map((item, index) => {
      const mediaType = item.mediaType || "file";
      return `${index + 1}. ${item.name} | ${mediaType} | ${item.path}`;
    });

  const content = [
    String(prompt || "").trim(),
    nonImageAttachmentLines.length
      ? ["", "[Non-image attachments available in this task]", ...nonImageAttachmentLines].join("\n")
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  return imagePayloads.length
    ? {
        role: "user",
        content,
        images: imagePayloads
      }
    : {
        role: "user",
        content
      };
}

function stripAttachmentContext(prompt = "") {
  const text = String(prompt || "");
  return text
    .replace(/\n*\[(?:\u9644\u4ef6\u4fe1\u606f|Attachment Info)\][\s\S]*$/u, "")
    .replace(/\n*\[Non-image attachments available in this task\][\s\S]*$/u, "")
    .trim();
}

function buildMultimodalGuidance(attachments = []) {
  const imageAttachments = attachments.filter((item) => item && item.mediaType === "image" && item.imageBase64);
  if (!imageAttachments.length) {
    return "";
  }

  return [
    "检测到图片附件：请先基于多模态视觉能力直接分析图片内容，再决定是否需要调用本地工具。",
    "如果消息中已附带图片，不要回复“无法查看图片”。",
    "除非用户明确要求读取二进制结构，否则不要对 .png/.jpg/.jpeg/.webp/.gif/.bmp 调用 read_file。",
    "When image attachments are included, they are already attached as multimodal image inputs in this user message.",
    "Analyze the image content directly with vision capabilities before considering local tools.",
    "Do not claim that you cannot see images if image attachments are already present in this message.",
    "Do NOT call read_file on .png, .jpg, .jpeg, .webp, .gif, or .bmp attachments unless the user explicitly asks for binary metadata or file structure."
  ].join("\n");
}

function hasImageAttachments(attachments = []) {
  return attachments.some((item) => item && item.mediaType === "image" && item.imageBase64);
}

function hasAudioVideoAttachments(attachments = []) {
  return attachments.some((item) => {
    const mediaType = String(item?.mediaType || "").toLowerCase();
    const itemPath = String(item?.path || "");
    const extension = path.extname(itemPath).toLowerCase();
    return (
      mediaType === "audio" ||
      mediaType === "video" ||
      [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".mp4", ".mov", ".mkv", ".avi", ".webm"].includes(extension)
    );
  });
}

function buildImageWorkflow() {
  return {
    id: "image-analysis",
    label: "图片分析任务",
    steps: [
      "优先基于视觉能力直接读取并理解图片内容。",
      "仅在确有必要时调用本地工具做补充验证。",
      "输出结构化结论，明确可确认事实与不确定项。"
    ],
    capabilityHints: ["vision"],
    skillQueries: []
  };
}

function clampMessageText(text = "", maxChars = 0) {
  const source = String(text || "");
  if (!maxChars || source.length <= maxChars) {
    return source;
  }
  return `${source.slice(0, Math.max(0, maxChars - 64))}\n...[trimmed ${source.length - maxChars} chars]`;
}

function compactOllamaMessages(messages = [], options = {}) {
  const maxMessages = Number(options.maxMessages) || OLLAMA_MAX_HISTORY_MESSAGES;
  const maxMessageChars = Number(options.maxMessageChars) || OLLAMA_MAX_MESSAGE_CHARS;
  const maxTotalChars = Number(options.maxTotalChars) || OLLAMA_MAX_TOTAL_CHARS;

  const normalized = (Array.isArray(messages) ? messages : [])
    .map((item) => ({
      role: item?.role || "user",
      content: clampMessageText(item?.content || "", maxMessageChars),
      images: Array.isArray(item?.images) ? item.images : undefined
    }))
    .filter((item) => String(item.content || "").trim() || (item.images && item.images.length));

  if (!normalized.length) {
    return [];
  }

  const systemMessage = normalized[0]?.role === "system" ? normalized[0] : null;
  let rest = systemMessage ? normalized.slice(1) : normalized.slice();

  if (rest.length > maxMessages) {
    rest = rest.slice(-maxMessages);
  }

  let compacted = systemMessage ? [systemMessage, ...rest] : [...rest];
  let totalChars = compacted.reduce((sum, item) => sum + String(item.content || "").length, 0);

  while (compacted.length > (systemMessage ? 2 : 1) && totalChars > maxTotalChars) {
    compacted.splice(systemMessage ? 1 : 0, 1);
    totalChars = compacted.reduce((sum, item) => sum + String(item.content || "").length, 0);
  }

  if (totalChars > maxTotalChars && compacted.length) {
    const targetIndex = compacted.length - 1;
    const overflow = totalChars - maxTotalChars;
    const current = String(compacted[targetIndex].content || "");
    compacted[targetIndex].content = clampMessageText(current, Math.max(1200, current.length - overflow - 64));
  }

  return compacted;
}

function buildMessageHistory(history = [], systemPrompt = "", currentPrompt = "", attachments = []) {
  const trimmedPrompt = String(currentPrompt || "").trim();
  const normalizedPrompt = stripAttachmentContext(trimmedPrompt);
  const normalizedHistory = Array.isArray(history) ? history.slice(-OLLAMA_MAX_HISTORY_MESSAGES) : [];

  if (normalizedPrompt && normalizedHistory.length) {
    const lastEntry = normalizedHistory[normalizedHistory.length - 1];
    const lastText = String(lastEntry?.text || "").trim();
    const normalizedLastText = stripAttachmentContext(lastText);
    if (
      lastEntry?.role === "user" &&
      normalizedLastText &&
      (normalizedLastText.startsWith(normalizedPrompt) || lastText.startsWith(trimmedPrompt))
    ) {
      normalizedHistory.pop();
    }
  }

  const messages = [
    { role: "system", content: systemPrompt },
    ...normalizedHistory.map((item) => ({
      role: item.role === "system" ? "assistant" : item.role,
      content: clampMessageText(item.text, OLLAMA_MAX_MESSAGE_CHARS)
    })),
    buildUserMessageContent(normalizedPrompt || trimmedPrompt, attachments)
  ].map((item) => ({
    ...item,
    content: clampMessageText(item.content, OLLAMA_MAX_MESSAGE_CHARS)
  }));

  return compactOllamaMessages(messages);
}

function detectSupplementalSkillQueries(prompt = "", workflow = null, workflowProbe = null) {
  const normalizedPrompt = String(prompt || "").toLowerCase();
  const trimmedPrompt = String(prompt || "").trim();
  const queries = new Set();

  const explicitBlockingIssues = Array.isArray(workflowProbe?.blockingIssues)
    ? workflowProbe.blockingIssues.filter(Boolean)
    : [];

  const taskIntentPattern =
    /([a-z]:\\\\|\/|\.tsx\b|\.ts\b|\.js\b|\.jsx\b|\.json\b|\.md\b|\u68c0\u67e5|\u67e5\u770b|\u5206\u6790|\u4fee\u590d|\u4fee\u6539|\u5b9e\u73b0|\u7f16\u5199|\u751f\u6210|\u8bfb\u53d6|\u641c\u7d22|\u67e5\u627e|\u5b89\u88c5|\u6253\u5f00|\u8fd0\u884c|\u6784\u5efa|\u6d4b\u8bd5|\u603b\u7ed3|\u8054\u7f51|\u7f51\u9875|\u6587\u6863|read|check|analy[sz]e|fix|implement|build|test|search|find|install|open|run|write|create|edit)/i;
  const smallTalkPattern =
    /^(\u4f60\u597d|\u60a8\u597d|hi|hello|hey|\u5728\u5417|\u5728\u4e48|\u65e9\u4e0a\u597d|\u4e0b\u5348\u597d|\u665a\u4e0a\u597d|\u8c22\u8c22|thanks|thank you|\u6536\u5230|\u597d\u7684|ok|okay)[!\uff01?\uff1f\u3002\s]*$/i;

  const isTaskLikePrompt =
    explicitBlockingIssues.length > 0 ||
    taskIntentPattern.test(trimmedPrompt) ||
    trimmedPrompt.length >= 24;

  if (!isTaskLikePrompt || smallTalkPattern.test(trimmedPrompt)) {
    return [];
  }

  if (workflow?.label) {
    queries.add(workflow.label);
  }

  for (const query of workflow?.skillQueries || []) {
    queries.add(query);
  }

  for (const issue of explicitBlockingIssues) {
    queries.add(issue);
  }

  const explicitWebTerms = [
    "web",
    "browser",
    "browse",
    "search",
    "crawl",
    "url",
    "documentation",
    "\u8054\u7f51",
    "\u4e0a\u7f51",
    "\u7f51\u9875",
    "\u7f51\u7ad9",
    "\u641c\u7d22",
    "\u6293\u53d6",
    "\u6587\u6863",
    "\u68c0\u7d22"
  ];

  if (explicitWebTerms.some((term) => normalizedPrompt.includes(term.toLowerCase()))) {
    queries.add("web search");
    queries.add("browser automation");
    queries.add("web access");
  }

  return [...queries].filter(Boolean);
}
function extractToolCalls(message) {
  const calls = [];
  
  if (message?.tool_calls && Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      if (toolCall.function) {
        calls.push({
          name: toolCall.function.name,
          arguments:
            typeof toolCall.function.arguments === "string"
              ? safeParseJson(toolCall.function.arguments) || {}
              : toolCall.function.arguments
        });
      }
    }
  }

  if (calls.length) {
    return normalizeToolCalls(calls);
  }

  const text = extractMessageText(message);
  const fallbackCalls = normalizeToolCalls(protocol.parseToolCalls(text));
  if (fallbackCalls.length) {
    logRuntime("tool_calls:fallback_from_text", {
      count: fallbackCalls.length,
      preview: text.slice(0, 200)
    });
    return fallbackCalls;
  }

  const taggedPayloads = extractTaggedToolCallPayloads(text);

  if (taggedPayloads.length) {
    const parsed = safeParseJson(taggedPayloads[0]);
    const parsedCalls = normalizeToolCalls(
      Array.isArray(parsed?.calls) ? parsed.calls : parsed?.name ? [parsed] : []
    );

    if (parsedCalls.length) {
      logRuntime("tool_calls:recovered_inline_json", {
        count: parsedCalls.length,
        preview: text.slice(0, 200)
      });
      return parsedCalls;
    }
  }

  const inlineJsonMatch = text.match(/(\{\s*"calls"\s*:\s*\[[\s\S]*\]\s*\})/i);

  if (inlineJsonMatch) {
    const parsed = safeParseJson(inlineJsonMatch[1]);
    const parsedCalls = normalizeToolCalls(
      Array.isArray(parsed?.calls) ? parsed.calls : parsed?.name ? [parsed] : []
    );

    if (parsedCalls.length) {
      logRuntime("tool_calls:recovered_inline_json", {
        count: parsedCalls.length,
        preview: text.slice(0, 200)
      });
      return parsedCalls;
    }
  }

  const taggedCalls = [];
  for (const payload of taggedPayloads) {
    const parsed = safeParseJson(payload);
    const parsedCalls = normalizeToolCalls(
      Array.isArray(parsed?.calls) ? parsed.calls : parsed?.name ? [parsed] : []
    );
    if (parsedCalls.length) {
      taggedCalls.push(...parsedCalls);
    }
  }

  if (taggedCalls.length) {
    logRuntime("tool_calls:recovered_tagged_calls", {
      count: taggedCalls.length,
      preview: text.slice(0, 200)
    });
    return taggedCalls;
  }

  const recoveredSingleCalls = recoverSingleToolCallPayload(text);
  if (recoveredSingleCalls.length) {
    logRuntime("tool_calls:recovered_single_call", {
      count: recoveredSingleCalls.length,
      preview: text.slice(0, 200)
    });
    return recoveredSingleCalls;
  }
  
  if (/<vgo_tool_call>|"calls"\s*:/.test(text)) {
    logRuntime("tool_calls:unparsed_payload", {
      preview: text.slice(0, 400)
    });
  }

  return [];
}

function extractMessageText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (typeof message.text === "string") return message.text;
  if (Array.isArray(message.content)) {
    return message.content
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join("\n");
  }
  if (message.content && typeof message.content === "object") {
    if (typeof message.content.text === "string") return message.content.text;
    if (Array.isArray(message.content.parts)) {
      return message.content.parts
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\n");
    }
  }
  return String(message.content || "");
}

function collectToolResults(rawEvents = []) {
  return rawEvents
    .filter((event) => event && event.type === "tool_result")
    .map((event) => ({
      name: event.tool,
      ok: event.ok,
      summary: event.summary,
      output: event.output
    }));
}

function extractRequestedFilePaths(prompt = "", workspace = "") {
  const source = String(prompt || "");
  const absolutePattern = /[A-Za-z]:\\[A-Za-z0-9._-]+(?:\\[A-Za-z0-9._-]+)*/g;
  const absoluteMatches = [...source.matchAll(absolutePattern)];
  const absolutePathMatches = absoluteMatches.map((match) => match[0]);
  const absoluteMatchRanges = absoluteMatches.map((match) => {
    const start = match.index ?? 0;
    return [start, start + String(match[0] || "").length];
  });
  const relativePattern = /(?:src|electron|ui)[\\/][A-Za-z0-9._/\\-]+|package\.json/gi;
  const relativePathMatches = [];

  for (const match of source.matchAll(relativePattern)) {
    const relativePath = String(match[0] || "");
    const start = match.index ?? 0;
    const end = start + relativePath.length;
    const isInsideAbsolutePath = absoluteMatchRanges.some(
      ([absoluteStart, absoluteEnd]) => start >= absoluteStart && end <= absoluteEnd
    );
    if (!isInsideAbsolutePath) {
      relativePathMatches.push(relativePath);
    }
  }

  const matches =
    absolutePathMatches.length > 0
      ? [...absolutePathMatches, ...relativePathMatches]
      : [...absolutePathMatches, ...relativePathMatches];
  const paths = new Set();
  const normalizedWorkspace = workspace ? path.resolve(workspace).toLowerCase() : "";
  const inferredProjectRoot = (() => {
    for (const absolutePath of absolutePathMatches) {
      const normalizedAbsolute = path.resolve(absolutePath);
      const markerMatch = normalizedAbsolute.match(/^(.*?)(?:\\(?:src|electron|ui)\\|\\package\.json$)/i);
      if (markerMatch?.[1]) {
        return path.resolve(markerMatch[1]);
      }
      if (/\\package\.json$/i.test(normalizedAbsolute)) {
        return path.dirname(normalizedAbsolute);
      }
    }
    return "";
  })();

  for (const rawMatch of matches) {
    const cleaned = String(rawMatch || "")
      .trim()
      .replace(/[闁挎稑琚埀顒€鍊堕埀顑块檷閳ь剙顭堥埀顒€顑戠槐?:闁挎稒鐔槐鐢告晬?!\]\s]+$/g, "");
    if (!cleaned) {
      continue;
    }

    const resolved = path.isAbsolute(cleaned)
      ? path.resolve(cleaned)
      : inferredProjectRoot
        ? path.resolve(inferredProjectRoot, cleaned.replace(/\//g, path.sep))
        : workspace
          ? path.resolve(workspace, cleaned.replace(/\//g, path.sep))
          : cleaned.replace(/\//g, path.sep);
    const normalizedResolved = resolved.toLowerCase();
    const basename = path.basename(normalizedResolved);
    const likelyFile =
      basename === "package.json" ||
      /\.(tsx|ts|js|jsx|json|css|md|html)$/i.test(normalizedResolved);

    if (normalizedResolved === normalizedWorkspace || !likelyFile) {
      continue;
    }

    paths.add(normalizedResolved);
  }

  return [...paths];
}

function collectCompletedReadPaths(rawEvents = []) {
  const completed = new Set();

  for (const event of rawEvents) {
    if (event?.type !== "tool_result" || event.tool !== "read_file" || !event.ok) {
      continue;
    }

    const summary = String(event.summary || "");
    const match = summary.match(/^Read\s+(.+?)\s+lines\s+\d+-\d+\./i);
    if (match?.[1]) {
      completed.add(path.resolve(match[1]).toLowerCase());
    }
  }

  return completed;
}

function getUnfinishedRequiredReadPaths(prompt = "", rawEvents = [], workspace = "") {
  const requestedPaths = extractRequestedFilePaths(prompt, workspace);
  if (!requestedPaths.length) {
    return [];
  }

  const completedReadPaths = collectCompletedReadPaths(rawEvents);
  const failedReadPaths = collectFailedReadPaths(rawEvents);
  return requestedPaths.filter(
    (requestedPath) =>
      !completedReadPaths.has(requestedPath) &&
      !failedReadPaths.has(requestedPath)
  );
}

function collectFailedReadPaths(rawEvents = []) {
  const failed = new Set();
  for (const event of rawEvents) {
    if (event?.type === "tool_result" && event?.tool === "read_file" && !event?.ok) {
      if (/ENOENT|no such file|not exist/i.test(String(event?.summary || ""))) {
        const match = String(event?.summary || "").match(/^Read\s+(.+?)\s+/i);
        if (match?.[1]) {
          failed.add(path.resolve(match[1]));
        }
      }
    }
  }
  return failed;
}

function hasUnfinishedRequiredReads(prompt = "", rawEvents = [], workspace = "") {
  return getUnfinishedRequiredReadPaths(prompt, rawEvents, workspace).length > 0;
}

function promptAllowsAutonomousContinuation(prompt = "") {
  const normalized = String(prompt || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const autonomyPatterns = [
    /\u7ee7\u7eed/,
    /\u81ea\u52a8\u7ee7\u7eed/,
    /\u4e0d\u8981\u505c/,
    /\u8dd1\u5b8c/,
    /\u4e00\u6b21\u6027\u5b8c\u6210/,
    /\u5b8c\u6574\u6267\u884c/,
    /\u7ee7\u7eed\u5b8c\u6210/,
    /continue/,
    /keep going/,
    /autonom/i,
    /end[- ]to[- ]end/
  ];
  return autonomyPatterns.some((pattern) => pattern.test(normalized));
}

function shouldContinueAutonomously(text = "", rawEvents = [], prompt = "", workspace = "") {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return false;
  }

  const hasToolResults = rawEvents.some((event) => event && event.type === "tool_result");
  const unfinishedRequiredReads = hasUnfinishedRequiredReads(prompt, rawEvents, workspace);
  const successfulWrite = rawEvents.some(
    (event) => event?.type === "tool_result" && event?.tool === "write_file" && event?.ok
  );
  const allReadsFailed = rawEvents.some(
    (event) => event?.type === "tool_result" && event?.tool === "read_file" && !event?.ok
  );

  if (successfulWrite && allReadsFailed) {
    return false;
  }

  const continuationPatterns = [
    /继续思考/i,
    /继续处理/i,
    /继续执行/i,
    /正在思考/i,
    /thinking/i,
    /continue/i,
    /keep going/i,
    /next step/i,
    /step\s*\d+\s*\/\s*\d+/i
  ];

  const pendingActionPatterns = [
    /正在执行工具/i,
    /正在调用工具/i,
    /准备执行/i,
    /即将执行/i,
    /running tool/i,
    /executing/i
  ];

  const finalPatterns = [
    /agent\s*已完成本轮任务/i,
    /任务完成/i,
    /处理完成/i,
    /结论[:：]/i,
    /final answer/i,
    /done/i,
    /completed/i
  ];

  if (finalPatterns.some((pattern) => pattern.test(normalized))) {
    if (unfinishedRequiredReads && !allReadsFailed) {
      return true;
    }
    return false;
  }

  if (unfinishedRequiredReads && !allReadsFailed) {
    return true;
  }

  if (allReadsFailed && successfulWrite) {
    return false;
  }

  if (continuationPatterns.some((pattern) => pattern.test(normalized))) {
    return unfinishedRequiredReads || promptAllowsAutonomousContinuation(prompt);
  }

  if (!hasToolResults && pendingActionPatterns.some((pattern) => pattern.test(normalized))) {
    return unfinishedRequiredReads || promptAllowsAutonomousContinuation(prompt);
  }

  return false;
}

function needsForcedFinalAnswer(text = "", rawEvents = [], prompt = "", workspace = "") {
  const normalized = String(text || "").trim();
  if (!rawEvents.some((event) => event && event.type === "tool_result" && event.ok)) {
    return false;
  }

  if (hasUnfinishedRequiredReads(prompt, rawEvents, workspace)) {
    return false;
  }

  if (!normalized) {
    return true;
  }

  if (protocol.looksLikeGenericAcknowledgement(normalized)) {
    return true;
  }

  const lower = normalized.toLowerCase();
  if (
    lower.includes("please provide") ||
    lower.includes("specific task") ||
    lower.includes("what task") ||
    lower.includes("what would you like me to do")
  ) {
    return true;
  }

  const promptRequiresStructuredSections =
    /1\./.test(String(prompt || "")) &&
    /2\./.test(String(prompt || "")) &&
    /3\./.test(String(prompt || ""));
  if (promptRequiresStructuredSections) {
    const hasStructuredAnswer = /(^|\n)\s*1\./.test(normalized);
    if (!hasStructuredAnswer) {
      return true;
    }
  }

  return normalized.length < 80;
}

function collectSuccessfulReadResults(rawEvents = []) {
  return rawEvents.filter(
    (event) => event && event.type === "tool_result" && event.tool === "read_file" && event.ok
  );
}

function extractReadPathFromSummary(summary = "") {
  const match = String(summary || "").match(/^Read\s+(.+?)\s+lines\s+\d+-\d+\./i);
  return match?.[1] ? path.resolve(match[1]) : "";
}

function buildProjectReadFallback(prompt = "", rawEvents = []) {
  const readResults = collectSuccessfulReadResults(rawEvents);
  const inspectedPaths = readResults
    .map((result) => extractReadPathFromSummary(result.summary))
    .filter(Boolean);

  const lowerPaths = inspectedPaths.map((item) => item.toLowerCase());
  const inspectedApp = lowerPaths.some((item) => item.endsWith("\\src\\app.tsx"));
  const inspectedMessageList = lowerPaths.some((item) => item.endsWith("\\src\\components\\messagelist.tsx"));
  const inspectedMainPanel = lowerPaths.some((item) => item.endsWith("\\src\\components\\mainpanel.tsx"));
  const inspectedComposer = lowerPaths.some((item) => item.endsWith("\\src\\components\\composer.tsx"));

  if (inspectedApp && inspectedMessageList && inspectedMainPanel && inspectedComposer) {
    return [
      "已完成关键前端文件检查：",
      `- ${inspectedPaths.join("\n- ")}`,
      "",
      "建议下一步：",
      "1. 在 App.tsx 对接状态流，让推理面板和消息流联动。",
      "2. 在 MainPanel/MessageList 增加一致的渲染与错误兜底。",
      "3. 在 Composer 中补齐任务提交与重试入口。",
      "",
      "可继续执行：按模块提交补丁并逐项验证。"
    ].join("\n");
  }

  return protocol.buildFallbackCompletionFromResults(prompt, collectToolResults(rawEvents));
}
async function runOllamaPrompt({
  sessionId,
  settings,
  history,
  sessionMeta,
  workspace,
  requestToolPermission,
  onEvent,
  prompt,
  attachments = [],
  signal
}) {
  const remote = settings?.remote || {};
  const baseUrl = (remote.ollamaUrl || remote.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
  const model = remote.model || "gemma4:latest";
  const imageTask = hasImageAttachments(attachments);
  const audioVideoTask = hasAudioVideoAttachments(attachments);
  const normalizedPrompt = imageTask || audioVideoTask ? stripAttachmentContext(prompt) : prompt;
  const workflowPrompt = audioVideoTask
    ? [
        normalizedPrompt,
        ...attachments
          .map((item) => String(item?.path || "").trim())
          .filter(Boolean)
      ].join("\n")
    : normalizedPrompt;
  const workflow = imageTask
    ? buildImageWorkflow()
    : audioVideoTask
      ? detectWorkflow(workflowPrompt)
      : detectWorkflow(normalizedPrompt);
  const detectedSkills = skillRegistry.detectRelevantSkills(normalizedPrompt);
  const activeSkills = resolveSkillRequiredInspectionPaths(detectedSkills, workspace);
  const skillPreflightNudge = buildSkillPreflightNudge(activeSkills);
  let workflowProbe = null;
  let discoveredSkills = [];
  const rawEvents = [];
  let latestText = "";
  let forcedFinalAnswerAttempts = 0;

  const emitEvent = (event) => {
    if (event?.type && ["workflow_selected", "workflow_probe", "capability_gap", "skill_suggestions", "plan"].includes(event.type)) {
      logRuntime(`event:${event.type}`, event);
    }
    rawEvents.push(event);
    if (typeof onEvent === "function") {
      onEvent(event);
    }
  };

  emitEvent({
    type: "workflow_selected",
    workflowId: workflow.id,
    label: workflow.label,
    detail: `已选择工作流：${workflow.label}。`
  });

  emitEvent({
    type: "plan",
    summary: `${workflow.label} 执行计划`,
    steps: workflow.steps
  });

  if (workflow.id === "audio-video") {
    emitEvent({
      type: "task_status",
      status: "thinking",
      message: "正在分析音视频任务，并检查当前环境可用能力..."
    });

    workflowProbe = probeAudioVideoWorkflow(workflowPrompt, workspace);
    emitEvent({
      type: "workflow_probe",
      workflowId: workflow.id,
      detail: buildCapabilityGapSummary(workflow, workflowProbe)
    });

    if (workflowProbe.blockingIssues.length) {
      emitEvent({
        type: "capability_gap",
        workflowId: workflow.id,
        detail: buildCapabilityGapSummary(workflow, workflowProbe)
      });

      if (
        settings?.agent?.suggestSkillAugmentation !== false &&
        settings?.agent?.autoSearchSkillsOnApproval !== false &&
        typeof requestToolPermission === "function"
      ) {
        const approved = await requestToolPermission({
          name: "skill_discovery",
          arguments: {
            workflow: workflow.label,
            query: workflow.skillQueries.join(", "),
            reason: "检测到能力缺口，申请搜索并推荐可安装技能以补齐执行链路。"
          }
        });

        if (approved) {
          discoveredSkills = discoverRelevantSkills({
            queries: [
              workflow.label,
              ...workflow.skillQueries,
              ...workflowProbe.blockingIssues
            ],
            settings
          });

          emitEvent({
            type: "skill_suggestions",
            workflowId: workflow.id,
            detail: discoveredSkills.length ? `已发现 ${discoveredSkills.length} 个相关技能。` : "",
            skills: discoveredSkills
          });

          if (!discoveredSkills.length) {
            const installableSkills = discoverInstallableSkills({
              queries: [
                workflow.label,
                ...workflow.skillQueries,
                ...workflowProbe.blockingIssues
              ]
            });

            if (installableSkills.length) {
              const candidate = installableSkills[0];
              const installApproved = await requestToolPermission({
                name: "skill_install",
                arguments: {
                  name: candidate.name,
                  sourcePath: candidate.path,
                  reason: "当前任务缺少关键技能，申请安装候选技能以继续执行。"
                }
              });

              if (installApproved) {
                const installResult = installSkillFromSource(candidate.path, candidate.name);
                emitEvent({
                  type: "skill_installed",
                  workflowId: workflow.id,
                  detail: installResult.summary,
                  skill: installResult.skill || null,
                  ok: installResult.ok !== false
                });

                discoveredSkills = discoverRelevantSkills({
                  queries: [
                    workflow.label,
                    ...workflow.skillQueries,
                    ...workflowProbe.blockingIssues
                  ],
                  settings
                });

                emitEvent({
                  type: "skill_suggestions",
                  workflowId: workflow.id,
                  detail: discoveredSkills.length
                    ? `技能 ${candidate.name} 安装后，已识别 ${discoveredSkills.length} 个相关技能。`
                    : "",
                  skills: discoveredSkills
                });
              }
            }
          }
        }
      }
    }
  }

  const supplementalSkillQueries = imageTask || audioVideoTask
    ? []
    : detectSupplementalSkillQueries(prompt, workflow, workflowProbe);
  if (
    supplementalSkillQueries.length &&
    settings?.agent?.suggestSkillAugmentation !== false &&
    settings?.agent?.autoSearchSkillsOnApproval !== false &&
    typeof requestToolPermission === "function"
  ) {
    const approved = await requestToolPermission({
      name: "skill_discovery",
      arguments: {
        workflow: workflow.label,
        query: supplementalSkillQueries.join(", "),
        reason:
          workflowProbe?.blockingIssues?.length
            ? "检测到任务存在能力缺口，申请搜索补充技能。"
            : "申请搜索可提升当前任务完成率的补充技能。"
      }
    });

    if (approved) {
      discoveredSkills = discoverRelevantSkills({
        queries: supplementalSkillQueries,
        settings
      });

      emitEvent({
        type: "skill_suggestions",
        workflowId: workflow.id,
        detail: discoveredSkills.length
          ? `已发现 ${discoveredSkills.length} 个候选技能。`
          : "",
        skills: discoveredSkills
      });

      const codexSkillNames = new Set(
        discoveredSkills
          .filter((skill) => skill.source === "codex")
          .map((skill) => String(skill.name || "").trim().toLowerCase())
      );
      let candidate =
        discoveredSkills.find(
          (skill) =>
            skill.source !== "codex" &&
            !codexSkillNames.has(String(skill.name || "").trim().toLowerCase())
        ) ||
        discoverInstallableSkills({
          queries: supplementalSkillQueries
        })[0];

      if (candidate) {
        const installApproved = await requestToolPermission({
          name: "skill_install",
          arguments: {
            name: candidate.name,
            sourcePath: candidate.path,
            reason: "申请安装候选技能，以提升当前任务执行成功率。"
          }
        });

        if (installApproved) {
          const installResult = installSkillFromSource(candidate.path, candidate.name);
          emitEvent({
            type: "skill_installed",
            workflowId: workflow.id,
            detail: installResult.summary,
            skill: installResult.skill || null,
            ok: installResult.ok !== false
          });

          discoveredSkills = discoverRelevantSkills({
            queries: supplementalSkillQueries,
            settings
          });

          emitEvent({
            type: "skill_suggestions",
            workflowId: workflow.id,
            detail: discoveredSkills.length
              ? `已安装技能 ${candidate.name}，当前可用相关技能数：${discoveredSkills.length}。`
              : installResult.summary,
            skills: discoveredSkills
          });
        }
      }
    }
  }

  const systemPrompt = [
    buildSafeSystemPrompt(settings, sessionMeta, activeSkills),
    buildWorkflowSystemAppendix(workflow, workflowProbe),
    buildSkillAppendix(discoveredSkills),
    buildMultimodalGuidance(attachments)
  ]
    .filter(Boolean)
    .join("\n\n");

  if (
    workflow.id === "audio-video" &&
    workflowProbe?.blockingIssues?.length &&
    !workflowProbe.hasWhisperCli &&
    !workflowProbe.hasPythonWhisper
  ) {
    return {
      ok: false,
      exitCode: 1,
      sessionId,
      text: [
        "音视频任务缺少必要转录能力，暂时无法稳定执行。",
        "缺失能力: " + workflowProbe.blockingIssues.join(", "),
        workflowProbe.mediaPath ? "媒体文件: " + workflowProbe.mediaPath : "",
        "建议先安装: python -m pip install -U openai-whisper",
        discoveredSkills.length
          ? "可用技能建议: " + discoveredSkills.map((item) => item.name).join(", ")
          : "当前未检索到可直接安装的技能建议。"
      ]
        .filter(Boolean)
        .join("\n"),
      error: "audio_video_capability_gap",
      rawEvents,
      usedModel: model,
      actualChannel: "ollama-agent"
    };
  }

  const maxToolSteps = getMaxToolSteps(settings);
  const numPredict = getNumPredict(settings);

  let messages = buildMessageHistory(
    history,
    systemPrompt,
    [normalizedPrompt, skillPreflightNudge].filter(Boolean).join("\n\n"),
    attachments
  );

  let writeArgumentRetrySent = false;
  let missingArgumentRetrySent = false;
  let consecutiveMissingArgumentSteps = 0;
  let totalMissingArgumentFailures = 0;
  let rateLimitRetryUsed = 0;
  let autoContinueNudgeCount = 0;

  for (let step = 0; step < maxToolSteps; step += 1) {
    if (signal?.aborted) {
      return {
        ok: false,
        exitCode: 130,
        sessionId,
        text: "任务已被用户中断。",
        error: "aborted_by_user",
        rawEvents,
        usedModel: model,
        actualChannel: "ollama-agent"
      };
    }

    emitEvent({
      type: "task_status",
      status: step === 0 ? "thinking" : "continuing",
      message: "正在思考并规划下一步执行..."
    });

    if (step === 0) {
      try {
        const workspacePath = workspace || process.cwd();
        const entries = fs.readdirSync(workspacePath).filter(f => !f.startsWith('.') && f !== 'node_modules');
        const projectConfigFiles = ['package.json', 'tsconfig.json', 'tsconfig.node.json', 'electron', 'src', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle'];
        const hasProjectConfig = projectConfigFiles.some(config => {
          try {
            const configPath = path.join(workspacePath, config);
            const stat = fs.statSync(configPath);
            return stat.isFile() || stat.isDirectory();
          } catch {
            return false;
          }
        });
        if (!hasProjectConfig) {
          messages.push({
            role: "user",
            content:
              "当前目录看起来不是标准项目目录。请优先定位并读取 package.json、tsconfig.json、src/ 或 electron/ 等关键文件，再执行 write_file。"
          });
        }
      } catch (e) {
        // ignore directory check errors
      }
    }

    try {
      const response = await sendOllamaRequest({
        baseUrl,
        model,
        messages,
        signal,
        timeout: maxToolSteps * 60000,
        numPredict,
        onChunk: ({ content, done }) => {
          const streamedText = modelAdapters.stripCustomerServiceBoilerplate(
            protocol.sanitizeAssistantText(protocol.tryRecoverMojibake(content || "")),
            prompt
          );

          if (!streamedText) {
            return;
          }

          emitEvent({
            type: "model_stream_delta",
            step: step + 1,
            model,
            text: streamedText,
            done: Boolean(done)
          });
        }
      });

      if (response.error) {
        if (isRateLimitErrorText(response.error) && rateLimitRetryUsed < MAX_OLLAMA_RATE_LIMIT_RETRIES) {
          rateLimitRetryUsed += 1;
          emitEvent({
            type: "task_status",
            status: "retrying",
            message:
              "请求触发限流，正在自动重试 (" +
              rateLimitRetryUsed +
              "/" +
              MAX_OLLAMA_RATE_LIMIT_RETRIES +
              ")..."
          });
          await new Promise((resolve) => setTimeout(resolve, 900 * rateLimitRetryUsed));
          step -= 1;
          continue;
        }
        logRuntime("request:error", { error: response.error });
        return {
          ok: false,
          exitCode: 1,
          sessionId,
          text: "Ollama 请求失败: " + response.error,
          error: response.error,
          rawEvents,
          usedModel: model,
          actualChannel: "ollama"
        };
      }

      const assistantMessage = response.message;
      const messageText = protocol.tryRecoverMojibake(extractMessageText(assistantMessage));
      const toolCalls = extractToolCalls(assistantMessage);

      logRuntime("model:response", {
        step,
        hasToolCalls: toolCalls.length > 0,
        textPreview: messageText.slice(0, 200)
      });

      latestText = modelAdapters.stripCustomerServiceBoilerplate(
        protocol.sanitizeAssistantText(messageText),
        prompt
      );

      emitEvent({
        type: "model_response",
        step: step + 1,
        model,
        text: latestText,
        toolCalls
      });

      if (!toolCalls.length) {
        if (needsForcedFinalAnswer(latestText, rawEvents, prompt, workspace)) {
          if (forcedFinalAnswerAttempts >= 1) {
            return {
              ok: true,
              exitCode: 0,
              sessionId,
              text: buildProjectReadFallback(prompt, rawEvents),
              error: "",
              rawEvents,
              usedModel: model,
              actualChannel: "ollama-agent"
            };
          }

          forcedFinalAnswerAttempts += 1;
          messages.push({ role: "assistant", content: messageText });
          messages.push({
            role: "user",
            content: [
              "You have already completed the required tool execution for this task.",
              "Do not ask the user for another task.",
              "Based only on the files and tool results already inspected in this round, provide the final answer now.",
              "Your final answer must directly address the user's requested output sections.",
              "Use a numbered structure such as 1. 2. 3. 4. when the user requested numbered output."
            ].join("\n")
          });
          continue;
        }

        if (shouldContinueAutonomously(latestText, rawEvents, prompt, workspace)) {
          if (autoContinueNudgeCount >= 4) {
            const finalText =
              latestText ||
              protocol.buildFallbackCompletionFromResults(prompt, collectToolResults(rawEvents));
            return {
              ok: true,
              exitCode: 0,
              sessionId,
              text: finalText,
              error: "",
              rawEvents,
              usedModel: model,
              actualChannel: rawEvents.some(e => e.type === "tool_result") ? "ollama-agent" : "ollama"
            };
          }
          autoContinueNudgeCount += 1;
          const unfinishedReadPaths = getUnfinishedRequiredReadPaths(prompt, rawEvents, workspace);
          const nextRequiredPath = unfinishedReadPaths[0] || "";
          logRuntime("model:auto_continue", {
            step,
            textPreview: latestText.slice(0, 200),
            unfinishedRequiredReads: unfinishedReadPaths.length > 0,
            autoContinueNudgeCount,
            nextRequiredPath
          });

          messages.push({ role: "assistant", content: messageText });
          messages.push({
            role: "user",
            content:
              unfinishedReadPaths.length > 0
                ? [
                    "Continue autonomously.",
                    "Do not stop at a partial progress summary.",
                    "The task is not complete yet because these required files have not been inspected:",
                    ...unfinishedReadPaths.map((filePath, index) => String(index + 1) + ". " + filePath),
                    "Call the next required tool now for " + nextRequiredPath + ".",
                    "Use the exact absolute file paths listed above.",
                    "Do not switch to a different workspace and do not use relative paths by themselves.",
                    "Respond with tool calls first. Do not only describe the next action.",
                    "Only give the final answer after every required file above has been inspected or a concrete blocker prevents completion."
                  ].join("\n")
                : [
                    "Continue autonomously.",
                    "Do not stop at a partial progress summary.",
                    "If there are unfinished requested files, checks, or steps, keep calling tools until they are done.",
                    "Respond with tool calls first when more execution is needed.",
                    "Only give the final answer when the full requested task has actually been completed or a concrete blocker prevents completion."
                  ].join("\n")
          });
          continue;
        }

        const hadToolResults = rawEvents.some((event) => event.type === "tool_result");
        let finalText =
          latestText ||
          (hadToolResults
            ? protocol.buildFallbackCompletionFromResults(prompt, collectToolResults(rawEvents))
            : latestText);
        const structuredPromptRequested =
          /1\./.test(String(prompt || "")) &&
          /2\./.test(String(prompt || "")) &&
          /3\./.test(String(prompt || ""));
        const structuredAnswerPresent =
          /(^|\n)\s*1\./.test(String(finalText || ""));
        const stillDeflectingTask =
          String(finalText || "").includes("\u8bf7\u63d0\u4f9b") &&
          (String(finalText || "").includes("\u5177\u4f53\u4efb\u52a1") ||
            String(finalText || "").includes("\u4fee\u6539\u8981\u6c42") ||
            String(finalText || "").includes("\u4fee\u590d\u7684Bug"));
        if (
          hadToolResults &&
          !hasUnfinishedRequiredReads(prompt, rawEvents, workspace) &&
          structuredPromptRequested &&
          (!structuredAnswerPresent || stillDeflectingTask)
        ) {
          finalText = buildProjectReadFallback(prompt, rawEvents);
        }
        return {
          ok: true,
          exitCode: 0,
          sessionId,
          text: finalText,
          error: "",
          rawEvents,
          usedModel: model,
          actualChannel: rawEvents.some(e => e.type === "tool_result") ? "ollama-agent" : "ollama"
        };
      }

      messages.push({ role: "assistant", content: messageText });

      const toolResults = [];
      for (const call of toolCalls) {
        if (signal?.aborted) {
          return {
            ok: false,
            exitCode: 130,
            sessionId,
            text: "任务已被用户中断。",
            error: "aborted_by_user",
            rawEvents,
            usedModel: model,
            actualChannel: "ollama-agent"
          };
        }

        emitEvent({
          type: "task_status",
          status: "tool_running",
          message: "正在执行工具: " + call.name
        });

        const execution = await executeToolCallWithResilience({
          workspace,
          call,
          executeToolCall,
          executeOptions: {
            accessScope: settings?.access?.scope || "workspace-and-desktop",
            confirm: (toolCall) =>
              requestToolPermission(toolCall, (permissionEvent) => {
                emitEvent({ ...permissionEvent, step: step + 1 });
              })
          },
          emitStatus: (event) => emitEvent({ ...event, step: step + 1 })
        });
        const result = execution.result;

        toolResults.push(result);
        logRuntime("tool:executed", { tool: call.name, ok: result.ok, summary: result.summary });

        // Retryable failures (exit code, ENOENT, timeout) are silenced from UI —
        // only emit task_status so the user doesn't see a raw error card
        const isRetryableFailure = !result.ok && !result.recovered && (
          /Command exited with code|ENOENT|timed out|timeout/i.test(String(result.summary || ""))
        );
        if (result.ok || result.recovered || !isRetryableFailure) {
          emitEvent({
            type: "tool_result",
            step: step + 1,
            tool: call.name,
            ok: result.ok,
            recovered: Boolean(result?.recovered),
            summary: result.summary,
            output: result.output
          });
        } else {
          emitEvent({
            type: "task_status",
            status: "retrying",
            step: step + 1,
            message: `工具执行遇到问题，正在处理中...`
          });
        }
      }

      const toolResultMessage = protocol.buildToolResultMessage(toolResults);
      messages.push({ role: "user", content: toolResultMessage });

      const dirEmpty = toolResults.some(r => r.name === "list_dir" && r.ok && /Listed 0 entries/i.test(r.summary || ""));
      const readNotExistCount = toolResults.filter(r => r.name === "read_file" && !r.ok && /ENOENT|no such file/i.test(r.summary || "")).length;
      if (dirEmpty && readNotExistCount >= 2 && !writeArgumentRetrySent) {
        writeArgumentRetrySent = true;
        messages.push({
          role: "user",
          content:
            "检测到目录为空且多次读取失败。请先创建最小可运行文件，再使用 write_file，并确保包含 path 与 content 参数。"
        });
      }

      const hasWriteArgumentFailure = toolResults.some(
        (result) =>
          result.name === "write_file" &&
          !result.ok &&
          /Missing required argument: (path|content)/i.test(String(result.summary || ""))
      );
      const hasGenericMissingArgumentFailure = toolResults.some(
        (result) => !result.ok && /Missing required argument:/i.test(String(result.summary || ""))
      );
      if (hasGenericMissingArgumentFailure) {
        consecutiveMissingArgumentSteps += 1;
        totalMissingArgumentFailures += toolResults.filter(
          (result) => !result.ok && /Missing required argument:/i.test(String(result.summary || ""))
        ).length;
      } else {
        consecutiveMissingArgumentSteps = 0;
      }

      if (protocol.promptRequiresWrite(prompt) && hasWriteArgumentFailure && !writeArgumentRetrySent) {
        writeArgumentRetrySent = true;
        messages.push({
          role: "user",
          content:
            "write_file 失败：content 参数为空，可能是内容太长被截断。请将文件拆分为多段：第一段用 write_file（不超过 150 行），后续用 append_file 追加。每次调用必须包含完整的 path 和 content。"
        });
      }

      if (hasGenericMissingArgumentFailure && !missingArgumentRetrySent) {
        missingArgumentRetrySent = true;
        messages.push({
          role: "user",
          content:
            "工具参数缺失：请在调用前补齐必填字段（如 run_command.command、read_file.path、write_file.path 与 write_file.content）。"
        });
      }

      if (
        hasGenericMissingArgumentFailure &&
        missingArgumentRetrySent &&
        (consecutiveMissingArgumentSteps >= 3 || totalMissingArgumentFailures >= 5)
      ) {
        const exhaustedMessage =
          "多次重试后仍缺少必填参数，已停止本轮自动执行。请先补全参数后再继续。";
        emitEvent({
          type: "task_status",
          status: "failed",
          message: exhaustedMessage
        });
        return {
          ok: false,
          exitCode: 1,
          sessionId,
          text: exhaustedMessage,
          error: "tool_argument_retry_exhausted",
          rawEvents,
          usedModel: model,
          actualChannel: "ollama-agent"
        };
      }

    } catch (error) {
      logRuntime("request:exception", { error: error.message });
      return {
        ok: false,
        exitCode: 1,
        sessionId,
        text: "Ollama 閺夆晝鍋炵敮瀛樺緞鏉堫偉袝: " + error.message,
        error: error.message,
        rawEvents,
        usedModel: model,
        actualChannel: "ollama"
      };
    }
  }

  return {
    ok: false,
    exitCode: 1,
    sessionId,
    text:
      latestText ||
      (rawEvents.some((event) => event.type === "tool_result")
        ? protocol.buildFallbackCompletionFromResults(prompt, collectToolResults(rawEvents))
        : "Ollama reached the maximum tool-call steps (" + maxToolSteps + ")."),
    error: "ollama_step_limit_reached",
    rawEvents,
    usedModel: model,
    actualChannel: "ollama-agent"
  };
}

async function runHealthCheck(_workspace, settings) {
  const remote = settings?.remote || {};
  const baseUrl = (remote.ollamaUrl || remote.baseUrl || "http://localhost:11434").replace(/\/+$/, "");

  try {
    const response = await fetch(baseUrl + "/api/tags", { method: "GET" });
    if (response.ok) {
      const data = await parseJsonResponse(response);
      const models = Array.isArray(data.models) ? data.models.map(m => m.name).join(", ") : "";
      return {
        ok: true,
        title: "Ollama 连接成功",
        details: models ? "可用模型: " + models : "Ollama 服务可用"
      };
    }
    return {
      ok: false,
      title: "Ollama 服务异常",
      details: "HTTP " + response.status
    };
  } catch (error) {
    return {
      ok: false,
      title: "无法连接 Ollama",
      details: "请检查 Ollama 服务地址与运行状态 (" + baseUrl + "): " + error.message
    };
  }
}

function openLoginShell() {
  return;
}

module.exports = {
  engineId: "ollama",
  engineLabel: "Ollama Local Engine",
  providerLabel: "Local LLM via Ollama",
  runPrompt: runOllamaPrompt,
  runHealthCheck,
  openLoginShell
};

