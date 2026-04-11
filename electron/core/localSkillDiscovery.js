const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function normalize(text = "") {
  return String(text || "").toLowerCase();
}

function slugify(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getSkillRoots() {
  const home = os.homedir();
  const roots = [
    { kind: "codex", root: path.join(home, ".codex", "skills") },
    { kind: "agents", root: path.join(home, ".agents", "skills") },
    { kind: "plugins", root: path.join(home, ".codex", "plugins", "cache") }
  ];

  return roots.filter((entry) => fs.existsSync(entry.root));
}

function walkForSkillFiles(rootPath, depth = 0, results = []) {
  if (!rootPath || !fs.existsSync(rootPath) || depth > 6) {
    return results;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "__pycache__"].includes(entry.name)) {
        continue;
      }
      walkForSkillFiles(fullPath, depth + 1, results);
      continue;
    }

    if (entry.isFile() && entry.name === "SKILL.md") {
      results.push(fullPath);
    }
  }

  return results;
}

function readSkillFile(skillPath) {
  try {
    return fs.readFileSync(skillPath, "utf8");
  } catch {
    return "";
  }
}

function inferSource(skillPath, roots = []) {
  const match = roots.find((entry) => skillPath.startsWith(entry.root));
  return match?.kind || "unknown";
}

function buildSkillId(skillPath, source) {
  const skillDir = path.basename(path.dirname(skillPath));
  const relative = skillPath.replace(/^[A-Za-z]:/i, "").replace(/[\\/]+/g, "/");
  return `${source}:${slugify(skillDir || relative) || slugify(relative) || "skill"}`;
}

function normalizeSkillName(name = "") {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/-\d+$/g, "")
    .replace(/\s+\d+$/g, "");
}

function buildSkillCanonicalKey(summary = {}) {
  const normalizedName = normalizeSkillName(summary.name || path.basename(path.dirname(summary.path || "")));
  return normalizedName || buildSkillId(summary.path || "", summary.source || "unknown");
}

function compareSkillPriority(left, right) {
  const sourceRank = {
    codex: 0,
    agents: 1,
    plugins: 2,
    unknown: 3
  };

  const leftRank = sourceRank[left.source] ?? sourceRank.unknown;
  const rightRank = sourceRank[right.source] ?? sourceRank.unknown;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const leftDepth = String(left.path || "").split(/[\\/]+/).length;
  const rightDepth = String(right.path || "").split(/[\\/]+/).length;
  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }

  return String(left.path || "").length - String(right.path || "").length;
}

function summarizeSkill(skillPath, roots = []) {
  const content = readSkillFile(skillPath);
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const title =
    lines.find((line) => line.startsWith("# "))?.replace(/^#\s+/, "") ||
    path.basename(path.dirname(skillPath));
  const description =
    lines.find(
      (line) =>
        !line.startsWith("#") &&
        !line.startsWith("-") &&
        !line.startsWith("```") &&
        !line.startsWith("---")
    ) || "Local skill available on this machine.";
  const source = inferSource(skillPath, roots);

  return {
    id: buildSkillId(skillPath, source),
    name: title,
    description,
    path: skillPath,
    source,
    content
  };
}

function listInstalledSkills(settings = {}) {
  const roots = getSkillRoots();
  const disabled = new Set(settings?.skills?.disabled || []);
  const skillFiles = roots.flatMap((entry) => walkForSkillFiles(entry.root));
  const deduped = new Map();

  for (const skillPath of skillFiles) {
    const summary = summarizeSkill(skillPath, roots);
    const key = buildSkillCanonicalKey(summary);
    const nextEntry = {
        id: summary.id,
        name: summary.name,
        description: summary.description,
        path: summary.path,
        source: summary.source,
        enabled: !disabled.has(summary.id)
      };

    const existing = deduped.get(key);
    if (!existing || compareSkillPriority(nextEntry, existing) < 0) {
      deduped.set(key, nextEntry);
    }
  }

  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function scoreSkill(summary, queries = []) {
  const haystack = normalize(`${summary.name}\n${summary.description}\n${summary.path}`);
  let score = 0;

  for (const query of queries) {
    const tokens = normalize(query)
      .split(/[\s/\\:_-]+/)
      .filter((token) => token.length > 2);
    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += 1;
      }
    }
  }

  return score;
}

