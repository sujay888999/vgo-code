const BUILTIN_SKILLS = [
  {
    id: "audio-video",
    name: "Audio Video Workflow",
    category: "media",
    description: "Handle audio or video tasks with preflight checks, transcription, structured extraction, and final document generation.",
    triggers: [
      "audio",
      "video",
      "whisper",
      "transcribe",
      "subtitle",
      "speech to text",
      "音频",
      "视频",
      "语音",
      "转写",
      "字幕",
      "录音"
    ],
    preferredTools: ["transcribe_media", "read_file", "write_file", "generate_word_doc"],
    systemDirectives: [
      "For media tasks, detect the input media path first and verify it exists before continuing.",
      "Check whether local transcription capability is available before claiming the task cannot be completed.",
      "Use a staged workflow: capability preflight -> transcription -> extraction -> final output."
    ],
    executionChecklist: [
      "identify the media file and requested output",
      "check local transcription capability",
      "run the transcription step",
      "inspect the generated text",
      "produce the requested output and verify the file path"
    ],
    verificationRules: [
      "do not report success without a real transcription artifact or clear output path",
      "name the generated transcript or final file path"
    ],
    requiredInspectionPaths: []
  },
  {
    id: "self-heal",
    name: "Self-Heal",
    category: "autonomous-repair",
    description: "Inspect the current project, identify concrete faults, repair them, and verify the fixes in the same run.",
    triggers: [
      "self-heal",
      "heal",
      "repair",
      "fix this",
      "fix it",
      "auto fix",
      "self repair",
      "自愈",
      "自修复",
      "修复",
      "修一下",
      "给自己看病",
      "治病"
    ],
    preferredTools: ["list_dir", "read_file", "search_code", "write_file", "run_command"],
    systemDirectives: [
      "For self-heal tasks, follow a strict loop: inspect -> diagnose -> repair -> verify.",
      "Do not jump straight to edits before reading the relevant project files.",
      "After making fixes, run at least one verification step and report what changed.",
      "Avoid editing core Agent runtime files such as electron/core/toolRuntime.js, electron/core/vgoRemoteAdapter.js, or electron/main.js unless the user explicitly asks to repair those files or the failure is clearly isolated there."
    ],
    executionChecklist: [
      "inspect the project files relevant to the failure",
      "state the root cause clearly",
      "apply the smallest effective fix",
      "verify the repaired state",
      "report changed files and remaining risks"
    ],
    verificationRules: [
      "do not report success without a verification step",
      "list modified files explicitly"
    ],
    requiredInspectionPaths: ["package.json", "electron/main.js", "ui/renderer.js", "ui/styles.css"]
  },
  {
    id: "file-management",
    name: "File Management",
    category: "operations",
    description: "Create, inspect, move, rename, copy, delete, and verify files and folders.",
    triggers: [
      "file",
      "folder",
      "directory",
      "desktop",
      "copy",
      "move",
      "rename",
      "delete",
      "create",
      "write",
      "保存",
      "写入",
      "复制",
      "移动",
      "重命名",
      "删除",
      "文件",
      "目录",
      "桌面"
    ],
    preferredTools: [
      "list_dir",
      "read_file",
      "write_file",
      "copy_file",
      "move_file",
      "rename_file",
      "make_dir",
      "delete_file",
      "delete_dir",
      "open_path"
    ],
    systemDirectives: [
      "For file tasks, always resolve the exact target path before writing, moving, renaming, or deleting anything.",
      "After a file operation, verify the real path and report the final physical location.",
      "Do not claim success unless the filesystem result is confirmed."
    ],
    executionChecklist: [
      "identify source and target paths",
      "inspect current path state if ambiguous",
      "perform the file operation",
      "verify the resulting path exists",
      "report real changed paths"
    ],
    verificationRules: [
      "confirm destination exists after write/move/copy",
      "report actual physical path"
    ],
    requiredInspectionPaths: []
  },
  {
    id: "code-analysis",
    name: "Code Analysis",
    category: "engineering",
    description: "Inspect project structure, entry points, dependencies, risky modules, and refactor opportunities.",
    triggers: [
      "architecture",
      "analyze",
      "analysis",
      "codebase",
      "module",
      "entry",
      "dependency",
      "refactor",
      "项目",
      "架构",
      "分析",
      "代码",
      "模块",
      "依赖",
      "重构"
    ],
    preferredTools: ["list_dir", "read_file", "search_code", "run_command"],
    systemDirectives: [
      "For code analysis tasks, inspect the real repository before concluding.",
      "Prefer reading entry files, manifests, and high-signal source modules first.",
      "Summaries should focus on architecture, dependencies, risks, and refactor priorities."
    ],
    executionChecklist: [
      "find the repository root",
      "inspect manifests and entry points",
      "scan core modules",
      "identify risks and missing pieces",
      "summarize actionable conclusions"
    ],
    verificationRules: ["cite actual files inspected"],
    requiredInspectionPaths: ["package.json", "electron/main.js", "ui/renderer.js", "ui/styles.css"]
  },
  {
    id: "stability-check",
    name: "Stability Check",
    category: "diagnostics",
    description: "Detect missing config, broken workspace assumptions, failing scripts, invalid paths, or runtime inconsistencies.",
    triggers: [
      "stability",
      "health",
      "broken",
      "failure",
      "fix",
      "error",
      "diagnose",
      "检查",
      "稳定",
      "报错",
      "修复",
      "故障",
      "异常",
      "健康检查"
    ],
    preferredTools: ["list_dir", "read_file", "search_code", "run_command"],
    systemDirectives: [
      "For stability tasks, validate workspace assumptions before suggesting fixes.",
      "Differentiate between configuration issues, path issues, model issues, and execution issues.",
      "Prefer concrete repair actions over generic advice."
    ],
    executionChecklist: [
      "confirm workspace root",
      "inspect key config files",
      "check scripts or commands if needed",
      "separate root causes from symptoms",
      "propose exact fixes"
    ],
    verificationRules: ["report which check failed and why"],
    requiredInspectionPaths: ["package.json", "electron/main.js", "ui/styles.css"]
  },
  {
    id: "ui-design",
    name: "UI Design",
    category: "design",
    description: "Improve interface structure, theme consistency, visual hierarchy, and product-quality UI behavior.",
    triggers: [
      "ui",
      "ux",
      "design",
      "layout",
      "theme",
      "visual",
      "界面",
      "设计",
      "布局",
      "主题",
      "交互",
      "视觉"
    ],
    preferredTools: ["read_file", "search_code", "write_file"],
    systemDirectives: [
      "For UI tasks, improve hierarchy, consistency, spacing, and state clarity.",
      "Avoid generic theme flips; create intentional product-grade visual language.",
      "Prefer changes that improve readability, feedback, and control density."
    ],
    executionChecklist: [
      "inspect the current UI structure",
      "identify hierarchy and spacing issues",
      "update theme variables or layout styles",
      "improve state clarity and visual consistency",
      "summarize visible outcomes"
    ],
    verificationRules: ["name the UI areas changed"],
    requiredInspectionPaths: ["ui/index.html", "ui/renderer.js", "ui/styles.css"]
  }
];

