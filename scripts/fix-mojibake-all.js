/**
 * Scan all JS/TS files in electron/ and src/ for mojibake strings
 * and replace them with correct UTF-8 Chinese.
 *
 * Mojibake pattern: UTF-8 Chinese encoded as Latin-1 then re-read as UTF-8
 * e.g. "鏈湴" = "本地" mangled
 */
const fs = require("fs");
const path = require("path");

// Known mojibake → correct mappings found in this codebase
const REPLACEMENTS = [
  // vgoRemoteAdapter health check
  ["鏈湴娴嬭瘯寮曟搸鍦ㄧ嚎", "本地测试引擎在线"],
  ["鏈湴娴嬭瘯寮曟搸寮傚父", "本地测试引擎异常"],
  ["宸叉垚鍔熻繛鎺ュ埌", "已成功连接到"],
  // ollamaAdapter error message
  ["Ollama 閺夆晝鍋炵敮瀛樺緞鏉堫偉袝", "Ollama 请求异常"],
  // main.js profile name
  ["杩滅▼閰嶇疆", "远程配置"],
  // vgoRemoteAdapter rate limit detection
  ["浣欓涓嶈冻", "余额不足"],
  ["鏃犲彲鐢ㄨ祫婧愬寘", "无可用资源包"],
  // settings.js mojibake pattern
  ["锛鏃鍏璐鐧诲綍鏈", ""],
  // buildSafeSystemPrompt fallback
  ["?? VGO CODE ??????? Agent?", "VGO CODE 桌面 Agent"],
  ["????????????????????????????", "你是一个专业的桌面 AI 助手。"],
  ["???????????????????????????????", "请根据用户的指令执行任务，优先使用工具完成目标。"],
  ["??????????????????????????????", "每次工具调用后，根据结果决定下一步行动。"],
  ["?????????????", "技能附录："],
  ["?????????????", "系统提示构建失败："],
];

const SCAN_DIRS = ["electron", "src/components", "src/store", "src/styles"];
const EXTENSIONS = [".js", ".ts", ".tsx"];

let totalFixed = 0;
let filesFixed = 0;

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      scanDir(full);
    } else if (EXTENSIONS.includes(path.extname(entry.name))) {
      fixFile(full);
    }
  }
}

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, "utf8");
  let changed = false;
  for (const [bad, good] of REPLACEMENTS) {
    if (content.includes(bad)) {
      content = content.split(bad).join(good);
      changed = true;
      totalFixed++;
      console.log(`  fixed: "${bad}" → "${good}" in ${filePath}`);
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content, "utf8");
    filesFixed++;
  }
}

for (const dir of SCAN_DIRS) {
  scanDir(dir);
}

console.log(`\nDone: fixed ${totalFixed} occurrences in ${filesFixed} files`);
