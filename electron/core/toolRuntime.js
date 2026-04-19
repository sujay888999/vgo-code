const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { shell } = require("electron");

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function isPathInside(parentPath, childPath) {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function getDesktopPath() {
  return path.join(os.homedir(), "Desktop");
}

const ACCESS_SCOPES = new Set(["workspace-only", "workspace-and-desktop", "full-system"]);

function normalizeAccessScope(scope = "") {
  const value = String(scope || "").trim();
  return ACCESS_SCOPES.has(value) ? value : "workspace-and-desktop";
}

function assertSafeInputPath(inputPath = "") {
  const raw = String(inputPath || "");
  if (!raw.trim()) {
    return;
  }
  if (raw.includes("\0")) {
    throw new Error("Invalid path: contains null byte");
  }
  if (/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(raw)) {
    throw new Error("Invalid path: URL-like values are not allowed");
  }
}

function resolveInputPath(workspace, inputPath = ".") {
  assertSafeInputPath(inputPath);
  const raw = String(inputPath || ".").trim();
  if (!raw || raw === ".") {
    return path.resolve(workspace);
  }

  if (/^desktop[\\/]/i.test(raw) || /^desktop$/i.test(raw)) {
    const suffix = raw.replace(/^desktop[\\/]?/i, "");
    return path.resolve(getDesktopPath(), suffix || ".");
  }

  if (path.isAbsolute(raw)) {
    return path.resolve(raw);
  }

  return path.resolve(workspace, raw);
}

function ensureWorkspacePath(workspace, inputPath = ".", options = {}) {
  const targetPath = resolveInputPath(workspace, inputPath);
  const scope = normalizeAccessScope(options.accessScope);
  const workspacePath = path.resolve(workspace);
  const desktopPath = getDesktopPath();

  if (scope === "full-system") {
    return targetPath;
  }

  const inWorkspace = isPathInside(workspacePath, targetPath);
  const onDesktop = isPathInside(desktopPath, targetPath);

  if (scope === "workspace-only") {
    if (!inWorkspace) {
      throw new Error(`Path is outside the workspace: ${targetPath}`);
    }
    return targetPath;
  }

  if (inWorkspace || onDesktop) {
    return targetPath;
  }

  throw new Error(`Path is outside the allowed scope: ${targetPath}`);
}

function formatFileEntry(fullPath, dirent) {
  const stats = fs.statSync(fullPath);
  const marker = dirent.isDirectory() ? "[DIR]" : "[FILE]";
  return `${marker} ${dirent.name} | ${stats.size} B | ${stats.mtime.toISOString()}`;
}

function getToolManifestText() {
  return [
    '- list_dir {"path":"relative/or/absolute/path","maxEntries":50} — list files in a directory',
    '- read_file {"path":"file/path","maxLines":200} — read file content',
    '- search_code {"path":".","query":"keyword","maxResults":30} — search text in code files',
    '- run_command {"command":"powershell command","cwd":"optional/path","timeoutMs":30000} — run a shell command',
    '- write_file {"path":"file/path","content":"text content"} — write text to a file',
    '- copy_file {"source":"from/path","destination":"to/path"} — copy a file',
    '- move_file {"source":"from/path","destination":"to/path"} — move or relocate a file',
    '- rename_file {"path":"from/path","newName":"new-name.ext"} — rename a file',
    '- make_dir {"path":"dir/path"} — create a directory',
    '- delete_file {"path":"file/path"} — delete a file',
    '- delete_dir {"path":"dir/path"} — delete a directory',
    '- open_path {"path":"file/or/dir/path"} — open file location in Explorer',
    '- fetch_web {"url":"https://example.com","format":"text|html|news|links","maxChars":8000} — fetch a web page. Use format="news" to auto-extract article titles and summaries from news sites. Use format="links" to extract all page links. Use format="text" for plain text content.',
    '- generate_word_doc {"path":"file.doc","title":"Title","content":"HTML content","items":[{"title":"","source":"","summary":""}]} — generate a Word-compatible .doc file with a title, table of items, or HTML content, no external dependencies needed'
  ].join("\n");
}

function readFile(workspace, args = {}, options = {}) {
  if (!args.path) {
    return { ok: false, name: "read_file", summary: "Missing required argument: path", output: "" };
  }
  const targetPath = ensureWorkspacePath(workspace, args.path, options);
  const content = fs.readFileSync(targetPath, "utf8");
  const maxLines = clamp(args.maxLines, 1, 400, 200);
  const lines = content.split(/\r?\n/);
  const selected = lines.slice(0, maxLines);
  return {
    ok: true,
    name: "read_file",
    summary: `Read ${targetPath} lines 1-${selected.length}.`,
    output: selected.join("\n")
  };
}

function writeFile(workspace, args = {}, options = {}) {
  if (!args.path) {
    return { ok: false, name: "write_file", summary: "Missing required argument: path", output: "" };
  }
  if (typeof args.content !== "string") {
    return { ok: false, name: "write_file", summary: "Missing required argument: content", output: "" };
  }

  const targetPath = ensureWorkspacePath(workspace, args.path, options);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, args.content, "utf8");

  const exists = fs.existsSync(targetPath);
  const size = exists ? fs.statSync(targetPath).size : 0;
  return {
    ok: exists,
    name: "write_file",
    summary: exists ? `Wrote ${targetPath}.` : `Failed to verify ${targetPath}.`,
    output: exists ? `exists=true\npath=${targetPath}\nsize=${size}` : `exists=false\npath=${targetPath}`
  };
}