function normalize(text = "") {
  return String(text || "").toLowerCase();
}

function listSkills() {
  return BUILTIN_SKILLS.map((skill) => ({
    ...skill
  }));
}

function getSkillById(id = "") {
  return BUILTIN_SKILLS.find((skill) => skill.id === id) || null;
}

function detectRelevantSkills(prompt = "") {
  const text = normalize(prompt);
  const selected = [];

  for (const skill of BUILTIN_SKILLS) {
    if (skill.triggers.some((token) => text.includes(normalize(token)))) {
      selected.push(skill);
    }
  }

  if (!selected.length) {
    if (/project|repo|workspace|目录|项目|工程/.test(text)) {
      selected.push(getSkillById("code-analysis"));
    }
  }

  const deduped = new Map();
  for (const skill of selected.filter(Boolean)) {
    deduped.set(skill.id, skill);
  }

  return [...deduped.values()];
}

function buildSkillSystemAppendix(skills = []) {
  if (!skills.length) {
    return "";
  }

  const lines = ["", "Active skill routing for this task:"];
  for (const skill of skills) {
    lines.push(`- ${skill.name}: ${skill.description}`);
    if (Array.isArray(skill.systemDirectives)) {
      for (const directive of skill.systemDirectives) {
        lines.push(`  - ${directive}`);
      }
    }
    if (Array.isArray(skill.preferredTools) && skill.preferredTools.length) {
      lines.push(`  - Preferred tools: ${skill.preferredTools.join(", ")}`);
    }
    if (Array.isArray(skill.requiredInspectionPaths) && skill.requiredInspectionPaths.length) {
      lines.push(`  - Required preflight reads: ${skill.requiredInspectionPaths.join(", ")}`);
    }
  }
  lines.push(
    "",
    "Hard rule:",
    "- Do not produce diagnosis, refactor advice, dependency advice, or deletion advice before reading the required preflight files for the active skills.",
    "- If a required file cannot be read, explicitly say which file could not be inspected and lower confidence.",
    "- Never claim a config file is missing unless you actually attempted to read it first."
  );
  return lines.join("\n");
}

function buildSkillWorkflowNudge(skills = []) {
  if (!skills.length) {
    return "";
  }

  const hasSelfHeal = skills.some((skill) => skill.id === "self-heal");
  const hasStability = skills.some((skill) => skill.id === "stability-check");
  const hasCodeAnalysis = skills.some((skill) => skill.id === "code-analysis");

  if (hasSelfHeal) {
    return [
      "Execution workflow for this repair task:",
      "1. Read the required project files first.",
      "2. Give a short execution plan.",
      "3. Identify the concrete root cause instead of generic advice.",
      "4. If a fix is requested, use tools to apply the fix.",
      "5. Run a verification step.",
      "6. Report the exact changed files and any remaining risk."
    ].join("\n");
  }

  if (hasStability || hasCodeAnalysis) {
    return [
      "Execution workflow for this analysis task:",
      "1. Inspect the required files first.",
      "2. Base conclusions only on inspected files.",
      "3. Distinguish confirmed findings from assumptions."
    ].join("\n");
  }

  return "";
}

module.exports = {
  listSkills,
  getSkillById,
  detectRelevantSkills,
  buildSkillSystemAppendix,
  buildSkillWorkflowNudge
};
