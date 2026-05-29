function summarizeToolArguments(args = {}) {
  const parts = [];
  if (args.path) parts.push(`path=${args.path}`);
  if (args.query) parts.push(`query=${args.query}`);
  if (args.command) parts.push(`command=${args.command}`);
  if (args.cwd) parts.push(`cwd=${args.cwd}`);
  return parts.length ? parts.join(" | ") : "无参数";
}

function formatAgentEvent(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "plan") {
    const steps = Array.isArray(event.steps) ? event.steps : [];
    const lines = [];
    if (event.summary) lines.push(`执行目标：${event.summary}`);
    if (steps.length) lines.push(...steps.map((step, index) => `${index + 1}. ${step}`));
    return lines.length ? `Agent 执行计划：\n${lines.join("\n")}` : "";
  }
  if (event.type === "workflow_selected") return event.detail || `已选择 ${event.label || event.workflowId || "通用"} 工作流`;
  if (event.type === "workflow_probe") return event.detail || "已完成任务前置检查。";
  if (event.type === "capability_gap") return `能力缺口：\n${event.detail || "当前任务存在待补足能力。"}`;
  if (event.type === "skill_suggestions") {
    const skills = Array.isArray(event.skills) ? event.skills : [];
    if (!skills.length) return event.detail || "未找到可参考的本机 skill。";
    return [event.detail || "已找到可参考的本机 skill：", ...skills.map((skill) => `- ${skill.name} | ${skill.path}`)].join("\n");
  }
  if (event.type === "skill_installed") return event.ok ? `Skill 已安装并启用\n${event.detail || "已完成本机 skill 安装。"}` : `Skill 安装失败\n${event.detail || "本机 skill 安装未成功。"}`;
  if (event.type === "model_response" && Array.isArray(event.toolCalls) && event.toolCalls.length) {
    const labels = event.toolCalls.map((call) => `- ${call?.name || "unknown_tool"} | ${summarizeToolArguments(call?.arguments || {})}`);
    return `Agent 正在调用工具：\n${labels.join("\n")}`;
  }
  if (event.type === "tool_result") return event.ok ? `工具已完成：${event.tool}\n${event.summary || "执行成功"}` : `工具执行失败：${event.tool}\n${event.summary || "执行失败"}`;
  return "";
}

function collectMutatedPathsFromEvents(rawEvents = [], limit = 12) {
  const paths = [];
  for (const event of Array.isArray(rawEvents) ? rawEvents : []) {
    if (event?.type !== "tool_result" || !event?.ok) continue;
    if (!["write_file", "move_file", "rename_file", "copy_file", "delete_file", "make_dir", "delete_dir"].includes(event.tool)) continue;
    const summary = String(event.summary || "");
    const pathMatch = summary.match(/^(?:Wrote|Moved|Renamed|Copied|Deleted|Created directory)\s+(.+?)\.$/i) || summary.match(/\bpath=([^\s|]+)/i);
    if (pathMatch?.[1]) paths.push(pathMatch[1]);
  }
  return [...new Set(paths)].slice(0, Math.max(1, limit));
}

function collectConcreteToolFindingsV2(rawEvents = [], limit = 5) {
  const findings = [];
  for (const event of Array.isArray(rawEvents) ? rawEvents : []) {
    if (event?.type !== "tool_result") continue;
    const summary = String(event.summary || "").trim();
    const output = String(event.output || "").trim();
    const firstOutputLine = output.split(/\r?\n/).find((line) => String(line || "").trim()) || "";
    const base = summary || firstOutputLine;
    if (!base) continue;
    if (/^(success|ok|done|completed?)$/i.test(base)) continue;
    findings.push(`${event.ok ? "[OK]" : "[ERR]"} ${event.tool || "tool"}: ${base}`);
  }
  return [...new Set(findings)].slice(0, Math.max(1, limit));
}