function appendFile(workspace, args = {}, options = {}) {
  if (!args.path) {
    return { ok: false, name: "append_file", summary: "Missing required argument: path", output: "" };
  }
  if (typeof args.content !== "string") {
    return { ok: false, name: "append_file", summary: "Missing required argument: content", output: "" };
  }

  const targetPath = ensureWorkspacePath(workspace, args.path, options);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.appendFileSync(targetPath, args.content, "utf8");

  const exists = fs.existsSync(targetPath);
  const size = exists ? fs.statSync(targetPath).size : 0;
  return {
    ok: exists,
    name: "append_file",
    summary: exists ? `Appended to ${targetPath}.` : `Failed to append to ${targetPath}.`,
    output: `exists=${exists}\npath=${targetPath}\nsize=${size}`
  };
}

function listDir(workspace, args = {}, options = {}) {
  const targetPath = ensureWorkspacePath(workspace, args.path || ".", options);
  const entries = fs
    .readdirSync(targetPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, clamp(args.maxEntries, 1, 100, 50))
    .map((entry) => formatFileEntry(path.join(targetPath, entry.name), entry));

  return {
    ok: true,
    name: "list_dir",
    summary: `Listed ${entries.length} entries in ${targetPath}.`,
    output: entries.join("\n") || "(empty directory)"
  };
}

function searchCode(workspace, args = {}, options = {}) {
  const rootPath = ensureWorkspacePath(workspace, args.path || ".", options);
  const query = String(args.query || "").trim();
  if (!query) {
    return { ok: false, name: "search_code", summary: "Missing required argument: query", output: "" };
  }

  const maxResults = clamp(args.maxResults, 1, 100, 30);
  const results = [];

  function walk(dir) {
    if (results.length >= maxResults) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (results.length >= maxResults) break;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "dist"].includes(entry.name)) continue;
        walk(fullPath);
        continue;
      }
      try {
        const content = fs.readFileSync(fullPath, "utf8");
        const lines = content.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (results.length >= maxResults) return;
          if (line.toLowerCase().includes(query.toLowerCase())) {
            results.push(`${fullPath}:${index + 1}: ${line.trim()}`);
          }
        });
      } catch {
        // ignore binary or unreadable files
      }
    }
  }

  walk(rootPath);
  return {
    ok: true,
    name: "search_code",
    summary: `Found ${results.length} matches for "${query}".`,
    output: results.join("\n") || "(no matches)"
  };
}

