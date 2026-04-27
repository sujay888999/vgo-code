const fs = require("fs");
let src = fs.readFileSync("electron/core/vgoRemoteAdapter.js", "utf8");
const si = src.indexOf("function promptAllowsAutonomousContinuation");
const ei = src.indexOf("\nfunction shouldContinueAutonomously", si);
const newFn = [
"function promptAllowsAutonomousContinuation(prompt) {",
"  const n = String(prompt || \"\").trim().toLowerCase();",
"  if (!n) return false;",
"  return (/\u7ee7\u7eed|\u81ea\u52a8|\u5b8c\u6574|\u76f4\u5230\u5b8c\u6210|\u4fee\u590d\u5b8c|\u6392\u67e5\u5e76\u4fee\u590d/.test(n) ||",
"    /continue|keep going|autonom|end-to-end/.test(n) ||",
"    /\u68c0\u67e5|\u67e5\u770b|\u5206\u6790|\u626b\u63cf|\u8bca\u65ad|\u6392\u67e5|\u5e2e\u6211/.test(n) ||",
"    /\u662f\u5426|\u80fd\u5426|\u53ef\u4ee5|\u6709\u6ca1\u6709|\u662f\u4ec0\u4e48|\u600e\u4e48\u6837/.test(n) ||",
"    /check|inspect|analyz|diagnos|scan|review|audit|find|look/i.test(n));",
"}"
].join("\n");
src = src.slice(0, si) + newFn + src.slice(ei);
fs.writeFileSync("electron/core/vgoRemoteAdapter.js", src, "utf8");
console.log("done");