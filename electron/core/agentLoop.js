
/**
 * agentLoop.js — Unified agent execution loop shared by all model channels.
 *
 * Usage:
 *   const { runAgentLoop } = require("./agentLoop");
 *   const result = await runAgentLoop({ sendRequest, ...options });
 *
 * sendRequest(messages) must return:
 *   { text: string, toolCalls: Array<{name, arguments}>, raw: any }
 *
 * All channels (vgoRemote, ollama, custom HTTP) pass their own sendRequest
 * implementation. The loop logic — tool execution, auto-continue, loop
 * detection, missing-arg retry — is identical for all channels.
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const protocol = require("./agentProtocol");
const { executeToolCall } = require("./toolRuntime");
const { executeToolCallWithResilience } = require("./toolResilience");
const { appendEngineLog } = require("./engineLog");

// ── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_MAX_STEPS = 28;
const MAX_AUTO_CONTINUE_NUDGES = 4;

// ── Shared helper functions (single source of truth) ─────────────────────────

function collectCompletedReadPaths(rawEvents) {
  const completed = new Set();
  for (const event of rawEvents) {
    if (event?.type === "tool_result" && event?.tool === "read_file" && event?.ok) {
      const match = String(event?.summary || "").match(/^Read\s+(.+?)\s+lines/i);
      if (match?.[1]) completed.add(path.resolve(match[1]));
    }
  }
  return completed;
}

function collectFailedReadPaths(rawEvents) {
  const failed = new Set();
  for (const event of rawEvents) {
    if (event?.type === "tool_result" && event?.tool === "read_file" && !event?.ok) {
      if (/ENOENT|no such file|not exist/i.test(String(event?.summary || ""))) {
        const match = String(event?.summary || "").match(/^Read\s+(.+?)\s+/i);
        if (match?.[1]) failed.add(path.resolve(match[1]));
      }
    }
  }
  return failed;
}

function extractRequestedFilePaths(prompt, workspace) {
  const text = String(prompt || "");
  const patterns = [
    /(?:read|open|check|inspect|look at|show me)\s+[`"']?([^\s`"',]+\.[a-zA-Z]{1,6})[`"']?/gi,
    /[`"']([^`"'\s]+\.[a-zA-Z]{1,6})[`"']/g
  ];
  const found = new Set();
  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const p = m[1].trim();
      if (p && !p.startsWith("http")) {
        found.add(path.resolve(workspace || ".", p));
      }
    }
  }
  return [...found];
}

function getUnfinishedRequiredReadPaths(prompt, rawEvents, workspace) {
  const requested = extractRequestedFilePaths(prompt, workspace);
  if (!requested.length) return [];
  const completed = collectCompletedReadPaths(rawEvents);
  const failed = collectFailedReadPaths(rawEvents);
  return requested.filter((p) => !completed.has(p) && !failed.has(p));
}

function hasUnfinishedRequiredReads(prompt, rawEvents, workspace) {
  return getUnfinishedRequiredReadPaths(prompt, rawEvents, workspace).length > 0;
}

function promptAllowsAutonomousContinuation(prompt) {
  const n = String(prompt || "").trim().toLowerCase();
  if (!n) return false;
  return (
    /继续|自动|自行|完整落地|完整方案|直到完成|修复完|排查并修复/.test(n) ||
    /continue|keep going|autonom|end-to-end/.test(n) ||
    /检查|查看|分析|扫描|诊断|排查|帮我看|帮我检/.test(n) ||
    /是否.*正常|能否.*使用|可以.*使用|有没有|是什么|怎么样/.test(n) ||
    /check|inspect|analyz|diagnos|scan|review|audit|find|look/i.test(n) ||
    /what.*is|how.*is|show.*me|tell.*me/i.test(n)
  );
}

function shouldContinueAutonomously(text, rawEvents, prompt, workspace) {
  const normalized = String(text || "").trim();
  if (!normalized) return false;

  const hasToolResults = rawEvents.some((e) => e && e.type === "tool_result");
  const unfinished = hasUnfinishedRequiredReads(prompt, rawEvents, workspace);
  const successfulWrite = rawEvents.some((e) => e && e.type === "tool_result" && e.tool === "write_file" && e.ok);
  const allReadsFailed = rawEvents.some((e) => e && e.type === "tool_result" && e.tool === "read_file" && !e.ok);

  if (successfulWrite && allReadsFailed) return false;

  const finalPatterns = [
    /任务完成|处理完成|结论[:：]|final answer|done|completed/i,
    /agent\s*已完成本轮任务/i
  ];
  if (finalPatterns.some((p) => p.test(normalized))) {
    return unfinished && !allReadsFailed;
  }

  if (unfinished && !allReadsFailed) return true;
  if (allReadsFailed && successfulWrite) return false;

  const continuationPatterns = [
    /继续思考|继续处理|继续执行|正在思考|thinking|continue|keep going|next step/i,
    /step\s*\d+\s*\/\s*\d+/i,
    /让我进一步|让我检查|让我查看|让我先|我将进一步|我需要检查|我需要查看|我将检查|我将查看/i,
    /我先检查|我先查看|我先读取|我先列出|我先扫描|我来检查|我来查看|我来读取/i,
    /先检查|先查看|先读取|先列出|先扫描|先分析/i,
    /让我更|让我尝试|让我搜索|让我深入|让我广泛|让我直接|让我重新/i,
    /搜索不够|不够深入|需要更广|更广泛地|重新搜索|深入查看|深入检查/i,
    /let me.*check|let me.*inspect|let me.*look|let me.*read|let me.*search|let me.*try/i,
    /i will.*check|i will.*inspect|i need to.*check|next.*i will|let me.*broader/i,
    /need.*deeper|not.*enough|try.*different|search.*more|look.*further/i
  ];
  // If model expressed intent to act, always nudge  don't gate on prompt keywords
  if (continuationPatterns.some((p) => p.test(normalized))) {
    return true;
  }

  const pendingActionPatterns = [
    /正在执行工具|正在调用工具|准备执行|即将执行|running tool|executing/i
  ];
  if (!hasToolResults && pendingActionPatterns.some((p) => p.test(normalized))) {
    return unfinished || promptAllowsAutonomousContinuation(prompt);
  }

  return false;
}

function needsForcedFinalAnswer(text, rawEvents, prompt, workspace) {
  const normalized = String(text || "").trim();
  if (!rawEvents.some((e) => e && e.type === "tool_result" && e.ok)) return false;
  if (hasUnfinishedRequiredReads(prompt, rawEvents, workspace)) return false;
  if (!normalized) return true;
  if (protocol.looksLikeGenericAcknowledgement(normalized)) return true;
  const lower = normalized.toLowerCase();
  if (lower.includes("please provide") || lower.includes("what task") || lower.includes("what would you like")) return true;
  return normalized.length < 80;
}

//  Main unified agent loop 
/**
 * @param {object} opts
 * @param {function} opts.sendRequest  async (messages) => { text, toolCalls, raw }
 * @param {string}   opts.prompt
 * @param {string}   opts.sessionId
 * @param {string}   opts.workspace
 * @param {Array}    opts.history       prior messages
 * @param {object}   opts.settings
 * @param {object}   opts.signal        AbortSignal
 * @param {function} opts.emitEvent     (event) => void
 * @param {function} opts.logRuntime    (event, data) => void
 * @param {function} opts.buildMessages (history, systemPrompt, prompt) => messages[]
 * @param {string}   opts.systemPrompt
 * @param {string}   opts.usedModel
 * @param {string}   opts.channelId     label for actualChannel in result
 * @param {function} opts.requestToolPermission  optional
 */
