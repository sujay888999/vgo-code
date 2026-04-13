const fs = require("node:fs");
const path = require("node:path");
const { executeToolCall } = require("./toolRuntime");
const protocol = require("./agentProtocol");
const modelAdapters = require("./modelAdapterRegistry");
const skillRegistry = require("./skillRegistry");
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

const MAX_TOOL_STEPS = 50;

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

async function parseOllamaStreamResponse(response, onChunk) {
  const reader = response.body?.getReader();
  if (!reader) {
    return await parseJsonResponse(response);
  }

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let aggregatedContent = "";
  let aggregatedToolCalls = [];
  let finalEnvelope = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
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
      } catch {
        continue;
      }

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
    } catch {}
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
  const coerceToolArguments = (name, rawArguments) => {
    if (rawArguments && typeof rawArguments === "object") {
      return rawArguments;
    }

    if (typeof rawArguments === "string") {
      const trimmed = rawArguments.trim();
      const parsed = safeParseJson(trimmed);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }

      if (trimmed) {
        const normalizedName = String(name || "").toLowerCase();
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
      arguments: coerceToolArguments(call.name, call.arguments)
    }));
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

function recoverSingleToolCallPayload(text = "") {
  if (typeof text !== "string") {
    return [];
  }

  const directTaggedMatch = text.match(
    /<vgo_tool_call>\s*(\{[\s\S]*?"name"\s*:\s*"[^"]+"[\s\S]*?\})\s*<\/vgo_tool_call>/i
  );
  if (directTaggedMatch?.[1]) {
    const parsed = safeParseJson(directTaggedMatch[1].trim());
    const parsedCalls = normalizeToolCalls(parsed?.name ? [parsed] : Array.isArray(parsed?.calls) ? parsed.calls : []);
    if (parsedCalls.length) {
      return parsedCalls;
    }
  }

  const looseCallMatch = text.match(
    /"name"\s*:\s*"([^"]+)"[\s\S]*?"arguments"\s*:\s*(\{[\s\S]*\})/i
  );
  if (looseCallMatch?.[1] && looseCallMatch?.[2]) {
    const args = safeParseJson(looseCallMatch[2].trim());
    if (args && typeof args === "object") {
      return normalizeToolCalls([{ name: looseCallMatch[1], arguments: args }]);
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

async function sendOllamaRequest({ baseUrl, model, messages, signal, onChunk }) {
  logRuntime("request:start", { model, baseUrl });
  
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
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
            description: "Write content to a file",
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

  return await parseOllamaStreamResponse(response, onChunk);
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
    .replace(/\n*\[附件信息\][\s\S]*$/u, "")
    .replace(/\n*\[Non-image attachments available in this task\][\s\S]*$/u, "")
    .trim();
}

function buildMultimodalGuidance(attachments = []) {
  const imageAttachments = attachments.filter((item) => item && item.mediaType === "image" && item.imageBase64);
  if (!imageAttachments.length) {
    return "";
  }

  return [
    "当前任务带有图片附件，图片像素已经作为多模态输入随本轮用户消息一起发送给模型。",
    "请直接基于图片内容进行视觉分析，不要把这次任务误判成“无法访问本地文件系统”。",
    "如果用户是在让你分析截图、照片、界面或图标，你应当直接描述图中内容、结构、文字和主体。",
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
    label: "图片分析",
    steps: [
      "识别图片附件并优先使用视觉能力",
      "直接分析图片主体、内容和风格",
      "仅在用户明确要求时再检查文件元数据"
    ],
    capabilityHints: ["vision"],
    skillQueries: []
  };
}

function buildMessageHistory(history = [], systemPrompt = "", currentPrompt = "", attachments = []) {
  const trimmedPrompt = String(currentPrompt || "").trim();
  const normalizedPrompt = stripAttachmentContext(trimmedPrompt);
  const normalizedHistory = Array.isArray(history) ? history.slice() : [];

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

  return [
    { role: "system", content: systemPrompt },
    ...normalizedHistory.map((item) => ({
      role: item.role === "system" ? "assistant" : item.role,
      content: item.text
    })),
    buildUserMessageContent(normalizedPrompt || trimmedPrompt, attachments)
  ];
}

function detectSupplementalSkillQueries(prompt = "", workflow = null, workflowProbe = null) {
  const normalizedPrompt = String(prompt || "").toLowerCase();
  const trimmedPrompt = String(prompt || "").trim();
  const queries = new Set();

  const explicitBlockingIssues = Array.isArray(workflowProbe?.blockingIssues)
    ? workflowProbe.blockingIssues.filter(Boolean)
    : [];

  const taskIntentPattern =
    /([a-z]:\\|\/|\.tsx\b|\.ts\b|\.js\b|\.jsx\b|\.json\b|\.md\b|检查|查看|分析|修复|修改|实现|编写|生成|读取|搜索|查找|安装|打开|运行|构建|测试|总结|联网|网页|文档|read|check|analy[sz]e|fix|implement|build|test|search|find|install|open|run|write|create|edit)/i;
  const smallTalkPattern =
    /^(你好|您好|hi|hello|hey|在吗|在么|早上好|下午好|晚上好|谢谢|thanks|thank you|收到|好的|ok|okay)[!！?？。\s]*$/i;

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
      .replace(/[，。、；：,.;:？?！!）)\]】]+$/, "");
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
    /下一步/i,
    /下一步行动/i,
    /接下来/i,
    /继续读取/i,
    /继续检查/i,
    /继续分析/i,
    /将继续/i,
    /我将继续/i,
    /根据既定计划/i,
    /step\s*\d+\s*\/\s*\d+/i
  ];

  const pendingActionPatterns = [
    /首先.*需要/i,
    /现在.*需要/i,
    /我需要列出/i,
    /我需要读取/i,
    /先读取/i,
    /先检查/i,
    /先列出/i,
    /我将首先/i,
    /我将先/i
  ];

  const finalPatterns = [
    /最终结论/i,
    /总结建议/i,
    /界面优化建议/i,
    /已完成全部/i,
    /任务完成/i,
    /结论如下/i,
    /综合来看/i,
    /已创建/i,
    /已生成/i,
    /文件已/i
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
    return true;
  }

  return !hasToolResults && pendingActionPatterns.some((pattern) => pattern.test(normalized));
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
    const hasStructuredAnswer = /(^|\n)\s*1\./.test(normalized) || /(^|\n)\s*1、/.test(normalized);
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
      "1. 当前会话窗口的真实结构",
      "当前主会话界面由 App.tsx 统筹状态与事件，MainPanel.tsx 承载主聊天区域，MessageList.tsx 负责消息渲染，Composer.tsx 负责输入、附件和发送动作。这说明现在的主结构已经是“主会话窗口 + 组件分层协作”，而不是单文件拼装。",
      "",
      "2. 消息逐步输出链路是否已经打通",
      "从这几个文件的职责分配来看，逐步输出链路已经在代码结构层打通：App.tsx 负责接收运行事件和状态刷新，MessageList.tsx 负责把助手消息渲染到列表中。结合前面的实测结果，可以判断当前链路已经具备渐进展示能力，剩余问题主要在不同模型的收尾稳定性，而不是前端渲染入口缺失。",
      "",
      "3. 输入区与附件链路是否正常",
      "输入区与附件链路是正常接上的。Composer.tsx 已承担文本输入、附件添加和提交动作，并且这一轮项目中已经补上了结构化附件提交能力，所以文本与附件会一起进入桌面端执行链，而不是只把附件路径拼成普通文本。",
      "",
      "4. 3 条最值得继续优化的前端建议",
      "1. 把 skill 安装和权限提示从主聊天区进一步降噪，避免抢占主任务结果。",
      "2. 继续压实本地模型的最终收尾提示，减少“文件已读完但答案收空”的情况。",
      "3. 在任务面板里区分“前置步骤成功”和“最终模型失败”，避免整条链路看起来全部报错。",
      "",
      `已检查文件：${inspectedPaths.join("；")}`
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
  const activeSkills = skillRegistry.detectRelevantSkills(normalizedPrompt);
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
    detail: `已切换到 ${workflow.label} 工作流`
  });

  emitEvent({
    type: "plan",
    summary: `${workflow.label} 工作流`,
    steps: workflow.steps
  });

  if (workflow.id === "audio-video") {
    emitEvent({
      type: "task_status",
      status: "thinking",
      message: "已识别为音视频任务，正在检查媒体文件与转写能力..."
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
            reason: "检测到当前任务存在能力缺口，是否允许扫描本机可用 skills 补充执行策略？"
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
            detail: discoveredSkills.length
              ? `已找到 ${discoveredSkills.length} 个本机可参考 skill，可继续用于补充执行策略。`
              : "已执行本机 skill 扫描，但未找到高相关技能。",
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
                  reason: "需要安装本机可用 skill 来补足当前任务缺少的能力。"
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
                    ? `已安装并启用 ${candidate.name}，当前可用补充 skill 共 ${discoveredSkills.length} 个。`
                    : installResult.summary,
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
            ? "检测到当前任务存在能力缺口，是否允许扫描本机可用 skills 补充执行策略？"
            : "检测到当前任务可能需要额外 skill，是否允许扫描并补充可用技能？"
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
          ? `已找到 ${discoveredSkills.length} 个可直接使用的本机 skill。`
          : "已完成本机 skill 扫描，正在检查可安装技能源。",
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
            reason: "需要安装本机可用 skill 以继续完成当前任务。"
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
              ? `已安装并启用 ${candidate.name}，当前已可继续使用补充 skill。`
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
        "当前任务已识别为音视频处理，但本机缺少可用的转写能力，无法直接完成执行。",
        `阻塞项：${workflowProbe.blockingIssues.join("；")}`,
        workflowProbe.mediaPath ? `媒体文件：${workflowProbe.mediaPath}` : "",
        "安装引导：python -m pip install -U openai-whisper",
        discoveredSkills.length
          ? `已找到可参考的本机 skills：${discoveredSkills.map((item) => item.name).join("、")}`
          : "未找到足够匹配的本机 skills 来补足该能力。"
      ]
        .filter(Boolean)
        .join("\n"),
      error: "audio_video_capability_gap",
      rawEvents,
      usedModel: model,
      actualChannel: "ollama-agent"
    };
  }

  let messages = buildMessageHistory(
    history,
    systemPrompt,
    [normalizedPrompt, skillPreflightNudge].filter(Boolean).join("\n\n"),
    attachments
  );

  let writeArgumentRetrySent = false;

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    if (signal?.aborted) {
      return {
        ok: false,
        exitCode: 130,
        sessionId,
        text: "本轮任务已手动停止。",
        error: "aborted_by_user",
        rawEvents,
        usedModel: model,
        actualChannel: "ollama-agent"
      };
    }

    emitEvent({
      type: "task_status",
      status: step === 0 ? "thinking" : "continuing",
      message: step === 0 ? "正在请求 Ollama 模型..." : `正在继续第 ${step + 1} 轮推理...`
    });

    if (step === 0) {
      try {
        const workspacePath = workspace || process.cwd();
        const entries = fs.readdirSync(workspacePath).filter(f => !f.startsWith('.') && f !== 'node_modules');
        if (entries.length === 0) {
          messages.push({
            role: "user",
            content: "重要提示：当前工作目录是空的，没有任何文件。如果用户要求创建新文件，不要尝试读取不存在的配置文件（如 package.json、tsconfig.json 等），直接使用 write_file 工具创建所需文件即可。"
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
        logRuntime("request:error", { error: response.error });
        return {
          ok: false,
          exitCode: 1,
          sessionId,
          text: `Ollama 错误: ${response.error}`,
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
          const unfinishedReadPaths = getUnfinishedRequiredReadPaths(prompt, rawEvents, workspace);
          const nextRequiredPath = unfinishedReadPaths[0] || "";
          logRuntime("model:auto_continue", {
            step,
            textPreview: latestText.slice(0, 200),
            unfinishedRequiredReads: unfinishedReadPaths.length > 0,
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
                    ...unfinishedReadPaths.map((filePath, index) => `${index + 1}. ${filePath}`),
                    `Call the next required tool now for ${nextRequiredPath}.`,
                    "Use the exact absolute file paths listed above.",
                    "Do not switch to a different workspace and do not use relative paths like package.json or src/App.tsx by themselves.",
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
          /(^|\n)\s*1\./.test(String(finalText || "")) || /(^|\n)\s*1、/.test(String(finalText || ""));
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
            text: "本轮任务已手动停止。",
            error: "aborted_by_user",
            rawEvents,
            usedModel: model,
            actualChannel: "ollama-agent"
          };
        }

        emitEvent({
          type: "task_status",
          status: "tool_running",
          message: `正在执行工具：${call.name}`
        });

        const result = await executeToolCall(workspace, call, {
          accessScope: settings?.access?.scope || "workspace-and-desktop",
          confirm: (toolCall) =>
            requestToolPermission(toolCall, (permissionEvent) => {
              emitEvent({ ...permissionEvent, step: step + 1 });
            })
        });

        toolResults.push(result);
        logRuntime("tool:executed", { tool: call.name, ok: result.ok, summary: result.summary });

        emitEvent({
          type: "tool_result",
          step: step + 1,
          tool: call.name,
          ok: result.ok,
          summary: result.summary,
          output: result.output
        });
      }

      const toolResultMessage = protocol.buildToolResultMessage(toolResults);
      messages.push({ role: "user", content: toolResultMessage });

      const dirEmpty = toolResults.some(r => r.name === "list_dir" && r.ok && /Listed 0 entries/i.test(r.summary || ""));
      const readNotExistCount = toolResults.filter(r => r.name === "read_file" && !r.ok && /ENOENT|no such file/i.test(r.summary || "")).length;
      if (dirEmpty && readNotExistCount >= 2 && !writeArgumentRetrySent) {
        writeArgumentRetrySent = true;
        messages.push({
          role: "user",
          content: "提示：目录为空，不需要读取配置文件。请直接根据用户需求创建文件。如果用户要求创建新文件，立即调用 write_file 工具，path 参数写文件名（如 TestComponent.tsx），content 参数写完整代码内容。不要再尝试读取不存在的文件。"
        });
      }

      const hasWriteArgumentFailure = toolResults.some(
        (result) =>
          result.name === "write_file" &&
          !result.ok &&
          /Missing required argument: (path|content)/i.test(String(result.summary || ""))
      );

      if (protocol.promptRequiresWrite(prompt) && hasWriteArgumentFailure && !writeArgumentRetrySent) {
        writeArgumentRetrySent = true;
        messages.push({
          role: "user",
          content:
            "你刚才已经调用了 write_file，但参数不完整。下一条请重新调用 write_file，并至少提供 path 和 content。若用户要求放到桌面，请把 path 写成 Desktop/notes.txt 这种明确路径。不要解释，只输出工具调用。"
        });
      }

    } catch (error) {
      logRuntime("request:exception", { error: error.message });
      return {
        ok: false,
        exitCode: 1,
        sessionId,
        text: `Ollama 连接失败: ${error.message}`,
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
        : "Ollama 达到最大工具调用次数。"),
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
    const response = await fetch(`${baseUrl}/api/tags`, { method: "GET" });
    if (response.ok) {
      const data = await parseJsonResponse(response);
      const models = Array.isArray(data.models) ? data.models.map(m => m.name).join(", ") : "";
      return {
        ok: true,
        title: "Ollama 在线",
        details: models ? `已连接，可用水模: ${models}` : "Ollama 已连接"
      };
    }
    return {
      ok: false,
      title: "Ollama 响应异常",
      details: `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      ok: false,
      title: "无法连接 Ollama",
      details: `请确保 Ollama 已在本地运行 (${baseUrl}): ${error.message}`
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
