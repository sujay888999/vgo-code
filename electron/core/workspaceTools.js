const fs = require("node:fs");
const path = require("node:path");

function walkDirectoryTree(rootDir, maxDepth = 3, maxItemsPerDir = 25) {
  function walk(dir, depth) {
    if (depth > maxDepth) {
      return ["  ".repeat(depth) + "..."];
    }

    let entries;
    try {
      entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => !["node_modules", ".git", "dist", "release"].includes(entry.name))
        .slice(0, maxItemsPerDir);
    } catch {
      return ["  ".repeat(depth) + "[无法读取]"];
    }

    const lines = [];
    for (const entry of entries) {
      const prefix = "  ".repeat(depth);
      if (entry.isDirectory()) {
        lines.push(`${prefix}${entry.name}/`);
        lines.push(...walk(path.join(dir, entry.name), depth + 1));
      } else {
        lines.push(`${prefix}${entry.name}`);
      }
    }
    return lines;
  }

  return [path.basename(rootDir) + "/", ...walk(rootDir, 1)].join("\n");
}

function analyzeWorkspace(workspace) {
  const tree = walkDirectoryTree(workspace);
  const files = fs.readdirSync(workspace, { withFileTypes: true });

  const archives = files
    .filter((item) => item.isFile() && /\.(zip|tgz|gz|map|pdf)$/i.test(item.name))
    .map((item) => item.name);
  const dirs = files.filter((item) => item.isDirectory()).map((item) => item.name);

  return {
    summary: [
      `工作目录: ${workspace}`,
      "",
      `一级目录: ${dirs.length ? dirs.join("、") : "无"}`,
      `关键资料文件: ${archives.length ? archives.join("、") : "无"}`,
      "",
      "目录树预览:",
      tree
    ].join("\n")
  };
}

module.exports = {
  analyzeWorkspace
};
