const fs = require("fs");
let src = fs.readFileSync("electron/core/vgoRemoteAdapter.js", "utf8");
const si = src.indexOf("function shouldContinueAutonomously");
const ei = src.indexOf("\nfunction hasSuccessfulMutatingTool", si);
console.log("si="+si+" ei="+ei);