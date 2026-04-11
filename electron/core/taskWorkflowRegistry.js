const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const MEDIA_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
  ".mp4",
  ".mov",
  ".mkv",
  ".avi",
  ".webm"
];

function normalize(text = "") {
  return String(text || "").trim().toLowerCase();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function detectWorkflow(prompt = "") {
  const text = normalize(prompt);

  if (/\b(mp3|wav|m4a|flac|ogg|mp4|mov|mkv|avi|webm|audio|video|transcrib|subtitle|whisper|语音|音频|视频|转写|字幕|录音)\b/i.test(text)) {
    return {
      id: "audio-video",
      label: "音视频处理",
      steps: [
        "识别输入媒体文件与目标产物",
        "检查本机转写能力与依赖",
        "执行转写并输出文本",
        "整理结果并生成最终文件"
      ],
      capabilityHints: ["ffmpeg", "whisper", "python-whisper"],
      skillQueries: ["audio video transcription", "whisper", "media processing", "speech to text"]
    };
  }

  if (/\b(news|web|url|http|https|crawl|scrap|网页|链接|抓取|新闻)\b/i.test(text)) {
    return {
      id: "web-research",
      label: "网页采集",
      steps: [
        "检查目标网页与提取范围",
        "抓取页面内容",
        "提取结构化信息",
        "生成最终结果"
      ],
      capabilityHints: ["fetch_web"],
      skillQueries: ["web search", "browser automation", "search"]
    };
  }

  if (/\b(file|folder|directory|copy|move|rename|delete|desktop|文件|目录|复制|移动|重命名|删除|桌面)\b/i.test(text)) {
    return {
      id: "file-ops",
      label: "文件操作",
      steps: [
        "确认源路径与目标路径",
        "检查当前文件状态",
        "执行文件操作",
        "校验最终结果"
      ],
      capabilityHints: ["filesystem"],
      skillQueries: ["file management"]
    };
  }

  if (/\b(error|bug|fix|test|build|compile|refactor|代码|修复|测试|构建|重构|报错)\b/i.test(text)) {
    return {
      id: "code-fix",
      label: "代码修复",
      steps: [
        "读取相关代码与上下文",
        "定位根因",
        "实施修复",
        "运行验证"
      ],
      capabilityHints: ["read_file", "write_file", "run_command"],
      skillQueries: ["fullstack web developer", "code analysis", "self-heal"]
    };
  }

  return {
    id: "general",
    label: "通用任务",
    steps: [
      "理解任务目标",
      "选择合适工具",
      "执行并校验结果"
    ],
    capabilityHints: [],
    skillQueries: ["search", "code analysis"]
  };
}

function extractWindowsPaths(prompt = "") {
  const matches = String(prompt || "").match(/[A-Za-z]:\\[^\r\n"'<>|]+/g) || [];
  return unique(matches.map((item) => item.trim()));
}

function findMediaPath(prompt = "", workspace = "") {
  const candidates = extractWindowsPaths(prompt);
  const mediaCandidate = candidates.find((candidate) =>
    MEDIA_EXTENSIONS.includes(path.extname(candidate).toLowerCase())
  );

  if (mediaCandidate) {
    return path.resolve(mediaCandidate);
  }

  const relativeMatch = String(prompt || "").match(/([^\s"']+\.(?:mp3|wav|m4a|aac|flac|ogg|mp4|mov|mkv|avi|webm))/i);
  if (!relativeMatch) {
    return "";
  }

  const raw = relativeMatch[1];
  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }

  return workspace ? path.resolve(workspace, raw) : raw;
}

function commandExists(command) {
  const shell = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(shell, [command], {
    encoding: "utf8",
    shell: false,
    timeout: 8000
  });
  return result.status === 0;
}

function runProbe(command, args = [], extraEnv = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    timeout: 12000,
    env: {
      ...process.env,
      ...extraEnv
    }
  });
  return {
    ok: result.status === 0,
    output: [String(result.stdout || "").trim(), String(result.stderr || "").trim()]
      .filter(Boolean)
      .join("\n")
  };
}

function probeAudioVideoWorkflow(prompt = "", workspace = "") {
  const mediaPath = findMediaPath(prompt, workspace);
  const mediaExists = mediaPath ? fs.existsSync(mediaPath) : false;
  const mediaDir = mediaExists ? path.dirname(mediaPath) : workspace;
  const recommendedOutputDir =
    mediaDir && path.parse(mediaDir).root === path.resolve(mediaDir)
      ? path.join(path.resolve(workspace || mediaDir), "test-results", "transcripts")
      : mediaDir;

  const hasFfmpeg = commandExists("ffmpeg");
  const hasWhisperCli = commandExists("whisper");
  const pythonWhisper = runProbe(
    "python",
    ["-X", "utf8", "-c", "import whisper; print('ok')"],
    {
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8"
    }
  );
  const hasPythonWhisper = pythonWhisper.ok;

  const blockingIssues = [];
  if (!mediaPath) {
    blockingIssues.push("没有从任务中识别到明确的音视频文件路径。");
  } else if (!mediaExists) {
    blockingIssues.push(`媒体文件不存在或不可访问：${mediaPath}`);
  }

  if (!hasWhisperCli && !hasPythonWhisper) {
    blockingIssues.push("本机未发现可用的 Whisper 转写能力。");
  }

  const recommendedAsrCommand = mediaExists
    ? hasPythonWhisper
      ? `transcribe_media path="${mediaPath}" outputDir="${recommendedOutputDir}" model="tiny" language="zh"`
      : hasWhisperCli
        ? `whisper "${mediaPath}" --model base --language zh --task transcribe --output_format txt --output_dir "${recommendedOutputDir}"`
        : ""
    : "";

  return {
    mediaPath,
    mediaExists,
    mediaDir,
    recommendedOutputDir,
    hasFfmpeg,
    hasWhisperCli,
    hasPythonWhisper,
    blockingIssues,
    recommendedAsrCommand
  };
}

function buildWorkflowSystemAppendix(workflow, probe = null) {
  if (!workflow) {
    return "";
  }

  const lines = [
    "## Task Workflow",
    `Current workflow: ${workflow.label} (${workflow.id})`,
    "Follow the workflow strictly and do not skip capability checks when the task depends on local runtime tools."
  ];

  if (workflow.id === "audio-video") {
    lines.push(
      "For audio/video tasks, do not claim inability before checking the local environment and trying the recommended transcription backend.",
      "Always verify the media path first.",
      "Prefer the transcribe_media tool before falling back to ad-hoc shell commands.",
      "Prefer a real transcription run before summarizing or generating a document."
    );

    if (probe?.recommendedAsrCommand) {
      lines.push(`Preferred ASR command: ${probe.recommendedAsrCommand}`);
    }

    if (probe?.mediaPath) {
      lines.push(`Resolved media path: ${probe.mediaPath}`);
    }
  }

  return lines.join("\n");
}

function buildCapabilityGapSummary(workflow, probe = null) {
  if (!workflow) {
    return "";
  }

  if (workflow.id === "audio-video" && probe) {
    const parts = [];
    if (probe.blockingIssues.length) {
      parts.push(`阻塞项：${probe.blockingIssues.join("；")}`);
    }
    parts.push(`ffmpeg：${probe.hasFfmpeg ? "可用" : "缺失"}`);
    parts.push(`whisper CLI：${probe.hasWhisperCli ? "可用" : "缺失"}`);
    parts.push(`python whisper：${probe.hasPythonWhisper ? "可用" : "缺失"}`);
    return parts.join("\n");
  }

  return `当前任务需要的能力：${(workflow.capabilityHints || []).join("、") || "通用工具"}`;
}

module.exports = {
  detectWorkflow,
  findMediaPath,
  probeAudioVideoWorkflow,
  buildWorkflowSystemAppendix,
  buildCapabilityGapSummary
};