function detectShell(command) {
  if (/^(Get-|Set-|New-|Remove-|Invoke-|Write-|Select-|Where-|ForEach-|Measure-|Sort-|Group-|Format-|ConvertTo?-|ConvertFrom?-|\$env:|\$\w+=)/i.test(command)) {
    return "powershell.exe";
  }
  return "cmd.exe";
}

function isCommandSafe(command) {
  const dangerousPatterns = [
    /;\s*rm\s+-rf/i,
    /&&\s*rm\s+/i,
    /\|\|\s*rm\s+/i,
    /`.*rm\s+-rf/i,
    /\$\(.*rm\s+/i,
    /eval\s*\(/i,
    /exec\s*\(/i,
    /subprocess.*shell\s*=\s*true/i,
    /os\.system/i,
    /os\.popen/i,
    /child_process\.exec/i,
  ];
  return !dangerousPatterns.some(pattern => pattern.test(command));
}

function runCommand(workspace, args = {}, options = {}) {
  const command = String(args.command || "").trim();
  if (!command) {
    return { ok: false, name: "run_command", summary: "Missing required argument: command", output: "" };
  }

  if (!isCommandSafe(command)) {
    return { 
      ok: false, 
      name: "run_command", 
      summary: "Command blocked: potentially dangerous pattern detected", 
      output: "" 
    };
  }

  let cwd;
  try {
    cwd = ensureWorkspacePath(workspace, args.cwd || ".", options);
  } catch (error) {
    return { ok: false, name: "run_command", summary: `Invalid cwd: ${error.message}`, output: "" };
  }

  const timeoutMs = clamp(args.timeoutMs, 1000, 300000, 45000);
  const shell = detectShell(command);
  
  let result;
  try {
    result = spawnSync(command, {
      cwd,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      shell,
      env: process.env
    });
  } catch (error) {
    return { 
      ok: false, 
      name: "run_command", 
      summary: `Command execution failed: ${error.message}`, 
      output: "" 
    };
  }

  if (result.error) {
    const isTimeout = result.error.message?.includes("timeout") || result.error.code === "ETIMEDOUT";
    return {
      ok: false,
      name: "run_command",
      summary: isTimeout ? `Command timed out after ${timeoutMs}ms.` : `Error: ${result.error.message}`,
      output: result.error.message || ""
    };
  }

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");

  const debugInfo = `exitCode=${result.status}\ncwd=${cwd}\nshell=${shell === true ? "cmd.exe" : shell}\ncommand=${command}`;

  return {
    ok: result.status === 0,
    name: "run_command",
    summary: result.status === 0 ? `Command completed in ${cwd}.` : `Command exited with code ${result.status}.`,
    output: combined || `(no output)\n${debugInfo}`
  };
}

function transcribeMedia(workspace, args = {}, options = {}) {
  if (!args.path) {
    return { ok: false, name: "transcribe_media", summary: "Missing required argument: path", output: "" };
  }

  const mediaPath = ensureWorkspacePath(workspace, args.path, options);
  if (!fs.existsSync(mediaPath)) {
    return {
      ok: false,
      name: "transcribe_media",
      summary: `Media file does not exist: ${mediaPath}`,
      output: ""
    };
  }

  const requestedOutputDir = ensureWorkspacePath(
    workspace,
    args.outputDir || path.dirname(mediaPath),
    options
  );
  const driveRoot = path.parse(requestedOutputDir).root;
  const outputDir =
    requestedOutputDir === driveRoot
      ? path.join(path.resolve(workspace), "test-results", "transcripts")
      : requestedOutputDir;
  const model = String(args.model || "tiny").trim() || "tiny";
  const language = String(args.language || "zh").trim() || "zh";
  const task = String(args.task || "transcribe").trim() || "transcribe";
  const timeoutMs = clamp(args.timeoutMs, 60_000, 3_600_000, 1_800_000);
  const baseName = path.basename(mediaPath, path.extname(mediaPath));
  const transcriptPath = path.join(outputDir, `${baseName}.txt`);

  const probe = spawnSync(
    "python",
    ["-X", "utf8", "-c", "import whisper; print('ok')"],
    {
      cwd: workspace,
      encoding: "utf8",
      timeout: 20_000,
      shell: false,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8"
      }
    }
  );

  if (probe.status !== 0) {
    return {
      ok: false,
      name: "transcribe_media",
      summary: "Whisper runtime is not available.",
      output: "Install guide:\npython -m pip install -U openai-whisper"
    };
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const script = [
    "import os, sys",
    "import whisper",
    "media_path = sys.argv[1]",
    "output_dir = sys.argv[2]",
    "model_name = sys.argv[3]",
    "language = sys.argv[4]",
    "task = sys.argv[5]",
    "model = whisper.load_model(model_name)",
    "kwargs = {'task': task, 'fp16': False, 'verbose': False}",
    "if language and language != 'auto':",
    "    kwargs['language'] = language",
    "result = model.transcribe(media_path, **kwargs)",
    "text = (result.get('text') or '').strip()",
    "base = os.path.splitext(os.path.basename(media_path))[0]",
    "target = os.path.join(output_dir, base + '.txt')",
    "with open(target, 'w', encoding='utf-8-sig') as handle:",
    "    handle.write(text)",
    "print(target)",
    "print('---TRANSCRIPT_PREVIEW---')",
    "print(text[:4000])"
  ].join("\n");

  const result = spawnSync(
    "python",
    ["-X", "utf8", "-c", script, mediaPath, outputDir, model, language, task],
    {
      cwd: workspace,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      shell: false,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8"
      }
    }
  );

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");

  if (result.error) {
    return {
      ok: false,
      name: "transcribe_media",
      summary: `Transcription failed: ${result.error.message}`,
      output: combined
    };
  }

  if (result.status !== 0 || !fs.existsSync(transcriptPath)) {
    return {
      ok: false,
      name: "transcribe_media",
      summary: `Transcription exited with code ${result.status}.`,
      output: combined
    };
  }

  const transcript = fs.readFileSync(transcriptPath, "utf8");
  return {
    ok: true,
    name: "transcribe_media",
    summary: `Transcript generated at ${transcriptPath}.`,
    output: `path=${transcriptPath}\nchars=${transcript.length}\npreview=${transcript.slice(0, 1000)}`
  };
}

function copyFile(workspace, args = {}, options = {}) {
  if (!args.source && !args.from && !args.path) {
    return { ok: false, name: "copy_file", summary: "Missing required argument: source", output: "" };
  }
  if (!args.destination && !args.to) {
    return { ok: false, name: "copy_file", summary: "Missing required argument: destination", output: "" };
  }

  const sourcePath = ensureWorkspacePath(workspace, args.source || args.from || args.path, options);
  const targetPath = ensureWorkspacePath(workspace, args.destination || args.to, options);
  if (sourcePath === targetPath) {
    return { ok: false, name: "copy_file", summary: "Source and destination are the same path.", output: "" };
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return {
    ok: true,
    name: "copy_file",
    summary: `Copied ${sourcePath} -> ${targetPath}.`,
    output: `source=${sourcePath}\ndestination=${targetPath}`
  };
}

function moveFile(workspace, args = {}, options = {}) {
  if (!args.source && !args.from && !args.path) {
    return { ok: false, name: "move_file", summary: "Missing required argument: source", output: "" };
  }
  if (!args.destination && !args.to) {
    return { ok: false, name: "move_file", summary: "Missing required argument: destination", output: "" };
  }

  const sourcePath = ensureWorkspacePath(workspace, args.source || args.from || args.path, options);
  const targetPath = ensureWorkspacePath(workspace, args.destination || args.to, options);
  if (sourcePath === targetPath) {
    return { ok: false, name: "move_file", summary: "Source and destination are the same path.", output: "" };
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.renameSync(sourcePath, targetPath);
  return {
    ok: true,
    name: "move_file",
    summary: `Moved ${sourcePath} -> ${targetPath}.`,
    output: `source=${sourcePath}\ndestination=${targetPath}`
  };
}

function renameFile(workspace, args = {}, options = {}) {
  if (!args.path && !args.source) {
    return { ok: false, name: "rename_file", summary: "Missing required argument: path", output: "" };
  }
  const newName = String(args.newName || args.name || "").trim();
  if (!newName) {
    return { ok: false, name: "rename_file", summary: "Missing required argument: newName", output: "" };
  }

  const sourcePath = ensureWorkspacePath(workspace, args.path || args.source, options);
  const targetPath = path.join(path.dirname(sourcePath), newName);
  if (sourcePath === targetPath) {
    return { ok: false, name: "rename_file", summary: "Source and destination are the same path.", output: "" };
  }

  fs.renameSync(sourcePath, targetPath);
  return {
    ok: true,
    name: "rename_file",
    summary: `Renamed ${sourcePath} -> ${targetPath}.`,
    output: `source=${sourcePath}\ndestination=${targetPath}`
  };
}

function makeDir(workspace, args = {}, options = {}) {
  if (!args.path) {
    return { ok: false, name: "make_dir", summary: "Missing required argument: path", output: "" };
  }
  const targetPath = ensureWorkspacePath(workspace, args.path, options);
  fs.mkdirSync(targetPath, { recursive: true });
  return {
    ok: true,
    name: "make_dir",
    summary: `Created directory ${targetPath}.`,
    output: targetPath
  };
}

function deleteFile(workspace, args = {}, options = {}) {
  if (!args.path) {
    return { ok: false, name: "delete_file", summary: "Missing required argument: path", output: "" };
  }
  const targetPath = ensureWorkspacePath(workspace, args.path, options);
  fs.rmSync(targetPath, { force: true });
  return {
    ok: true,
    name: "delete_file",
    summary: `Deleted file ${targetPath}.`,
    output: targetPath
  };
}

function deleteDir(workspace, args = {}, options = {}) {
  if (!args.path) {
    return { ok: false, name: "delete_dir", summary: "Missing required argument: path", output: "" };
  }
  const targetPath = ensureWorkspacePath(workspace, args.path, options);
  fs.rmSync(targetPath, { recursive: true, force: true });
  return {
    ok: true,
    name: "delete_dir",
    summary: `Deleted directory ${targetPath}.`,
    output: targetPath
  };
}

function openPathInExplorer(workspace, args = {}, options = {}) {
  if (!args.path) {
    return { ok: false, name: "open_path", summary: "Missing required argument: path", output: "" };
  }
  const targetPath = ensureWorkspacePath(workspace, args.path, options);
  shell.showItemInFolder(targetPath);
  return {
    ok: true,
    name: "open_path",
    summary: `Opened ${targetPath} in Explorer.`,
    output: targetPath
  };
}

async function fetchWeb(workspace, args = {}, options = {}) {
  const url = String(args.url || "").trim();
  if (!url) {
    return { ok: false, name: "fetch_web", summary: "Missing required argument: url", output: "" };
  }

  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, name: "fetch_web", summary: "Invalid URL: must start with http:// or https://", output: "" };
  }

  const format = ["text", "html", "markdown", "links", "news"].includes(args.format) ? args.format : "text";
  const maxChars = clamp(args.maxChars, 500, 50000, 8000);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        ok: false,
        name: "fetch_web",
        summary: `HTTP ${response.status}: ${response.statusText}`,
        output: ""
      };
    }

    const contentType = response.headers.get("content-type") || "";
    let rawText = await response.text();

    let content;
    let extractedData = "";

    if (format === "html") {
      content = rawText;
    } else if (format === "news" || format === "links") {
      content = extractStructuredData(rawText, format);
    } else if (contentType.includes("text/html")) {
      content = htmlToText(rawText);
    } else {
      content = rawText;
    }

    const truncated = content.length > maxChars
      ? content.slice(0, maxChars) + "\n\n... [truncated, total " + content.length + " chars]"
      : content;

    return {
      ok: true,
      name: "fetch_web",
      summary: `Fetched ${url} (${content.length} chars, format: ${format}).`,
      output: truncated || "(empty response)"
    };
  } catch (error) {
    const isTimeout = error.name === "AbortError" || error.code === "ABORT_ERR";
    return {
      ok: false,
      name: "fetch_web",
      summary: isTimeout ? `Request timed out after 15s.` : `Fetch error: ${error.message}`,
      output: ""
    };
  }
}

function extractStructuredData(html, mode = "news") {
  const cleanHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  if (mode === "links") {
    const links = [];
    const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(cleanHtml)) !== null && links.length < 50) {
      const href = match[1];
      const text = match[2].replace(/<[^>]+>/g, "").trim();
      if (text.length > 3 && text.length < 200 && !/^(javascript|#|mailto|tel:)/i.test(href) && !/^(privacy|terms|cookie|advert|subscribe|newsletter)/i.test(href)) {
        links.push({ text, url: href });
      }
    }
    return links.map((l, i) => `${i + 1}. ${l.text}\n   URL: ${l.url}`).join("\n\n");
  }

  if (mode === "news") {
    const articles = [];

    // Strategy 1: article/post/story/entry/card blocks with headings
    const blockPatterns = [
      /<(?:article|div|section|li)[^>]*class="[^"]*(?:post|article|story|entry|card|item|news|headline|featured)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div|section|li)>/gi,
      /<div[^>]*data-component="[^"]*(?:StoryCard|PostCard|ArticleCard|Card)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
      /<div[^>]*data-testid="[^"]*(?:story|article|post|card)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
    ];

    for (const pattern of blockPatterns) {
      pattern.lastIndex = 0;
      let blockMatch;
      while ((blockMatch = pattern.exec(cleanHtml)) !== null && articles.length < 20) {
        const block = blockMatch[1];
        const title = extractHeading(block);
        if (title && title.length > 5 && !isNoiseText(title)) {
          const summary = extractSummary(block);
          const author = extractAuthor(block);
          const time = extractTime(block);
          const link = extractLink(block);
          articles.push({ title, summary, author, time, link });
        }
      }
      if (articles.length >= 10) break;
    }

    // Strategy 2: headings inside <a> tags (common in modern news sites)
    if (articles.length < 5) {
      const headingLinkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>\s*<h[2-4][^>]*>(.*?)<\/h[2-4]>\s*<\/a>/gi;
      let hlMatch;
      while ((hlMatch = headingLinkRegex.exec(cleanHtml)) !== null && articles.length < 20) {
        const title = hlMatch[2].replace(/<[^>]+>/g, "").trim();
        const link = hlMatch[1];
        if (title.length > 5 && !isNoiseText(title) && !articles.some(a => a.title === title)) {
          articles.push({ title, summary: "", author: "", time: "", link });
        }
      }
    }

    // Strategy 3: standalone h2/h3 with nearby paragraphs
    if (articles.length < 5) {
      const sections = cleanHtml.split(/<\/?h[23][^>]*>/gi);
      for (let i = 1; i < sections.length && articles.length < 20; i += 2) {
        const titleText = sections[i].replace(/<[^>]+>/g, "").trim();
        if (titleText.length > 5 && !isNoiseText(titleText) && !articles.some(a => a.title === titleText)) {
          const contentAfter = sections[i + 1] || "";
          const summary = contentAfter.replace(/<[^>]+>/g, "").trim().slice(0, 300);
          articles.push({ title: titleText, summary, author: "", time: "", link: "" });
        }
      }
    }

    if (articles.length > 0) {
      return articles.slice(0, 15).map((a, i) => {
        let result = `### ${i + 1}. ${a.title}`;
        if (a.author) result += `\nBy ${a.author}`;
        if (a.time) result += `\n${a.time}`;
        if (a.summary) result += `\n${a.summary}`;
        if (a.link) result += `\nURL: ${a.link}`;
        return result;
      }).join("\n\n");
    }

    return extractHeadingsAndParagraphs(cleanHtml);
  }

  return htmlToText(cleanHtml);
}

