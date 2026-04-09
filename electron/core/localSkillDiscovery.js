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
    if (!deduped.has(summary.id)) {
      deduped.set(summary.id, {
        id: summary.id,
        name: summary.name,
        description: summary.description,
        path: summary.path,
        source: summary.source,
        enabled: !disabled.has(summary.id)
      });
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
  buildSkillAppendix
};
