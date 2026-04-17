"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const LEGACY_TERMS = [
  "VGO Code",
  "desktop shell",
  "Codex",
  "OpenAI",
  "ChatGPT",
  "Claude",
  "Cursor",
  "Trae",
  "Windsurf"
];

function runRg(term) {
  const args = [
    "--line-number",
    "--with-filename",
    "--fixed-strings",
    "--hidden",
    "--glob",
    "!node_modules/**",
    "--glob",
    "!dist/**",
    "--glob",
    "!.git/**",
    "--glob",
    "!vendor/**",
    "--glob",
    "!docs/BRAND-AUDIT-REPORT.md",
    "--glob",
    "!scripts/brand-audit.js",
    term,
    "."
  ];

  const result = spawnSync("rg", args, { encoding: "utf8" });
  if (result.status !== 0 && !result.stdout) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function main() {
  const repoRoot = process.cwd();
  const outPath = path.join(repoRoot, "docs", "BRAND-AUDIT-REPORT.md");
  const lines = [];

  lines.push("# Brand Audit Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");

  let total = 0;
  for (const term of LEGACY_TERMS) {
    const matches = runRg(term);
    total += matches.length;
    lines.push(`## ${term}`);
    lines.push(`- Matches: ${matches.length}`);
    if (matches.length > 0) {
      lines.push("");
      for (const match of matches.slice(0, 80)) {
        lines.push(`- ${match}`);
      }
      if (matches.length > 80) {
        lines.push(`- ... truncated (${matches.length - 80} more)`);
      }
    }
    lines.push("");
  }

  lines.push("## Summary");
  lines.push(`- Total matches: ${total}`);
  lines.push("- Action: replace/remove legacy naming before next release.");
  lines.push("");

  fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`[brand-audit] wrote: ${outPath}`);
}

main();
