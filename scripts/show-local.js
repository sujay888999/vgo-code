const fs = require("fs");
const src = fs.readFileSync("electron/core/vgoRemoteAdapter.js", "utf8");
const si = src.indexOf("async function runLocalPrompt(");
const ei = src.indexOf("\nasync function runPrompt(");
// Show first 300 chars of the function to understand its signature
process.stdout.write(src.slice(si, si+300) + "\n---\n");