"use strict";

const fs = require("node:fs");
const path = require("node:path");

function nowISO() {
  return new Date().toISOString();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildPlan(pkg) {
  const version = pkg.version || "1.0.0";
  const nextVersion = "1.1.0";
  const lines = [
    "# VGO CODE Next Version Plan",
    "",
    `Generated: ${nowISO()}`,
    `Current Version: ${version}`,
    `Target Version: ${nextVersion}`,
    "",
    "## Release Objective",
    "- Productize desktop agent experience for external users.",
    "- Remove legacy/old-brand traces and unify VGO naming.",
    "- Improve feature completeness and release confidence.",
    "",
    "## Milestones",
    "1. Brand cleanup",
    "- Audit and replace legacy naming in UI, docs, and metadata.",
    "- Standardize app title/icon/update channel naming.",
    "2. Product hardening",
    "- Add first-run onboarding and health-check guidance.",
    "- Add error boundaries and actionable failure messages.",
    "3. Feature completion",
    "- Session management polish and data persistence checks.",
    "- Engine adapter fallback and timeout controls.",
    "4. Release quality",
    "- Expand smoke tests and packaging verification.",
    "- Build release checklist for go/no-go decisions.",
    "",
    "## Definition of Done",
    "- No P0/P1 known issues in release checklist.",
    "- Brand audit report has zero critical legacy terms.",
    "- `npm run verify:release` passes on CI/local.",
    "- Installer package generated and launch smoke test passed."
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const repoRoot = process.cwd();
  const pkgPath = path.join(repoRoot, "package.json");
  const outPath = path.join(repoRoot, "docs", "NEXT-VERSION-PLAN.md");

  const pkg = readJson(pkgPath);
  const content = buildPlan(pkg);
  fs.writeFileSync(outPath, content, "utf8");

  console.log(`[auto-plan] wrote: ${outPath}`);
}

main();
