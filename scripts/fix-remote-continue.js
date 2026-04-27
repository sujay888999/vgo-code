const fs = require('fs')
const src = fs.readFileSync('electron/core/vgoRemoteAdapter.js', 'utf8')

// Find and replace promptAllowsAutonomousContinuation
const OLD_PROMPT = `function promptAllowsAutonomousContinuation(prompt = "") {
  const normalized = String(prompt || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const autonomyPatterns = [
    /继续/,
    /自动/,
    /自行/,
    /完整落地/,
    /完整方案/,
    /直到完成/,
    /修复完/,
    /排查并修复/,
    /鎸佺画鎵ц/,
    /continue/,
    /keep going/,
    /autonom/i,
    /end[- ]to[- ]end/
  ];
  return autonomyPatterns.some((pattern) => pattern.test(normalized));
}`

const NEW_PROMPT = `function promptAllowsAutonomousContinuation(prompt = "") {
  const normalized = String(prompt || "").trim().toLowerCase();
  if (!normalized) { return false; }
  const autonomyPatterns = [
    /继续/, /自动/, /自行/, /完整落地/, /完整方案/, /直到完成/, /修复完/,
    /排查并修复/, /continue/, /keep going/, /autonom/i, /end[- ]to[- ]end/,
    // Exploration tasks  always allow autonomous continuation
    /检查/, /查看/, /分析/, /扫描/, /诊断/, /排查/, /帮我看/, /帮我检/,
    /是否.*正常/, /能否.*使用/, /可以.*使用/, /有没有/, /是什么/, /怎么样/,
    /check/i, /inspect/i, /analyz/i, /diagnos/i, /scan/i, /review/i, /audit/i,
    /what.*is/i, /how.*is/i, /show.*me/i, /tell.*me/i, /find/i, /look/i
  ];
  return autonomyPatterns.some((pattern) => pattern.test(normalized));
}`

if (!src.includes(OLD_PROMPT)) { console.error('OLD_PROMPT not found'); process.exit(1) }
const out = src.replace(OLD_PROMPT, NEW_PROMPT)
fs.writeFileSync('electron/core/vgoRemoteAdapter.js', out, 'utf8')
console.log('promptAllowsAutonomousContinuation updated')
