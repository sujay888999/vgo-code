const fs = require("fs");const { runAgentLoop } = require("../electron/core/agentLoop");
const src = fs.readFileSync("electron/core/vgoRemoteAdapter.js", "utf8");
const si = src.indexOf("async function runLocalPrompt(");
const ei = src.indexOf("\nasync function runPrompt(");