function extractHeading(html) {
  const hMatch = html.match(/<h[1-4][^>]*>(.*?)<\/h[1-4]>/i);
  if (hMatch) {
    return hMatch[1].replace(/<[^>]+>/g, "").trim();
  }
  return "";
}

function extractSummary(html) {
  const patterns = [
    /<(?:p|div|span)[^>]*class="[^"]*(?:excerpt|summary|description|content|body|deck|blurb)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i,
    /<p[^>]*>([\s\S]*?)<\/p>/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const text = match[1].replace(/<[^>]+>/g, "").trim();
      if (text.length > 10 && !isNoiseText(text)) {
        return text.slice(0, 300);
      }
    }
  }
  return "";
}

function extractAuthor(html) {
  const patterns = [
    /(?:by|author)[^<]*?["']([^"']+)["']/i,
    /class="[^"]*(?:author|byline|writer)[^"]*"[^>]*>([\s\S]*?)</i,
    /rel="author"[^>]*>([\s\S]*?)</i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return match[1].replace(/<[^>]+>/g, "").trim();
    }
  }
  return "";
}

function extractTime(html) {
  const patterns = [
    /datetime="([^"]+)"/i,
    /class="[^"]*(?:time|date|published|updated)[^"]*"[^>]*>([\s\S]*?)</i,
    /(\d{4}[-/]\d{2}[-/]\d{2})/
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return match[1].replace(/<[^>]+>/g, "").trim();
    }
  }
  return "";
}

