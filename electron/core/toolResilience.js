const path = require("node:path");

const MAX_FALLBACK_ATTEMPTS = 5;
const MAX_REPEAT_FAILURE_SIGNATURE = 3;
const RETRYABLE_FAILURE_PATTERN =
  /(timed out|timeout|ETIMEDOUT|ECONNRESET|network|temporar|429|too many requests|HTTP 5\d\d)/i;

function toObjectArgs(call = {}) {
  if (call?.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments)) {
    return call.arguments;
  }
  if (call?.args && typeof call.args === "object" && !Array.isArray(call.args)) {
    return call.args;
  }
  return {};
}

function normalizePathLike(pathValue = "") {
  const raw = String(pathValue || "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return "";
  return raw.replace(/\\/g, "/");
}

function normalizeSummary(summary = "") {
  return String(summary || "").trim().replace(/\s+/g, " ").slice(0, 220);
}

function isLikelyLongRunningCommand(command = "") {
  return /(uvicorn\s+.*--reload|npm\s+run\s+(dev|start)|pnpm\s+(dev|start)|yarn\s+(dev|start)|vite(?:\s|$)|next\s+dev|tail\s+-f|watch)/i.test(
    String(command || "")
  );
}

function buildFailureSignature(result = {}) {
  const tool = String(result?.name || "unknown_tool").toLowerCase();
  const summary = normalizeSummary(result?.summary || result?.output || "tool_failed");
  return `${tool}::${summary}`;
}

function getMissingRequiredToolArgument(call = {}) {
  const name = String(call?.name || "").trim().toLowerCase();
  const args = toObjectArgs(call);
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
  for (const key of required) {
    if (args[key] === undefined || args[key] === null || String(args[key]).trim() === "") {
      return key;
    }
  }
  return "";
}

function extractWriteFileFallbackFromCommand(command = "") {
  const source = String(command || "");
  if (!source) return null;

  const catWriteMatch =
    source.match(/cat\s*>\s*(["']?)([^'"\r\n]+)\1\s*<<\s*['"]?EOF['"]?\s*\r?\n([\s\S]*?)\r?\nEOF/i) ||
    source.match(/cat\s*<<\s*['"]?EOF['"]?\s*>\s*(["']?)([^'"\r\n]+)\1\s*\r?\n([\s\S]*?)\r?\nEOF/i);
  if (!catWriteMatch) return null;

  const filePath = String(catWriteMatch[2] || "").trim();
  const content = String(catWriteMatch[3] || "");
  if (!filePath || !content) return null;
  return {
    name: "write_file",
    arguments: {
      path: filePath,
      content
    }
  };
}

function dedupeCalls(calls = []) {
  const seen = new Set();
  const out = [];
  for (const call of calls) {
    if (!call?.name) continue;
    const key = `${String(call.name).toLowerCase()}::${JSON.stringify(toObjectArgs(call))}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(call);
  }
  return out;
}

function buildFallbackCandidates(call = {}, result = {}) {
  const candidates = [];
  const name = String(call?.name || "").trim().toLowerCase();
  const args = toObjectArgs(call);
  const summary = String(result?.summary || "");
  const output = String(result?.output || "");
  const mergedFailure = `${summary}\n${output}`;

  const commandLike =
    args.command ||
    args.cmd ||
    args.shell_command ||
    args.shell ||
    args.script ||
    args.cmdline ||
    args.cmdLine ||
    args.shellCommand ||
    args.text ||
    args.body ||
    args.content ||
    args.value ||
    args.input ||
    "";

  if (/Unknown tool:/i.test(summary)) {
    if (String(commandLike).trim()) {
      candidates.push({
        name: "run_command",
        arguments: { command: String(commandLike).trim(), cwd: args.cwd || "." }
      });
    }
    if (String(args.path || "").trim() && typeof args.content === "string") {
      candidates.push({
        name: "write_file",
        arguments: { path: args.path, content: args.content }
      });
    }
    if (String(args.path || "").trim()) {
      candidates.push({ name: "read_file", arguments: { path: args.path } });
      candidates.push({ name: "list_dir", arguments: { path: args.path } });
    }
  }

  if (name === "run_command") {
    const normalizedCommand = String(args.command || commandLike || "").trim();
    const likelyLongRunning = isLikelyLongRunningCommand(normalizedCommand);

    if (typeof commandLike === "string" && commandLike.trim() && String(args.command || "").trim() === "") {
      candidates.push({
        name: "run_command",
        arguments: { ...args, command: commandLike.trim() }
      });
    }

    const writeFallback = extractWriteFileFallbackFromCommand(String(args.command || commandLike || ""));
    if (writeFallback) {
      candidates.push(writeFallback);
    }

    if (/timed out|timeout/i.test(mergedFailure)) {
      if (likelyLongRunning && !args.background) {
        candidates.push({
          name: "run_command",
          arguments: {
            ...args,
            command: normalizedCommand,
            background: true,
            startupTimeoutMs: Number(args.startupTimeoutMs || args.startup_timeout_ms || 20000),
            healthCheckPort: Number(args.healthCheckPort || args.port || 0) || undefined,
            retryReason: "timeout_switch_to_background"
          }
        });
      }
      const timeoutMs = Number(args.timeoutMs || args.timeout_ms || 60000);
      candidates.push({
        name: "run_command",
        arguments: {
          ...args,
          command: normalizedCommand,
          timeoutMs: Math.min(600000, Math.max(120000, timeoutMs * 2)),
          retryReason: "timeout_extend_budget"
        }
      });
    }

    if (/Command exited with code/i.test(mergedFailure) && normalizedCommand) {
      if (likelyLongRunning && !args.background) {
        candidates.push({
          name: "run_command",
          arguments: {
            ...args,
            command: normalizedCommand,
            background: true,
            startupTimeoutMs: Number(args.startupTimeoutMs || args.startup_timeout_ms || 20000),
            healthCheckPort: Number(args.healthCheckPort || args.port || 0) || undefined,
            retryReason: "nonzero_exit_switch_to_background"
          }
        });
      } else {
        candidates.push({
          name: "run_command",
          arguments: {
            ...args,
            command: normalizedCommand,
            timeoutMs: Math.min(300000, Math.max(120000, Number(args.timeoutMs || args.timeout_ms || 90000) || 120000)),
            retryReason: "nonzero_exit_retry_once"
          }
        });
      }
    }
  }

  if (name === "read_file" && /ENOENT|no such file/i.test(mergedFailure)) {
    const originalPath = normalizePathLike(args.path || "");
    if (originalPath) {
      const parent = path.dirname(originalPath);
      candidates.push({ name: "list_dir", arguments: { path: parent } });
    }
  }

  if (/Missing required argument:\s*path/i.test(mergedFailure)) {
    const pathAlias =
      args.filePath ||
      args.filepath ||
      args.filename ||
      args.file ||
      args.target ||
      args.output ||
      args.destination ||
      args.dir ||
      args.directory ||
      "";
    if (String(pathAlias).trim()) {
      candidates.push({
        name: call.name,
        arguments: { ...args, path: String(pathAlias).trim() }
      });
    }
  }

  if (/Missing required argument:\s*content/i.test(mergedFailure)) {
    const contentAlias = args.text || args.body || args.value || args.contents || args.conten || args.code || args.data || "";
    if (typeof contentAlias === "string" && contentAlias.trim()) {
      candidates.push({
        name: call.name,
        arguments: { ...args, content: contentAlias }
      });
    }
  }

  if (/Missing required argument:\s*command/i.test(mergedFailure) && String(commandLike).trim()) {
    candidates.push({
      name: "run_command",
      arguments: {
        ...args,
        command: String(commandLike).trim()
      }
    });
  }

  return dedupeCalls(candidates).slice(0, MAX_FALLBACK_ATTEMPTS);
}

function buildResilienceSuggestion(call = {}, attemptResults = []) {
  const toolName = String(call?.name || "unknown");
  const latest = attemptResults[attemptResults.length - 1];
  const latestSummary = String(latest?.summary || "");

  if (/repeated_failure_signature/i.test(latestSummary)) {
    return `建议整改：${toolName} 连续出现同类失败，已触发熔断。请修正参数模板，并优先切换到后台执行/延长超时后再重试。`;
  }
  if (/Missing required argument:/i.test(latestSummary)) {
    return `建议整改：模型输出该工具时必须补全必填参数，当前 ${toolName} 调用缺参。`;
  }
  if (/Unknown tool:/i.test(latestSummary)) {
    return "建议整改：将未知工具名映射到标准工具（如 run_command/read_file/write_file），避免协议漂移。";
  }
  if (/Command exited with code/i.test(latestSummary)) {
    return `建议整改：对 ${toolName} 增加命令级语义回退（如前台失败自动切后台，或切分为更小命令）。`;
  }
  if (RETRYABLE_FAILURE_PATTERN.test(latestSummary)) {
    return "建议整改：该失败属于可重试类型，建议自动增加重试预算（超时翻倍/后台执行）并可切换模型通道。";
  }
  return `建议整改：补充 ${toolName} 的参数规范和失败回退策略，减少不可恢复失败。`;
}

function markFailureAndCheckCircuitBreaker(result = {}, seenFailureSignatures = new Map()) {
  const signature = buildFailureSignature(result);
  const count = Number(seenFailureSignatures.get(signature) || 0) + 1;
  seenFailureSignatures.set(signature, count);
  return {
    signature,
    count,
    shouldBreak: count >= MAX_REPEAT_FAILURE_SIGNATURE
  };
}

async function executeToolCallWithResilience({
  workspace,
  call,
  executeToolCall,
  executeOptions = {},
  emitStatus
}) {
  const attemptResults = [];
  const seenFailureSignatures = new Map();
  const primaryCall = {
    name: String(call?.name || ""),
    arguments: toObjectArgs(call)
  };

  const missingPrimaryArgument = getMissingRequiredToolArgument(primaryCall);
  if (missingPrimaryArgument) {
    attemptResults.push({
      ok: false,
      name: primaryCall.name,
      summary: `Missing required argument: ${missingPrimaryArgument}`,
      output: "Tool call was skipped because required parameters were incomplete.",
      stage: "precheck"
    });
  } else {
    const primaryResult = await executeToolCall(workspace, primaryCall, executeOptions);
    attemptResults.push({ ...primaryResult, stage: "execute" });
    if (primaryResult?.ok) {
      return {
        result: { ...primaryResult, recoveryAttempts: 0 },
        attemptResults,
        recovered: false
      };
    }
    markFailureAndCheckCircuitBreaker(primaryResult, seenFailureSignatures);
  }

  const initialFailure = attemptResults[attemptResults.length - 1] || {};
  const fallbackCandidates = buildFallbackCandidates(primaryCall, initialFailure);

  for (let index = 0; index < fallbackCandidates.length; index += 1) {
    const candidate = fallbackCandidates[index];
    if (typeof emitStatus === "function") {
      emitStatus({
        type: "task_status",
        status: "fallback_model",
        message: `主方案失败，正在尝试兜底方案 ${index + 1}/${fallbackCandidates.length}：${primaryCall.name} -> ${candidate.name}`
      });
    }

    const candidateResult = await executeToolCall(workspace, candidate, executeOptions);
    attemptResults.push({
      ...candidateResult,
      stage: "fallback",
      fallbackFrom: primaryCall.name,
      fallbackTo: candidate.name
    });

    if (candidateResult?.ok) {
      return {
        result: {
          ...candidateResult,
          name: primaryCall.name || candidateResult.name,
          recovered: true,
          recoveryAttempts: index + 1,
          summary: `${primaryCall.name} 主方案失败，已自动兜底为 ${candidate.name}：${candidateResult.summary || "执行成功"}`
        },
        attemptResults,
        recovered: true
      };
    }

    const breaker = markFailureAndCheckCircuitBreaker(candidateResult, seenFailureSignatures);
    if (breaker.shouldBreak) {
      const breakerMessage = `repeated_failure_signature: ${breaker.signature}`;
      attemptResults.push({
        ok: false,
        name: primaryCall.name || candidateResult.name || "unknown_tool",
        summary: breakerMessage,
        output: "Circuit breaker triggered to avoid repeating the same failed execution path.",
        stage: "circuit_breaker"
      });
      if (typeof emitStatus === "function") {
        emitStatus({
          type: "task_status",
          status: "failed",
          message: "检测到重复失败签名，已触发熔断并停止本轮重复兜底。"
        });
      }
      break;
    }
  }

  const finalFailure = attemptResults[attemptResults.length - 1] || initialFailure;
  const remediation = buildResilienceSuggestion(primaryCall, attemptResults);
  return {
    result: {
      ...finalFailure,
      name: primaryCall.name || finalFailure.name || "unknown_tool",
      ok: false,
      recoveryAttempts: Math.max(0, attemptResults.length - 1),
      summary: `${String(finalFailure.summary || "Tool failed")}\n${remediation}`,
      output: [String(finalFailure.output || ""), remediation].filter(Boolean).join("\n")
    },
    attemptResults,
    recovered: false,
    remediation
  };
}

module.exports = {
  getMissingRequiredToolArgument,
  buildFallbackCandidates,
  buildResilienceSuggestion,
  buildFailureSignature,
  executeToolCallWithResilience
};
