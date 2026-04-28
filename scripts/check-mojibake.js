#!/usr/bin/env node
/**
 * Pre-commit check: detect mojibake (garbled Chinese) in staged JS/TS files.
 * Run: node scripts/check-mojibake.js
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Mojibake pattern: sequences of characters that look like UTF-8 Chinese
// decoded as Latin-1 (common Windows encoding accident)
const MOJIBAKE_PATTERN = /[\u954f\u6e56\u5a1c\u6d4b\u8bd5\u5f15\u64ce\u5728\u7ebf\u5f02\u5e38\u672c\u5730\u6d4b\u8bd5\u5f15\u64ce\u5f02\u5e38\u672c\u5730\u6d4b\u8bd5\u5f15\u64ce\u5728\u7ebf]|[\u954f\u6e56]|[\u9e3f\u6e56]|[\u9e3f\u6e56\u5a1c]|\u9e3f|\u954f\u6e56\u5a1c\u6d4b\u8bd5/;

// Simpler: detect sequences of chars in the "CJK Compatibility" or "Halfwidth" ranges
// that shouldn't appear in source code strings
const SUSPICIOUS = /[\uff00-\uffef]{2,}|[\u2e80-\u2eff]{2,}/;

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const issues = [];
  lines.forEach((line, i) => {
    if (SUSPICIOUS.test(line)) {
      issues.push({ line: i + 1, text: line.trim().slice(0, 80) });
    }
  });
  return issues;
}

// Get staged files
let stagedFiles = [];
try {
  const output = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" });
  stagedFiles = output.trim().split("\n").filter(f => /\.(js|ts|tsx)$/.test(f) && fs.existsSync(f));
} catch {
  // Not in a git repo or no staged files
  process.exit(0);
}

let hasIssues = false;
for (const file of stagedFiles) {
  const issues = checkFile(file);
  if (issues.length) {
    hasIssues = true;
    console.error(`\nMojibake detected in ${file}:`);
    issues.forEach(({ line, text }) => console.error(`  Line ${line}: ${text}`));
  }
}

if (hasIssues) {
  console.error("\nCommit blocked: fix mojibake before committing.");
  console.error("Run: node scripts/fix-mojibake-all.js");
  process.exit(1);
}

console.log("No mojibake detected.");
process.exit(0);