async function runAgentLoop(opts) {
  const {
    sendRequest,
    prompt,
    sessionId,
    workspace,
    history = [],
    settings = {},
    signal,
    emitEvent,
    logRuntime = () => {},
    buildMessages,
    systemPrompt = "",
    usedModel = "unknown",
    channelId = "agent",
    requestToolPermission
  } = opts;

  const rawEvents = [];
  const maxSteps = Number(settings?.agent?.maxToolSteps || settings?.remote?.maxToolSteps || DEFAULT_MAX_STEPS);

  let messages = buildMessages(history, systemPrompt, prompt);
  let latestText = "";
  let writeArgumentRetrySent = false;
  let missingArgumentRetrySent = false;
  let consecutiveMissingArgumentSteps = 0;
  let totalMissingArgumentFailures = 0;
  let autoContinueNudgeCount = 0;
  let lastToolCallFingerprint = "";
  let consecutiveIdenticalToolSteps = 0;
  let forcedFinalAnswerAttempts = 0;

  const accessScope = settings?.access?.scope || "workspace-and-desktop";

  for (let step = 0; step < maxSteps; step += 1) {
    if (signal?.aborted) {
      return { ok: false, exitCode: 130, sessionId, text: "任务已被用户中断。", error: "aborted_by_user", rawEvents, usedModel, actualChannel: channelId };
    }

    emitEvent({ type: "task_status", status: step === 0 ? "thinking" : "continuing", message: "正在思考并规划下一步执行..." });

    //  Send request to model 
    let stepResult;
    try {
      stepResult = await sendRequest(messages);
    } catch (err) {
      if (rawEvents.some((e) => e?.type === "tool_result")) {
        return {
          ok: true, exitCode: 0, sessionId,
          text: protocol.buildFallbackCompletionFromResults(prompt, rawEvents.filter(e => e.type === "tool_result").map(e => ({ name: e.tool, summary: e.summary, output: e.output, ok: e.ok }))),
          error: "", rawEvents, usedModel, actualChannel: channelId + "-degraded"
        };
      }
      return { ok: false, exitCode: 1, sessionId, text: "请求失败: " + err.message, error: err.message, rawEvents, usedModel, actualChannel: channelId };
    }

    const { text: rawText, toolCalls, intentText: stepIntentText } = stepResult;
    latestText = rawText || "";
    // Use intentText (includes think content) for continuation detection
    // Fall back to rawText if intentText not provided (other channels)
    const textForContinuation = stepIntentText || latestText;

    logRuntime("model:response", { step, hasToolCalls: toolCalls.length > 0, textPreview: (textForContinuation || latestText).slice(0, 200) });

    emitEvent({ type: "model_response", step: step + 1, model: usedModel, text: latestText, toolCalls });
    if (latestText) {
      emitEvent({ type: "model_stream_delta", step: step + 1, model: usedModel, text: latestText, done: true });
    }

    //  No tool calls: decide whether to continue or return 
    if (!toolCalls.length) {
      if (needsForcedFinalAnswer(textForContinuation, rawEvents, prompt, workspace)) {
        if (forcedFinalAnswerAttempts >= 1) {
          return { ok: true, exitCode: 0, sessionId, text: latestText || "", error: "", rawEvents, usedModel, actualChannel: channelId };
        }
        forcedFinalAnswerAttempts += 1;
        messages.push({ role: "assistant", content: rawText });
        messages.push({ role: "user", content: "Based only on the tool results already inspected, provide the final answer now. Do not ask for more tasks." });
        continue;
      }

      if (shouldContinueAutonomously(textForContinuation, rawEvents, prompt, workspace)) {
        if (autoContinueNudgeCount >= MAX_AUTO_CONTINUE_NUDGES) {
          return { ok: true, exitCode: 0, sessionId, text: latestText || "", error: "", rawEvents, usedModel, actualChannel: channelId };
        }
        autoContinueNudgeCount += 1;
        const unfinishedPaths = getUnfinishedRequiredReadPaths(prompt, rawEvents, workspace);
        const nextPath = unfinishedPaths[0] || "";
        logRuntime("model:auto_continue", { step, autoContinueNudgeCount, nextPath });
        messages.push({ role: "assistant", content: rawText });
        messages.push({
          role: "user",
          content: unfinishedPaths.length > 0
            ? ["Continue autonomously.", "These required files have not been inspected:", ...unfinishedPaths.map((p, i) => (i+1)+". "+p), "Call the next required tool now for "+nextPath+".", "Respond with tool calls first. Do not only describe the next action."].join("\n")
            : ["Continue autonomously.", "If there are unfinished steps, keep calling tools until done.", "Respond with tool calls first when more execution is needed.", "Only give the final answer when the full task is complete."].join("\n")
        });
        continue;
      }

      // No tool calls, no continuation needed  return final answer
      return { ok: true, exitCode: 0, sessionId, text: latestText || "", error: "", rawEvents, usedModel, actualChannel: channelId };
    }

    messages.push({ role: "assistant", content: rawText });

    //  Loop detection 
    if (toolCalls.length > 0) {
      const fp = toolCalls.map(c => c.name+":"+JSON.stringify(c.arguments||{})).join("|");
      if (fp === lastToolCallFingerprint) {
        consecutiveIdenticalToolSteps += 1;
      } else {
        consecutiveIdenticalToolSteps = 0;
        lastToolCallFingerprint = fp;
      }
      if (consecutiveIdenticalToolSteps >= 2) {
        messages.push({ role: "user", content: "你已经连续 "+(consecutiveIdenticalToolSteps+1)+" 次调用了完全相同的工具（"+toolCalls.map(c=>c.name).join(", ")+"），但结果没有变化。请停止重复调用，基于已有结果直接给出结论或尝试不同的工具/路径。" });
        consecutiveIdenticalToolSteps = 0;
        lastToolCallFingerprint = "";
        continue;
      }
    }

    //  Execute tool calls 
    const toolResults = [];
    for (const call of toolCalls) {
      if (signal?.aborted) {
        return { ok: false, exitCode: 130, sessionId, text: "任务已被用户中断。", error: "aborted_by_user", rawEvents, usedModel, actualChannel: channelId };
      }

      emitEvent({ type: "task_status", status: "tool_running", message: "正在执行工具: " + call.name });

      const execution = await executeToolCallWithResilience({
        workspace, call, executeToolCall,
        executeOptions: {
          accessScope,
          confirm: requestToolPermission
            ? (tc) => requestToolPermission(tc, (ev) => emitEvent({ ...ev, step: step + 1 }))
            : undefined
        },
        emitStatus: (ev) => emitEvent({ ...ev, step: step + 1 })
      });
      const result = execution.result;
      toolResults.push(result);
      logRuntime("tool:executed", { tool: call.name, ok: result.ok, summary: result.summary });

      const isRetryable = !result.ok && !result.recovered && /Command exited with code|ENOENT|timed out|timeout/i.test(String(result.summary || ""));
      if (result.ok || result.recovered || !isRetryable) {
        emitEvent({ type: "tool_result", step: step+1, tool: call.name, ok: result.ok, recovered: Boolean(result.recovered), summary: result.summary, output: result.output });
      } else {
        emitEvent({ type: "task_status", status: "retrying", step: step+1, message: "工具执行遇到问题，正在处理中..." });
      }
    }

    const toolResultMessage = protocol.buildToolResultMessage(toolResults);
    messages.push({ role: "user", content: toolResultMessage });

    // missing-arg retry

    const hasWriteArgFail = toolResults.some(r => r.name === 'write_file' && !r.ok && /Missing required argument: (path|content)/i.test(String(r.summary||'')));
    const hasMissingArgFail = toolResults.some(r => !r.ok && /Missing required argument:/i.test(String(r.summary||'')));
    if (hasMissingArgFail) { consecutiveMissingArgumentSteps += 1; totalMissingArgumentFailures += toolResults.filter(r => !r.ok && /Missing required argument:/i.test(String(r.summary||''))).length; } else { consecutiveMissingArgumentSteps = 0; }
    if (protocol.promptRequiresWrite(prompt) && hasWriteArgFail && !writeArgumentRetrySent) { writeArgumentRetrySent = true; messages.push({ role: 'user', content: 'write_file failed: content is empty, likely truncated. Split the file into chunks of max 150 lines: first chunk with write_file, subsequent chunks with append_file. Always include path and content.' }); }
    if (hasMissingArgFail && !missingArgumentRetrySent) { missingArgumentRetrySent = true; messages.push({ role: 'user', content: 'Tool call missing required arguments. Please include all required fields: run_command needs command, read_file/list_dir need path, write_file needs path and content.' }); }
    if (hasMissingArgFail && missingArgumentRetrySent && (consecutiveMissingArgumentSteps >= 3 || totalMissingArgumentFailures >= 5)) {
      const msg = 'Stopped: too many consecutive missing-argument failures. Please provide complete tool calls.';
      emitEvent({ type: 'task_status', status: 'failed', message: msg });
      return { ok: false, exitCode: 1, sessionId, text: msg, error: 'tool_argument_retry_exhausted', rawEvents, usedModel, actualChannel: channelId };
    }
  } // end for loop

  return { ok: true, exitCode: 0, sessionId, text: latestText || '', error: 'agent_step_limit_reached', rawEvents, usedModel, actualChannel: channelId };
} // end runAgentLoop

module.exports = {
  runAgentLoop,
  shouldContinueAutonomously,
  promptAllowsAutonomousContinuation,
  hasUnfinishedRequiredReads,
  getUnfinishedRequiredReadPaths,
  needsForcedFinalAnswer
};
