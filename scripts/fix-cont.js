const fs = require("fs");
let s = fs.readFileSync("electron/core/agentLoop.js", "utf8");
const si = s.indexOf("  const continuationPatterns = [");
const ei = s.indexOf("  if (continuationPatterns.some(", si) + "  if (continuationPatterns.some((p) => p.test(normalized))) {\n    return unfinished || promptAllowsAutonomousContinuation(prompt);\n  }".length;
const newBlock = [
  "  const continuationPatterns = [",
  "    /\u7ee7\u7eed\u601d\u8003|\u7ee7\u7eed\u5904\u7406|\u7ee7\u7eed\u6267\u884c|\u6b63\u5728\u601d\u8003|thinking|continue|keep going|next step/i,",
  "    /step\\s*\\d+\\s*\\/\\s*\\d+/i,",
  "    /\u8ba9\u6211\u8fdb\u4e00\u6b65|\u8ba9\u6211\u68c0\u67e5|\u8ba9\u6211\u67e5\u770b|\u8ba9\u6211\u5148|\u6211\u5c06\u8fdb\u4e00\u6b65|\u6211\u9700\u8981\u68c0\u67e5|\u6211\u9700\u8981\u67e5\u770b|\u6211\u5c06\u68c0\u67e5|\u6211\u5c06\u67e5\u770b/i,",
  "    /\u6211\u5148\u68c0\u67e5|\u6211\u5148\u67e5\u770b|\u6211\u5148\u8bfb\u53d6|\u6211\u5148\u5217\u51fa|\u6211\u5148\u626b\u63cf|\u6211\u6765\u68c0\u67e5|\u6211\u6765\u67e5\u770b|\u6211\u6765\u8bfb\u53d6/i,",
  "    /\u5148\u68c0\u67e5|\u5148\u67e5\u770b|\u5148\u8bfb\u53d6|\u5148\u5217\u51fa|\u5148\u626b\u63cf|\u5148\u5206\u6790/i,",
  "    /let me.*check|let me.*inspect|let me.*look|let me.*read/i,",
  "    /i will.*check|i will.*inspect|i need to.*check|next.*i will/i",
  "  ];",
  "  // If model expressed intent to act, always nudge  don't gate on prompt keywords",
  "  if (continuationPatterns.some((p) => p.test(normalized))) {",
  "    return true;",
  "  }"
].join("\n");
s = s.slice(0, si) + newBlock + s.slice(ei);
fs.writeFileSync("electron/core/agentLoop.js", s, "utf8");
console.log("done lines:" + s.split("\n").length);