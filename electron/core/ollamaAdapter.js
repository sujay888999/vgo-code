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
const { discoverRelevantSkills, buildSkillAppendix } = require("./localSkillDiscovery");

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "ollama-engine.log");

const MAX_TOOL_STEPS = 6;

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

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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

async function sendOllamaRequest({ baseUrl, model, messages, signal }) {
  logRuntime("request:start", { model, baseUrl });
  
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
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

  return await parseJsonResponse(response);
}

function extractToolCalls(message) {
  const calls = [];
  
  if (message?.tool_calls && Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      if (toolCall.function) {
        calls.push({
          name: toolCall.function.name,
          arguments: typeof toolCall.function.arguments === "string" 
            ? JSON.parse(toolCall.function.arguments) 
            : toolCall.function.arguments
        });
      }
    }
  }

  if (calls.length) {
    return calls;
  }

  const text = extractMessageText(message);
  const fallbackCalls = protocol.parseToolCalls(text);
  if (fallbackCalls.length) {
    logRuntime("tool_calls:fallback_from_text", {
      count: fallbackCalls.length,
      preview: text.slice(0, 200)
    });
    return fallbackCalls;
  }
  
  return calls;
}

function extractMessageText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join("\n");
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

async function runOllamaPrompt({
  sessionId,
  settings,
  history,
  sessionMeta,
  workspace,
  requestToolPermission,
  onEvent,
  prompt,
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
    { role: "user", content: [prompt, skillPreflightNudge].filter(Boolean).join("\n\n") }
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
        signal
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
