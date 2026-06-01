/**
 * 优化执行能力测试
 * 运行: node test-optimizations.js
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

process.stdout.write("\n\x1b[36m=== VGO CODE 优化执行能力测试 ===\x1b[0m\n\n");

let passed = 0;
let failed = 0;
let errors = [];

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  \x1b[32m[PASS]\x1b[0m ${name}\n`);
    passed++;
  } catch (e) {
    process.stdout.write(`  \x1b[31m[FAIL]\x1b[0m ${name}\n`);
    failed++;
    errors.push({ name, error: e.message || e });
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    process.stdout.write(`  \x1b[32m[PASS]\x1b[0m ${name}\n`);
    passed++;
  } catch (e) {
    process.stdout.write(`  \x1b[31m[FAIL]\x1b[0m ${name}\n`);
    failed++;
    errors.push({ name, error: e.message || e });
  }
}

// ── 1. Syntax check all modified files ──────────────────────────────────────
process.stdout.write("\n\x1b[33m[1/9] 语法检查\x1b[0m\n");
const files = [
  "electron/core/agentLoop.js",
  "electron/core/ollamaAdapter.js",
  "electron/core/vgoRemoteAdapter.js",
  "electron/core/toolRuntime.js",
  "electron/core/toolResilience.js",
  "electron/core/toolAliases.js",
  "electron/ipc/chat.js",
  "electron/ipc/settings.js",
  "electron/main.js"
];
for (const f of files) {
  test(`node -c ${f}`, () => {
    const r = execSync(`node -c "${require("node:path").join(__dirname, f)}"`, { encoding: "utf8" });
    if (r) throw new Error(r);
  });
}

// ── 2. toolAliases 模块测试 ──────────────────────────────────────────────────
process.stdout.write("\n\x1b[33m[2/9] 工具别名统一测试 (toolAliases.js)\x1b[0m\n");
const { TOOL_ALIASES, normalizeToolName } = require("./electron/core/toolAliases");

test("normalizeToolName 应映射 bash → run_command", () => {
  if (normalizeToolName("bash") !== "run_command") throw new Error(`Expected run_command, got ${normalizeToolName("bash")}`);
});
test("normalizeToolName 应映射 cat → read_file", () => {
  if (normalizeToolName("cat") !== "read_file") throw new Error(`Expected read_file, got ${normalizeToolName("cat")}`);
});
test("normalizeToolName 应映射 ls → list_dir", () => {
  if (normalizeToolName("ls") !== "list_dir") throw new Error(`Expected list_dir, got ${normalizeToolName("ls")}`);
});
test("normalizeToolName 应映射 rm → delete_file", () => {
  if (normalizeToolName("rm") !== "delete_file") throw new Error(`Expected delete_file, got ${normalizeToolName("rm")}`);
});
test("normalizeToolName 应映射 rmdir → delete_dir", () => {
  if (normalizeToolName("rmdir") !== "delete_dir") throw new Error(`Expected delete_dir, got ${normalizeToolName("rmdir")}`);
});
test("normalizeToolName 应映射 dir → list_dir", () => {
  if (normalizeToolName("dir") !== "list_dir") throw new Error(`Expected list_dir, got ${normalizeToolName("dir")}`);
});
test("normalizeToolName 应映射 browse → fetch_web", () => {
  if (normalizeToolName("browse") !== "fetch_web") throw new Error(`Expected fetch_web, got ${normalizeToolName("browse")}`);
});
test("normalizeToolName 应映射 transcribe → transcribe_media", () => {
  if (normalizeToolName("transcribe") !== "transcribe_media") throw new Error(`Expected transcribe_media, got ${normalizeToolName("transcribe")}`);
});
test("normalizeToolName 应映射 powershell → run_command", () => {
  if (normalizeToolName("powershell") !== "run_command") throw new Error(`Expected run_command, got ${normalizeToolName("powershell")}`);
});
test("normalizeToolName 应映射 exec → run_command", () => {
  if (normalizeToolName("exec") !== "run_command") throw new Error(`Expected run_command, got ${normalizeToolName("exec")}`);
});
test("normalizeToolName 应映射 copy → copy_file", () => {
  if (normalizeToolName("copy") !== "copy_file") throw new Error(`Expected copy_file, got ${normalizeToolName("copy")}`);
});
test("normalizeToolName 应映射 mkdir → make_dir", () => {
  if (normalizeToolName("mkdir") !== "make_dir") throw new Error(`Expected make_dir, got ${normalizeToolName("mkdir")}`);
});
test("normalizeToolName 应原样返回未知名称", () => {
  if (normalizeToolName("unknown_tool_xyz") !== "unknown_tool_xyz") throw new Error(`Expected unknown_tool_xyz, got ${normalizeToolName("unknown_tool_xyz")}`);
});
test("TOOL_ALIASES 应有 28 个条目", () => {
  if (Object.keys(TOOL_ALIASES).length !== 28) throw new Error(`Expected 28 aliases, got ${Object.keys(TOOL_ALIASES).length}`);
});

// ── 3. toolRuntime.js spawnAsync 测试 ────────────────────────────────────────
process.stdout.write("\n\x1b[33m[3/9] spawnAsync 异步执行测试 (toolRuntime.js)\x1b[0m\n");

// spawnAsync 是 toolRuntime.js 的内部函数，无法直接导入
// 测试 toolRuntime.js 的模块加载和导出的执行器函数
const toolRuntime = require("./electron/core/toolRuntime");
test("toolRuntime 模块应正常加载", () => {
  if (typeof toolRuntime.executeToolCall !== "function") throw new Error("executeToolCall 不是函数");
});

// ── 4. toolResilience 模块测试 ──────────────────────────────────────────────
process.stdout.write("\n\x1b[33m[4/9] toolResilience 别名集成测试\x1b[0m\n");
const toolResilience = require("./electron/core/toolResilience");

// 验证 resolveToolName 是否通过 shared toolAliases 工作
// normalizeToolAliases 是内部函数，测试公开导出
test("toolResilience 模块应正常加载", () => {
  if (typeof toolResilience.executeToolCallWithResilience !== "function") throw new Error("executeToolCallWithResilience 不是函数");
});

// ── 5. agentLoop 模块测试 ───────────────────────────────────────────────────
process.stdout.write("\n\x1b[33m[5/9] agentLoop 辅助函数测试\x1b[0m\n");
const agentLoop = require("./electron/core/agentLoop");

test("agentLoop 应导出 runAgentLoop", () => {
  if (typeof agentLoop.runAgentLoop !== "function") throw new Error("runAgentLoop 不是函数");
});
test("agentLoop 应导出 shouldContinueAutonomously", () => {
  if (typeof agentLoop.shouldContinueAutonomously !== "function") throw new Error("shouldContinueAutonomously 不是函数");
});
test("shouldContinueAutonomously 应识别继续模式", () => {
  if (!agentLoop.shouldContinueAutonomously("让我进一步检查", [], "", ".")) throw new Error("应返回 true 但返回 false");
});
test("shouldContinueAutonomously 应忽略空文本", () => {
  if (agentLoop.shouldContinueAutonomously("", [], "", ".")) throw new Error("应返回 false 但返回 true");
});
test("shouldContinueAutonomously 应识别 let me check", () => {
  if (!agentLoop.shouldContinueAutonomously("let me check this file", [], "", ".")) throw new Error("应返回 true 但返回 false");
});
test("shouldContinueAutonomously 应识别英文继续模式", () => {
  if (!agentLoop.shouldContinueAutonomously("Next step I will inspect the log", [], "", ".")) throw new Error("应返回 true 但返回 false");
});
test("needsForcedFinalAnswer 应识别短响应", () => {
  const events = [{ type: "tool_result", ok: true, tool: "read_file" }];
  if (!agentLoop.needsForcedFinalAnswer("ok", events, "", ".")) throw new Error("应返回 true 但返回 false");
});
test("needsForcedFinalAnswer 应在无成功工具时返回 false", () => {
  if (agentLoop.needsForcedFinalAnswer("ok", [], "", ".")) throw new Error("应返回 false 但返回 true");
});
test("promptAllowsAutonomousContinuation 应识别中文继续关键词", () => {
  if (!agentLoop.promptAllowsAutonomousContinuation("继续执行直到完成")) throw new Error("应返回 true 但返回 false");
});
test("promptAllowsAutonomousContinuation 应识别英文 auto", () => {
  if (!agentLoop.promptAllowsAutonomousContinuation("continue autonomously")) throw new Error("应返回 true 但返回 false");
});
test("hasUnfinishedRequiredReads 应正常工作", () => {
  if (agentLoop.hasUnfinishedRequiredReads("read config.json", [{ type: "tool_result", tool: "read_file", ok: true, summary: "Read E:\\config.json lines 1-10" }], "E:\\")) throw new Error("应返回 false (已读取)");
});

// ── 6. contextCompression 模块测试 ──────────────────────────────────────────
process.stdout.write("\n\x1b[33m[6/9] 上下文容量测试 (contextCompression.js)\x1b[0m\n");
const compression = require("./electron/core/contextCompression");

test("MAX_CONTEXT_TOKENS 应为 128000", () => {
  if (compression.MAX_CONTEXT_TOKENS !== 128000) throw new Error(`Expected 128000, got ${compression.MAX_CONTEXT_TOKENS}`);
});

const ccSrc = fs.readFileSync(path.join(__dirname, "electron/core/contextCompression.js"), "utf8");
const maxSummaryChars = ccSrc.match(/MAX_SUMMARY_CHARS\s*=\s*(\d+)/);
const keepRecent = ccSrc.match(/KEEP_RECENT_MESSAGES\s*=\s*(\d+)/);
test("源代码 MAX_SUMMARY_CHARS 应为 30000", () => {
  if (!maxSummaryChars) throw new Error("未找到 MAX_SUMMARY_CHARS");
  if (parseInt(maxSummaryChars[1], 10) !== 30000) throw new Error(`值为 ${maxSummaryChars[1]}, 期望 30000`);
});
test("源代码 KEEP_RECENT_MESSAGES 应为 40", () => {
  if (!keepRecent) throw new Error("未找到 KEEP_RECENT_MESSAGES");
  if (parseInt(keepRecent[1], 10) !== 40) throw new Error(`值为 ${keepRecent[1]}, 期望 40`);
});

// ── 7. 适配器常量测试 ──────────────────────────────────────────────────────
process.stdout.write("\n\x1b[33m[7/9] 适配器容量参数测试\x1b[0m\n");

function checkConstant(filePath, name, expected) {
  test(`${name} 应等于 ${expected}`, () => {
    const content = fs.readFileSync(filePath, "utf8");
    const re = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)`);
    const m = content.match(re);
    if (!m) throw new Error(`未找到常量 ${name}`);
    const val = parseInt(m[1], 10);
    if (val !== expected) throw new Error(`${name}=${val}, 期望 ${expected}`);
  });
}

checkConstant(path.join(__dirname, "electron/core/ollamaAdapter.js"), "OLLAMA_MAX_HISTORY_MESSAGES", 60);
checkConstant(path.join(__dirname, "electron/core/ollamaAdapter.js"), "OLLAMA_MAX_TOTAL_CHARS", 500000);
checkConstant(path.join(__dirname, "electron/core/vgoRemoteAdapter.js"), "REMOTE_MAX_HISTORY_MESSAGES", 60);
checkConstant(path.join(__dirname, "electron/core/vgoRemoteAdapter.js"), "REMOTE_MAX_TOTAL_CHARS", 500000);

// ── 8. runAgentLoop 异常保护测试 ──────────────────────────────────────────
process.stdout.write("\n\x1b[33m[8/9] runAgentLoop 异常保护测试\x1b[0m\n");

testAsync("runAgentLoop 应在 buildMessages 抛异常时返回错误信息", async () => {
  const result = await agentLoop.runAgentLoop({
    sendRequest: async () => ({ text: "", toolCalls: [] }),
    prompt: "test",
    sessionId: "test-session",
    workspace: ".",
    history: [],
    settings: {},
    signal: null,
    emitEvent: () => {},
    buildMessages: () => { throw new Error("模拟构建消息失败"); },
    systemPrompt: "",
    usedModel: "test-model",
    channelId: "test-channel"
  });
  if (result.ok !== false) throw new Error(`期望 ok=false, 得到 ok=${result.ok}`);
  if (!result.error || !result.error.includes("build_messages_error")) throw new Error(`错误信息不包含 build_messages_error: ${result.error}`);
  if (!result.text.includes("构建消息失败")) throw new Error(`文本不包含预期: ${result.text}`);
});

testAsync("runAgentLoop 应在 sendRequest 抛异常时返回错误信息", async () => {
  const result = await agentLoop.runAgentLoop({
    sendRequest: async () => { throw new Error("模拟请求失败"); },
    prompt: "test",
    sessionId: "test-session",
    workspace: ".",
    history: [],
    settings: {},
    signal: null,
    emitEvent: () => {},
    buildMessages: () => [],
    systemPrompt: "",
    usedModel: "test-model",
    channelId: "test-channel"
  });
  if (result.ok !== false) throw new Error(`期望 ok=false, 得到 ok=${result.ok}`);
  if (!result.text.includes("请求失败")) throw new Error(`文本不包含 "请求失败": ${result.text}`);
});

testAsync("runAgentLoop 应在无 toolCalls 且无需继续时返回结果", async () => {
  const result = await agentLoop.runAgentLoop({
    sendRequest: async () => ({ text: "这是最终答案", toolCalls: [] }),
    prompt: "test",
    sessionId: "test-session",
    workspace: ".",
    history: [],
    settings: {},
    signal: null,
    emitEvent: () => {},
    buildMessages: () => [],
    systemPrompt: "",
    usedModel: "test-model",
    channelId: "test-channel"
  });
  if (result.ok !== true) throw new Error(`期望 ok=true, 得到 ok=${result.ok}`);
  if (!result.text.includes("最终答案")) throw new Error(`文本不包含预期: ${result.text}`);
});

// ── 9. 会话历史上限测试 ────────────────────────────────────────────────────
process.stdout.write("\n\x1b[33m[9/9] 会话历史上限测试 (state.js)\x1b[0m\n");
const stateJs = fs.readFileSync(path.join(__dirname, "electron/core/state.js"), "utf8");
const historyCap = stateJs.match(/slice\(\s*-(\d+)\s*\)/);
test("state.js 会话历史 cap 应为 slice(-200)", () => {
  if (!historyCap) throw new Error("未找到 slice cap");
  if (parseInt(historyCap[1], 10) !== 200) throw new Error(`cap=${historyCap[1]}, 期望 200`);
});

// ── 总结 ────────────────────────────────────────────────────────────────────
process.stdout.write("\n\x1b[36m═══════════════════════════════════════\x1b[0m\n");
process.stdout.write(`  \x1b[32m通过: ${passed}\x1b[0m  \x1b[31m失败: ${failed}\x1b[0m  总计: ${passed + failed}\n\n`);

if (errors.length) {
  process.stdout.write("\x1b[31m详细失败信息:\x1b[0m\n");
  for (const e of errors) {
    process.stdout.write(`  - ${e.name}: ${e.error}\n`);
  }
  process.stdout.write("\n");
  process.exit(1);
} else {
  process.stdout.write("\x1b[32m所有测试通过。\x1b[0m\n\n");
}