function stripClosingTemplateV2(text = "") {
  let cleaned = String(text || "").trim();
  if (!cleaned) return "";
  cleaned = cleaned.replace(/【任务收尾】[\s\S]*$/i, "").trim();
  cleaned = cleaned.replace(/\b(?:下一步建议|可继续下一步|我可以继续修复)\b[\s\S]*$/i, "").trim();
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

function buildSessionClosingSummaryV2(result = {}, prompt = "") {
  const text = String(result?.text || "").trim();
  const rawEvents = Array.isArray(result?.rawEvents) ? result.rawEvents : [];
  const toolResults = rawEvents.filter((event) => event?.type === "tool_result");
  const successCount = toolResults.filter((event) => event?.ok).length;
  const failCount = toolResults.filter((event) => event?.ok === false).length;
  const mutatedPaths = collectMutatedPathsFromEvents(rawEvents, 12);
  const concreteFindings = collectConcreteToolFindingsV2(rawEvents);
  const strippedText = stripClosingTemplateV2(text);
  const conciseEvidence = [mutatedPaths.length ? `变更文件 ${mutatedPaths.length} 项` : "", successCount > 0 ? `工具成功 ${successCount} 次` : "", failCount > 0 ? `失败 ${failCount} 次` : ""].filter(Boolean).join("，");
  const changedFilesSection = mutatedPaths.length ? `\n\n已修改文件（${mutatedPaths.length}）：\n${mutatedPaths.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "";
  if (!text && concreteFindings.length) return `已完成本轮执行，关键结果：\n${concreteFindings.map((item, index) => `${index + 1}. ${item}`).join("\n")}${changedFilesSection}`;
  if (!text) return result.ok ? (conciseEvidence ? `本轮执行已完成。${conciseEvidence}。` : "本轮任务已完成。") : "本轮任务未完成。";
  const looksTemplateLike = /【任务收尾】|下一步建议|本轮任务已完成|可继续下一步/i.test(text) && strippedText.length <= 24;
  if (looksTemplateLike && concreteFindings.length) return `已完成本轮执行，关键结果：\n${concreteFindings.map((item, index) => `${index + 1}. ${item}`).join("\n")}${changedFilesSection}`;
  if (strippedText && strippedText.length > 24) return `${strippedText}${changedFilesSection}`;
  if (text.length <= 24 && concreteFindings.length) return `${text}\n\n关键结果：\n${concreteFindings.map((item, index) => `${index + 1}. ${item}`).join("\n")}${changedFilesSection}`;
  if (text.length <= 24 && conciseEvidence) return `${text}\n\n执行摘要：${conciseEvidence}。${changedFilesSection}`;
  return `${text}${changedFilesSection}`;
}

async function requestToolPermission(call = {}, notify = () => {}, ctx) {
  const permissionMode = (ctx.getSettings().permissions?.mode) || "default";
  const args = call.arguments && typeof call.arguments === "object" ? call.arguments : {};
  const detail = call.name === "skill_discovery" ? `工作流：${args.workflow || "未识别"}\n查询：${args.query || "(empty)"}\n原因：${args.reason || "需要补充执行技能能力"}` : call.name === "skill_install" ? `Skill：${args.name || "未命名"}\n来源：${args.sourcePath || "(empty)"}\n原因：${args.reason || "需要安装本机 skill 以继续完成任务"}` : call.name === "run_command" ? `命令：${args.command || "(empty)"}\n目录：${args.cwd || "."}` : `文件：${args.path || "(missing path)"}`;
  if (permissionMode === "full-access") { notify({ type: "permission_granted", tool: call.name, detail: `${detail}\n模式：完全访问。` }); return true; }
  if (ctx.getSettings().behavior?.confirmDangerousOps === false) { notify({ type: "permission_granted", tool: call.name, detail: `${detail}\n模式：已关闭危险操作确认。` }); return true; }
  const requestId = ctx.crypto.randomUUID();
  notify({ type: "permission_requested", tool: call.name, detail, requestId });
  return await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ctx.pendingPermissionRequests.delete(requestId);
      notify({ type: "permission_denied", tool: call.name, detail: `${detail}\n结果：等待确认超时，已自动拒绝。`, requestId });
      resolve(false);
    }, 300000);
    ctx.pendingPermissionRequests.set(requestId, {
      callback: (approved) => {
        clearTimeout(timeout);
        ctx.pendingPermissionRequests.delete(requestId);
        notify({ type: approved ? "permission_granted" : "permission_denied", tool: call.name, detail, requestId });
        resolve(Boolean(approved));
      },
      createdAt: Date.now()
    });
  });
}

function touchActivePromptController(sessionId, ctx) {
  const key = String(sessionId || "").trim();
  if (!key) return;
  const entry = ctx.activePromptControllers.get(key);
  if (!entry) return;
  entry.lastTouchedAt = Date.now();
}

function resolveTaskRuntimeLimitMs(ctx) {
  const configuredMinutes = Number(ctx.getSettings().agent?.maxTaskRuntimeMinutes);
  const runtimeMinutes = Number.isFinite(configuredMinutes) ? Math.max(ctx.MIN_TASK_RUNTIME_MINUTES, Math.min(ctx.MAX_TASK_RUNTIME_MINUTES, configuredMinutes)) : ctx.DEFAULT_MAX_TASK_RUNTIME_MINUTES;
  return runtimeMinutes * 60000;
}

function registerHandlers(ipcMain, ctx) {
  ipcMain.handle("chat:send", async (_event, payload) => {
    const store = ctx.store;
    let session = store.getActiveSession();
    const prompt = typeof payload === "string" ? payload : String(payload?.text || "");
    const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
    const normalizedPrompt = String(prompt || "").trim();
    if (!session) return { ok: false, exitCode: 1, sessionId: "", text: "当前没有可用线程。", error: "no_active_session", rawEvents: [] };
    if (!normalizedPrompt && attachments.length === 0) return { ok: false, exitCode: 1, sessionId: session.id, text: "empty_prompt_ignored", error: "empty_prompt_ignored", rawEvents: [] };
    const attachmentSummary = attachments.length ? `\n\n[附件]\n${attachments.map((item, index) => `${index + 1}. ${item.name} | ${item.path}`).join("\n")}` : "";
    store.renameSessionFromFirstPrompt(normalizedPrompt);
    store.appendHistory("user", `${normalizedPrompt}${attachmentSummary}`);
    const taskWorkspace = ctx.deriveTaskWorkspace(normalizedPrompt, store.getState().workspace, session.directory || "");
    store.updateSessionMeta(session.id, { directory: taskWorkspace });
    session = store.getActiveSession();
    ctx.sendAgentEvent({ sessionId: session.id, type: "task_status", status: "planning", message: "Agent 正在分析任务并规划执行步骤...", taskWorkspace });
    const compression = ctx.maybeCompressActiveSession();
    session = store.getActiveSession();
    const controller = new AbortController();
    ctx.userAbortedSessions.delete(session.id);
    const controllerEntry = { controller, createdAt: Date.now(), lastTouchedAt: Date.now(), maxRuntimeMs: resolveTaskRuntimeLimitMs(ctx), completed: false };
    ctx.activePromptControllers.set(session.id, controllerEntry);
    let result;
    try {
      result = await ctx.activeEngine().runPrompt({
        workspace: taskWorkspace,
        sessionId: session.id,
        conversationId: "",
        prompt: normalizedPrompt,
        settings: ctx.getSettings(),
        attachments,
        signal: controller.signal,
        requestToolPermission: (call) => {
          touchActivePromptController(session.id, ctx);
          return requestToolPermission(call, (event) => { touchActivePromptController(session.id, ctx); ctx.sendAgentEvent({ sessionId: session.id, ...event }); }, ctx);
        },
        onEvent: (event) => { touchActivePromptController(session.id, ctx); ctx.sendAgentEvent({ sessionId: session.id, ...event }); },
        sessionMeta: { contextSummary: session.contextSummary || "" },
        history: session.history
      });
      controllerEntry.completed = true;
    } finally { ctx.activePromptControllers.delete(session.id); }
    if (ctx.userAbortedSessions.has(session.id)) {
      ctx.userAbortedSessions.delete(session.id);
      result = { ...result, ok: false, exitCode: 130, text: "已手动停止本轮任务。", error: "aborted_by_user" };
    }
    if (!String(result.text || "").trim()) result.text = result.ok ? "本轮任务已结束，但没有生成最终文本结果。请查看上方工具步骤，并根据需要继续追问。" : "本轮任务执行失败，而且没有返回可显示的错误文本。";
    result.text = buildSessionClosingSummaryV2(result, normalizedPrompt);
    if (result.usedModel) ctx.savePreferredModelIfChanged(result.usedModel);
    store.updateSessionMeta(session.id, { actualModel: result.usedModel || ctx.getSettings().vgoAI?.preferredModel || ctx.getSettings().remote?.model || "", actualChannel: result.actualChannel || "", actualContextWindow: Number(result.actualContextWindow) || ctx.resolveModelContextWindow(ctx.getSettings(), result.usedModel || ctx.getSettings().vgoAI?.preferredModel), usageInputTokens: Number(result.usageInputTokens) || 0, usageOutputTokens: Number(result.usageOutputTokens) || 0, usageTotalTokens: Number(result.usageTotalTokens) || 0 });
    for (const event of result.rawEvents || []) {
      const message = formatAgentEvent(event);
      if (!message) continue;
      store.appendHistory("system", message, event.ok === false ? "error" : "done");
    }
    store.appendHistory("assistant", result.text, result.ok ? "done" : "error");
    ctx.sendAgentEvent({ sessionId: session.id, type: "task_status", status: result.ok ? "completed" : "failed", message: result.ok ? "Agent 已完成本轮任务。" : "Agent 本轮任务执行失败。", taskWorkspace });
    if (compression?.compressed) store.appendHistory("system", `已自动压缩上下文：${compression.estimatedBefore} -> ${compression.estimatedAfter} tokens，当前阈值 ${compression.thresholdTokens} tokens`, "done");
    return result;
  });

  ipcMain.handle("chat:abort", () => {
    const session = ctx.store.getActiveSession();
    if (!session) return { ok: false, reason: "no_active_session" };
    const entry = ctx.activePromptControllers.get(session.id);
    if (!entry || entry.completed) {
      const fallback = [...ctx.activePromptControllers.entries()].find(([, e]) => !e.completed);
      if (!fallback) return { ok: false, reason: "no_active_prompt" };
      const [fallbackSessionId, fallbackEntry] = fallback;
      ctx.userAbortedSessions.add(fallbackSessionId);
      fallbackEntry.controller.abort(new Error("aborted_by_user"));
      ctx.activePromptControllers.delete(fallbackSessionId);
      ctx.sendAgentEvent({ sessionId: fallbackSessionId, type: "task_status", status: "failed", message: "已手动停止本轮任务。" });
      return { ok: true, sessionId: fallbackSessionId };
    }
    ctx.userAbortedSessions.add(session.id);
    entry.controller.abort(new Error("aborted_by_user"));
    ctx.activePromptControllers.delete(session.id);
    ctx.sendAgentEvent({ sessionId: session.id, type: "task_status", status: "failed", message: "已手动停止本轮任务。" });
    return { ok: true };
  });

  ipcMain.handle("chat:resetSession", () => { const sessionId = ctx.store.resetActiveSession(); return { sessionId, state: ctx.serializeState() }; });
  ipcMain.handle("chat:createSession", () => ({ session: ctx.store.createAndActivateSession(ctx.getSettings().workspace || null), state: ctx.serializeState() }));
  ipcMain.handle("chat:switchSession", (_event, sessionId) => { const result = ctx.store.switchSession(sessionId); return result ? { state: result } : null; });
  ipcMain.handle("chat:renameSession", (_event, payload) => { ctx.store.renameSession(payload.sessionId, payload.title); return { state: ctx.serializeState() }; });
  ipcMain.handle("chat:togglePinSession", (_event, sessionId) => { ctx.store.togglePinSession(sessionId); return { state: ctx.serializeState() }; });
  ipcMain.handle("chat:deleteSession", (_event, sessionId) => { ctx.store.deleteSession(sessionId); ctx.sessionEventCounters?.delete(sessionId); return { state: ctx.serializeState() }; });
  ipcMain.handle("chat:updateSession", (_event, payload) => { ctx.store.updateSessionMeta(payload.sessionId, payload); return { state: ctx.serializeState() }; });
  ipcMain.handle("chat:clearHistory", () => { ctx.store.clearActiveHistory(); return { ok: true }; });

  ipcMain.handle("permissions:respond", (_event, payload = {}) => {
    const entry = ctx.pendingPermissionRequests.get(payload.requestId);
    if (!entry) return { ok: false };
    entry.callback(payload.approved === true);
    return { ok: true };
  });
}

module.exports = { registerHandlers };
