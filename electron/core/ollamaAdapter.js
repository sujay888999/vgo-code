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

const MAX_TOOL_STEPS = 12;

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
  return calls
    .filter((call) => call && typeof call === "object" && call.name)
    .map((call) => ({
      name: String(call.name),
      arguments:
        call.arguments && typeof call.arguments === "object"
          ? call.arguments
          : safeParseJson(call.arguments) || {}
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

function detectSupplementalSkillQueries(prompt = "", workflow = null, workflowProbe = null) {
  const normalizedPrompt = String(prompt || "").toLowerCase();
  const queries = new Set();

  if (workflow?.label) {
    queries.add(workflow.label);
  }

  for (const query of workflow?.skillQueries || []) {
    queries.add(query);
  }

  for (const issue of workflowProbe?.blockingIssues || []) {
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
  const absolutePathMatches =
    source.match(/[A-Za-z]:\\[A-Za-z0-9._-]+(?:\\[A-Za-z0-9._-]+)*/g) || [];
  const relativePathMatches =
    source.match(/(?:src|electron|ui)[\\/][A-Za-z0-9._/\\-]+|package\.json/gi) || [];
  const matches = [...absolutePathMatches, ...relativePathMatches];
  const paths = new Set();
  const normalizedWorkspace = workspace ? path.resolve(workspace).toLowerCase() : "";

  for (const rawMatch of matches) {
    const cleaned = String(rawMatch || "")
      .trim()
      .replace(/[，。、；：,.;:？?！!）)\]】]+$/, "");
    if (!cleaned) {
      continue;
    }

    const resolved = path.isAbsolute(cleaned)
      ? path.resolve(cleaned)
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
  return requestedPaths.filter((requestedPath) => !completedReadPaths.has(requestedPath));
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
    /综合来看/i
  ];

  if (finalPatterns.some((pattern) => pattern.test(normalized))) {
    if (unfinishedRequiredReads) {
      return true;
    }
    return false;
  }

  if (unfinishedRequiredReads) {
    return true;
  }

  if (continuationPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  return !hasToolResults && pendingActionPatterns.some((pattern) => pattern.test(normalized));
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
  const workflow = detectWorkflow(prompt);
  const activeSkills = skillRegistry.detectRelevantSkills(prompt);
  const skillPreflightNudge = buildSkillPreflightNudge(activeSkills);
  let workflowProbe = null;
  let discoveredSkills = [];
  const rawEvents = [];
  let latestText = "";

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

    workflowProbe = probeAudioVideoWorkflow(prompt, workspace);
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

  const supplementalSkillQueries = detectSupplementalSkillQueries(prompt, workflow, workflowProbe);
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
    buildSkillAppendix(discoveredSkills)
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

  let messages = [
    { role: "system", content: systemPrompt },
    ...(history || []).map(item => ({
      role: item.role === "system" ? "assistant" : item.role,
      content: item.text
    })),
    buildUserMessageContent([prompt, skillPreflightNudge].filter(Boolean).join("\n\n"), attachments)
  ];

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
        const finalText =
          latestText ||
          (hadToolResults
            ? protocol.buildFallbackCompletionFromResults(prompt, collectToolResults(rawEvents))
            : latestText);
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