function extractLink(html) {
  const match = html.match(/<a[^>]*href=["']([^"']+)["']/i);
  if (match) {
    return match[1];
  }
  return "";
}

function isNoiseText(text) {
  const noisePatterns = [
    /^(most popular|trending|newsletter|subscribe|daily|weekly|monthly)/i,
    /^(sign up|register|log in|login|create account)/i,
    /^(advertise|privacy|terms|cookie|contact|about)/i,
    /^(share|tweet|facebook|twitter|linkedin)/i,
    /^(skip to|jump to|back to top)/i,
    /^(load more|show more|read more)/i,
    /^(menu|search|close)/i,
    /^[0-9]+$/
  ];
  return noisePatterns.some(p => p.test(text));
}

function extractHeadingsAndParagraphs(html) {
  const parts = [];
  const headingRegex = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi;
  let match;
  while ((match = headingRegex.exec(html)) !== null && parts.length < 50) {
    const text = match[1].replace(/<[^>]+>/g, "").trim();
    if (text.length > 3) {
      parts.push(`# ${text}`);
    }
  }

  const pRegex = /<p[^>]*>(.*?)<\/p>/gi;
  let pMatch;
  while ((pMatch = pRegex.exec(html)) !== null && parts.length < 100) {
    const text = pMatch[1].replace(/<[^>]+>/g, "").trim();
    if (text.length > 20) {
      parts.push(text);
    }
  }

  return parts.join("\n\n");
}