function discoverRelevantSkills({ queries = [], maxResults = 5, settings = {} } = {}) {
  return listInstalledSkills(settings)
    .filter((skill) => skill.enabled)
    .map((skill) => ({
      ...skill,
      score: scoreSkill(skill, queries)
    }))
    .filter((skill) => skill.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults)
    .map(({ score: _score, ...skill }) => skill);
}

function discoverInstallableSkills({ queries = [], maxResults = 5 } = {}) {
  const roots = getSkillRoots();
  const skillFiles = roots.flatMap((entry) => walkForSkillFiles(entry.root));
  const deduped = new Map();
  const installedCanonicalKeys = new Set(
    listInstalledSkills()
      .filter((skill) => skill.source === "codex")
      .map((skill) => buildSkillCanonicalKey(skill))
  );

  for (const skillPath of skillFiles) {
    const summary = summarizeSkill(skillPath, roots);
    if (summary.source === "codex") {
      continue;
    }

    const canonicalKey = buildSkillCanonicalKey(summary);
    if (installedCanonicalKeys.has(canonicalKey)) {
      continue;
    }

    const candidate = {
        id: buildSkillId(summary.path, summary.source),
        name: summary.name,
        description: summary.description,
        path: summary.path,
        source: summary.source,
        score: scoreSkill(summary, queries)
      };

    const existing = deduped.get(canonicalKey);
    if (!existing || compareSkillPriority(candidate, existing) < 0) {
      deduped.set(canonicalKey, candidate);
    }
  }

  return [...deduped.values()]
    .filter((skill) => skill.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults)
    .map(({ score, ...skill }) => skill);
}

function installSkillFromSource(sourceSkillPath = "", preferredName = "") {
  const sourcePath = String(sourceSkillPath || "").trim();
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return {
      ok: false,
      error: "missing_source_skill",
      summary: "Source skill path does not exist."
    };
  }

  const skillDir = path.dirname(sourcePath);
  const codexRoot = path.join(os.homedir(), ".codex", "skills");
  const existingInstalled = listInstalledSkills()
    .filter((skill) => skill.source === "codex")
    .find((skill) => buildSkillCanonicalKey(skill) === buildSkillCanonicalKey(summarizeSkill(sourcePath, getSkillRoots())));

  if (existingInstalled) {
    return {
      ok: true,
      summary: `Skill ${existingInstalled.name} 已存在，沿用已安装版本。`,
      skill: existingInstalled
    };
  }

  const baseName = slugify(preferredName || path.basename(skillDir) || "skill") || "skill";
  let targetDir = path.join(codexRoot, baseName);
  let suffix = 2;

  while (fs.existsSync(targetDir) && path.resolve(targetDir) !== path.resolve(skillDir)) {
    targetDir = path.join(codexRoot, `${baseName}-${suffix}`);
    suffix += 1;
  }

  fs.mkdirSync(codexRoot, { recursive: true });

  if (!fs.existsSync(targetDir)) {
    fs.cpSync(skillDir, targetDir, { recursive: true });
  }

  const installedSkillPath = path.join(targetDir, "SKILL.md");
  if (!fs.existsSync(installedSkillPath)) {
    return {
      ok: false,
      error: "install_missing_skill_file",
      summary: "Installed skill is missing SKILL.md."
    };
  }

  const summary = summarizeSkill(installedSkillPath, [{ kind: "codex", root: codexRoot }]);
  return {
    ok: true,
    summary: `Installed skill ${summary.name} to ${installedSkillPath}.`,
    skill: {
      id: buildSkillId(installedSkillPath, "codex"),
      name: summary.name,
      description: summary.description,
      path: installedSkillPath,
      source: "codex",
      enabled: true
    }
  };
}

function buildSkillAppendix(skills = []) {
  if (!skills.length) {
    return "";
  }

  const lines = [
    "## Supplemental Local Skills",
    "The following enabled local skills may help you continue the task more reliably:"
  ];

  for (const skill of skills) {
    lines.push(`- ${skill.name}: ${skill.description}`);
    lines.push(`  path: ${skill.path}`);
  }

  lines.push("Use these skill references as guidance when selecting tools and recovery steps.");
  return lines.join("\n");
}

module.exports = {
  listInstalledSkills,
  discoverRelevantSkills,
  discoverInstallableSkills,
  installSkillFromSource,
  buildSkillAppendix
};
