const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { app } = require("electron");

function resolveCliEntrypoint() {
  const baseDir = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const cliPath = path.join(baseDir, "vendor", "package", "cli.js");

  if (!fs.existsSync(cliPath)) {
    throw new Error(`Bundled CLI not found: ${cliPath}`);
  }

  return cliPath;
}

function getNodeRunnerEnv() {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1"
  };
}

function parseCliOutput(sessionId, stdout, stderr, code) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let resultPayload = null;
  let assistantText = "";
  const rawEvents = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      rawEvents.push(parsed);

      if (parsed.type === "assistant" && parsed.message?.content) {
        const text = parsed.message.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n");

        if (text) {
          assistantText = text;
        }
      }

      if (parsed.type === "result") {
        resultPayload = parsed;
      }
    } catch {
      assistantText ||= line;
    }
  }

  return {
    ok: code === 0 && !resultPayload?.is_error,
    exitCode: code,
    sessionId,
    text: resultPayload?.result || assistantText || stderr || "未收到响应。",
    error: resultPayload?.error || (!code ? "" : stderr.trim()),
    rawEvents
  };
}

function runPrompt({ workspace, sessionId, prompt }) {
  const cliPath = resolveCliEntrypoint();

  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        cliPath,
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--session-id",
        sessionId,
        prompt
      ],
      {
        cwd: workspace,
        env: getNodeRunnerEnv(),
        windowsHide: true
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        sessionId,
        error: error.message,
        text: error.message,
        rawEvents: []
      });
    });

    child.on("close", (code) => {
      resolve(parseCliOutput(sessionId, stdout, stderr, code));
    });
  });
}

function runHealthCheck(workspace) {
  return runPrompt({
    workspace,
    sessionId: crypto.randomUUID(),
    prompt: "健康检查"
  }).then((result) => {
    if (result.text.includes("Not logged in")) {
      return {
        ok: false,
        title: "需要登录",
        details: "CLI 已可执行，但当前还没有完成登录。请先打开登录终端并执行 /login。"
      };
    }

    if (result.ok) {
      return {
        ok: true,
        title: "运行正常",
        details: "CLI 可执行，当前工作目录和会话链路正常。"
      };
    }

    return {
      ok: false,
      title: "运行异常",
      details: result.text || result.error || "健康检查未返回有效结果。"
    };
  });
}

function openLoginShell(workspace) {
  const cliPath = resolveCliEntrypoint();
  const command = [
    `$env:ELECTRON_RUN_AS_NODE='1'`,
    `Set-Location '${workspace.replace(/'/g, "''")}'`,
    `& '${process.execPath.replace(/'/g, "''")}' '${cliPath.replace(/'/g, "''")}'`
  ].join("; ");

  spawn(
    "powershell.exe",
    ["-NoExit", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      detached: true,
      stdio: "ignore"
    }
  ).unref();
}

module.exports = {
  engineId: "bundled-cli",
  engineLabel: "Bundled CLI Compatibility Layer",
  providerLabel: "Claude Code 2.1.88 Package",
  runPrompt,
  runHealthCheck,
  openLoginShell
};