function htmlToText(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function generateWordDoc(workspace, args = {}, options = {}) {
  if (!args.path) {
    return { ok: false, name: "generate_word_doc", summary: "Missing required argument: path", output: "" };
  }

  const title = String(args.title || "Document").trim();
  const content = String(args.content || "").trim();
  const items = Array.isArray(args.items) ? args.items : [];

  if (!content && !items.length) {
    return { ok: false, name: "generate_word_doc", summary: "Missing required argument: content or items", output: "" };
  }

  const targetPath = ensureWorkspacePath(workspace, args.path, options);

  let htmlContent = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:w="urn:schemas-microsoft-com:office:word"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>
      body { font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; margin: 40px; line-height: 1.6; }
      h1 { color: #1a1a2e; border-bottom: 2px solid #16213e; padding-bottom: 8px; }
      h2 { color: #16213e; margin-top: 24px; }
      p { margin: 8px 0; }
      .source { color: #666; font-size: 0.9em; font-style: italic; }
      .item { margin-bottom: 16px; padding: 12px; background: #f8f9fa; border-left: 4px solid #16213e; }
      table { border-collapse: collapse; width: 100%; margin: 16px 0; }
      th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
      th { background: #16213e; color: white; }
    </style>
    </head><body>
    <h1>${escapeHtml(title)}</h1>
  `;

  if (items.length) {
    htmlContent += `<table><tr><th>#</th><th>Title</th><th>Source</th><th>Summary</th></tr>`;
    items.forEach((item, index) => {
      htmlContent += `<tr><td>${index + 1}</td><td>${escapeHtml(item.title || '')}</td><td class="source">${escapeHtml(item.source || '')}</td><td>${escapeHtml(item.summary || '')}</td></tr>`;
    });
    htmlContent += `</table>`;
  }

  if (content) {
    htmlContent += `<div>${content}</div>`;
  }

  htmlContent += `</body></html>`;

  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, htmlContent, "utf8");

    const exists = fs.existsSync(targetPath);
    const size = exists ? fs.statSync(targetPath).size : 0;

    return {
      ok: exists,
      name: "generate_word_doc",
      summary: exists ? `Generated Word doc at ${targetPath} (${size} B).` : `Failed to generate ${targetPath}.`,
      output: exists ? `path=${targetPath}\nsize=${size}\ntitle=${title}\nitems=${items.length}` : `path=${targetPath}`
    };
  } catch (error) {
    return {
      ok: false,
      name: "generate_word_doc",
      summary: `Error generating document: ${error.message}`,
      output: ""
    };
  }
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TOOL_MAP = {
  list_dir: listDir,
  read_file: readFile,
  search_code: searchCode,
  run_command: runCommand,
  write_file: writeFile,
  append_file: appendFile,
  copy_file: copyFile,
  move_file: moveFile,
  rename_file: renameFile,
  make_dir: makeDir,
  delete_file: deleteFile,
  delete_dir: deleteDir,
  open_path: openPathInExplorer,
  fetch_web: fetchWeb,
  generate_word_doc: generateWordDoc,
  transcribe_media: transcribeMedia
};

const TOOL_ALIASES = {
  "cli-mcp-server_run_command": "run_command",
  copy: "copy_file",
  move: "move_file",
  rename: "rename_file",
  mkdir: "make_dir",
  create_directory: "make_dir"
};

const DANGEROUS_TOOLS = new Set([
  "run_command",
  "write_file",
  "copy_file",
  "move_file",
  "rename_file",
  "make_dir",
  "delete_file",
  "delete_dir"
]);

function normalizeToolName(name = "") {
  const raw = String(name || "").trim();
  return TOOL_ALIASES[raw] || raw;
}

async function executeToolCall(workspace, call = {}, options = {}) {
  const toolName = normalizeToolName(call.name);
  const handler = TOOL_MAP[toolName];
  if (!handler) {
    return {
      ok: false,
      name: toolName || "unknown_tool",
      summary: `Unknown tool: ${call.name || toolName || "unknown"}`,
      output: ""
    };
  }

  const args =
    call.arguments && typeof call.arguments === "object"
      ? call.arguments
      : call.args && typeof call.args === "object"
        ? call.args
        : {};

  if (DANGEROUS_TOOLS.has(toolName) && typeof options.confirm === "function") {
    const approved = await options.confirm({ name: toolName, arguments: args });
    if (!approved) {
      return {
        ok: false,
        name: toolName,
        summary: "Permission denied by user.",
        output: ""
      };
    }
  }

  try {
    const result = await handler(workspace, args, options);
    return {
      ok: Boolean(result?.ok),
      name: toolName,
      summary: result?.summary || "",
      output: result?.output || ""
    };
  } catch (error) {
    return {
      ok: false,
      name: toolName,
      summary: error.message,
      output: ""
    };
  }
}

module.exports = {
  clamp,
  ensureWorkspacePath,
  formatFileEntry,
  getToolManifestText,
  listDir,
  readFile,
  writeFile,
  searchCode,
  runCommand,
  copyFile,
  moveFile,
  renameFile,
  makeDir,
  deleteFile,
  deleteDir,
  openPathInExplorer,
  openPath: openPathInExplorer,
  fetchWeb,
  generateWordDoc,
  executeToolCall
};
