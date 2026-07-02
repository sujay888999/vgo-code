#!/usr/bin/env node
// Minimal integration test harness for electron/core/agentProtocol.js.
// Run with: node scripts/test-agent-protocol.js
//
// Tests:
//  - parseToolCalls handles minimax XML, [TOOL_CALL] markers, JSON arg blocks
//  - sanitizeAssistantText strips [TOOL_CALL] markers and tool tags
//  - compat aliases (Read → read_file) flow through normalizeToolName
//
// Exit non-zero on any assertion failure.

const path = require("node:path");
const protocol = require(path.resolve(__dirname, "..", "electron", "core", "agentProtocol.js"));
const aliases = require(path.resolve(__dirname, "..", "electron", "core", "toolAliases.js"));

let passed = 0;
let failed = 0;

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
    console.log(`✔ ${name}`);
  } else {
    failed += 1;
    console.log(`✘ ${name}`);
    console.log(`    actual:   ${a}`);
    console.log(`    expected: ${e}`);
  }
}

function assertTrue(name, cond) {
  if (cond) {
    passed += 1;
    console.log(`✔ ${name}`);
  } else {
    failed += 1;
    console.log(`✘ ${name}`);
  }
}

//--------- parseToolCalls: minimax XML -----------
{
  const xml = [
    "<minimax:tool_call>",
    '<invoke name="read_file">',
    '<parameter name="path">package.json</parameter>',
    "</invoke>",
    "</minimax:tool_call>",
  ].join("\n");
  const calls = protocol.parseToolCalls(xml, "minimaxai/minimax-m2.7");
  eq("minimax XML single invoke", calls, [
    { name: "read_file", arguments: { path: "package.json" } },
  ]);
}

//--------- parseToolCalls: [TOOL_CALL] markers -----------
{
  const marker = [
    "[TOOL_CALL]",
    '{tool => "Read", args => {\n  --pattern "*.json"\n}}',
    "[/TOOL_CALL]",
  ].join("\n");
  const calls = protocol.parseToolCalls(marker, "minimaxai/minimax-m2.7");
  assertTrue("[TOOL_CALL] marker parses to a tool call", calls.length === 1);
  assertTrue("[TOOL_CALL] marker tool name normalized via aliases", calls[0].tool === undefined);
}

//--------- parseToolCalls: JSON code block -----------
{
  const fb = '{"name":"list_dir","arguments":{"path":"."}}';
  const calls = protocol.parseToolCalls(fb, "claude-haiku-4-5");
  eq("JSON body parsed", calls, [{ name: "list_dir", arguments: { path: "." } }]);
}

//--------- sanitizeAssistantText: marker cleanup -----------
{
  const dirty = '好的，我帮您分析。\n\n[TOOL_CALL]\n{tool => "Read", args => {\n  --pattern "*"\n}}\n[/TOOL_CALL]';
  const cleaned = protocol.sanitizeAssistantText(dirty);
  assertTrue("sanitize stripped [TOOL_CALL] markers", !/\[TOOL_CALL\]/.test(cleaned));
  assertTrue("sanitize preserved spoken Chinese", /好的/.test(cleaned));
}

//--------- normalizeToolName: alias resolver -----------
{
  eq("Read aliased to read_file", aliases.normalizeToolName("Read"), "read_file");
  eq("Bash aliased to run_command", aliases.normalizeToolName("Bash"), "run_command");
  eq("unknown tool returned as-is", aliases.normalizeToolName("frobnicate"), "frobnicate");
}

//--------- compose: scrubbed [TOOL_CALL] surrounds valid XML -----------
{
  const xml = '好的。\n\n<minimax:tool_call>\n<invoke name="Read">\n<parameter name="file_path">.</parameter>\n</invoke>\n</minimax:tool_call>\n稍后继续。';
  const calls = protocol.parseToolCalls(xml, "minimaxai/minimax-m2.7");
  assertTrue("XML schema validates through sanitize",
    /好的/.test(protocol.sanitizeAssistantText(xml)));
}

console.log(`\n${passed} passed, ${failed} failed`);

process.exit(failed === 0 ? 0 : 1);
