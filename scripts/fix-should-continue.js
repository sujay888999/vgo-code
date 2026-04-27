const fs = require("fs");
let src = fs.readFileSync("electron/core/vgoRemoteAdapter.js", "utf8");

// Replace shouldContinueAutonomously with the more complete ollamaAdapter version
const si = src.indexOf("function shouldContinueAutonomously");
const ei = src.indexOf("\nfunction hasSuccessfulMutatingTool", si);

const newFn = `function shouldContinueAutonomously(text, rawEvents, prompt, workspace) {
  const normalized = String(text || "").trim();
  if (!normalized) { return false; }

  const hasToolResults = rawEvents.some((e) => e && e.type === "tool_result");
  const unfinishedRequiredReads = hasUnfinishedRequiredReads(prompt, rawEvents, workspace);
  const successfulWrite = rawEvents.some((e) => e && e.type === "tool_result" && e.tool === "write_file" && e.ok);
  const allReadsFailed = rawEvents.some((e) => e && e.type === "tool_result" && e.tool === "read_file" && !e.ok);

  if (successfulWrite && allReadsFailed) { return false; }

  const finalPatterns = [
    /agent\\s*\\u5df2\\u5b8c\\u6210\\u672c\\u8f6e\\u4efb\\u52a1/i,
    /\\u4efb\\u52a1\\u5b8c\\u6210/i, /\\u5904\\u7406\\u5b8c\\u6210/i,
    /\\u7ed3\\u8bba[::\\uff1a]/i, /final answer/i, /done/i, /completed/i
  ];
  if (finalPatterns.some((p) => p.test(normalized))) {
    return unfinishedRequiredReads && !allReadsFailed;
  }

  // If there are unfinished reads and reads haven't all failed, keep going
  if (unfinishedRequiredReads && !allReadsFailed) { return true; }
  if (allReadsFailed && successfulWrite) { return false; }

  const continuationPatterns = [
    /\\u7ee7\\u7eed\\u601d\\u8003/i, /\\u7ee7\\u7eed\\u5904\\u7406/i, /\\u7ee7\\u7eed\\u6267\\u884c/i,
    /\\u6b63\\u5728\\u601d\\u8003/i, /thinking/i, /continue/i, /keep going/i,
    /next step/i, /step\\s*\\d+\\s*\\/\\s*\\d+/i,
    // Intent patterns: model says "let me check X" but hasn't called the tool yet
    /\\u8ba9\\u6211\\u8fdb\\u4e00\\u6b65/i, /\\u8ba9\\u6211\\u68c0\\u67e5/i, /\\u8ba9\\u6211\\u67e5\\u770b/i,
    /\\u8ba9\\u6211\\u5148/i, /\\u6211\\u5c06\\u8fdb\\u4e00\\u6b65/i, /\\u6211\\u9700\\u8981\\u68c0\\u67e5/i,
    /\\u6211\\u9700\\u8981\\u67e5\\u770b/i, /\\u6211\\u5c06\\u68c0\\u67e5/i, /\\u6211\\u5c06\\u67e5\\u770b/i,
    /let me.*check/i, /let me.*inspect/i, /let me.*look/i, /let me.*read/i,
    /i will.*check/i, /i will.*inspect/i, /i need to.*check/i, /next.*i will/i
  ];
  if (continuationPatterns.some((p) => p.test(normalized))) {
    return unfinishedRequiredReads || promptAllowsAutonomousContinuation(prompt);
  }

  const pendingActionPatterns = [
    /\\u6b63\\u5728\\u6267\\u884c\\u5de5\\u5177/i, /\\u6b63\\u5728\\u8c03\\u7528\\u5de5\\u5177/i,
    /\\u51c6\\u5907\\u6267\\u884c/i, /\\u5373\\u5c06\\u6267\\u884c/i,
    /running tool/i, /executing/i
  ];
  if (!hasToolResults && pendingActionPatterns.some((p) => p.test(normalized))) {
    return unfinishedRequiredReads || promptAllowsAutonomousContinuation(prompt);
  }

  return false;
}`;

src = src.slice(0, si) + newFn + src.slice(ei);
fs.writeFileSync("electron/core/vgoRemoteAdapter.js", src, "utf8");
console.log("done, length=" + src.length);
