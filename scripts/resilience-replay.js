"use strict";

const {
  executeToolCallWithResilience,
  buildFailureSignature
} = require("../electron/core/toolResilience");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function scenarioMissingCommandAliasRecovery() {
  const calls = [];
  const executeToolCall = async (_workspace, call) => {
    calls.push(call);
    const args = call.arguments || {};
    if (call.name === "run_command" && typeof args.command === "string" && args.command.trim()) {
      return { ok: true, name: "run_command", summary: "Command completed", output: "ok" };
    }
    return {
      ok: false,
      name: call.name,
      summary: "Missing required argument: command",
      output: ""
    };
  };

  const result = await executeToolCallWithResilience({
    workspace: "E:/VGO-CODE",
    call: { name: "run_command", arguments: { cmd: "echo ok" } },
    executeToolCall
  });

  assert(result.result.ok, "scenarioMissingCommandAliasRecovery should recover to success");
  assert(result.result.recovered === true, "scenarioMissingCommandAliasRecovery should mark recovered");
  assert(calls.length >= 1, "scenarioMissingCommandAliasRecovery should invoke tool call at least once");
}

async function scenarioReadFileEnoentFallbackListDir() {
  const calls = [];
  const executeToolCall = async (_workspace, call) => {
    calls.push(call);
    if (call.name === "read_file") {
      return {
        ok: false,
        name: "read_file",
        summary: "ENOENT: no such file or directory",
        output: ""
      };
    }
    if (call.name === "list_dir") {
      return {
        ok: true,
        name: "list_dir",
        summary: "Listed 3 entries",
        output: "src\nbackend\npackage.json"
      };
    }
    return {
      ok: false,
      name: call.name,
      summary: "Unexpected tool",
      output: ""
    };
  };

  const result = await executeToolCallWithResilience({
    workspace: "E:/VGO-CODE",
    call: { name: "read_file", arguments: { path: "E:/VGO-CODE/src/App.tsx" } },
    executeToolCall
  });

  assert(result.result.ok, "scenarioReadFileEnoentFallbackListDir should recover to success");
  assert(
    calls.some((item) => item.name === "list_dir"),
    "scenarioReadFileEnoentFallbackListDir should try list_dir fallback"
  );
}

async function scenarioRepeatedFailureCircuitBreaker() {
  let invocationCount = 0;
  const signatures = [];
  const executeToolCall = async (_workspace, call) => {
    invocationCount += 1;
    const failure = {
      ok: false,
      name: call.name,
      summary: "Command exited with code 255",
      output: "fatal"
    };
    signatures.push(buildFailureSignature(failure));
    return failure;
  };

  const result = await executeToolCallWithResilience({
    workspace: "E:/VGO-CODE",
    call: { name: "run_command", arguments: { command: "python task.py", timeoutMs: 1000 } },
    executeToolCall
  });

  assert(!result.result.ok, "scenarioRepeatedFailureCircuitBreaker should remain failed");
  assert(
    /熔断|circuit/i.test(result.result.summary + "\n" + result.result.output),
    "scenarioRepeatedFailureCircuitBreaker should include circuit-breaker hint"
  );
  assert(invocationCount <= 3, "scenarioRepeatedFailureCircuitBreaker should stop repeated attempts early");
  assert(signatures.length >= 2, "scenarioRepeatedFailureCircuitBreaker should produce repeat signatures");
}

async function run() {
  await scenarioMissingCommandAliasRecovery();
  await scenarioReadFileEnoentFallbackListDir();
  await scenarioRepeatedFailureCircuitBreaker();
  console.log("[resilience-replay] PASS");
}

run().catch((error) => {
  console.error("[resilience-replay] FAIL:", error.message);
  process.exit(1);
});
