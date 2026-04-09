function summarizePrompt(prompt, workspace) {
  const lines = [
    "VGO Sim Engine 已接管本次会话。",
    "",
    `工作目录: ${workspace}`,
    "",
    "这是一个本地模拟引擎，用来验证 VGO CODE 的可替换内核架构已经生效。",
    "它不会调用外部 CLI，而是返回结构化的本地分析响应。",
    "",
    "你刚刚输入的是：",
    prompt,
    "",
    "建议下一步：",
    "1. 接入真正的 VGO Remote Adapter 或 OpenAI Adapter。",
    "2. 为不同引擎补充统一的流式输出接口。",
    "3. 把引擎配置保存到用户设置页，而不是只存在当前状态中。"
  ];

  if (/目录|结构|架构|analy/i.test(prompt)) {
    lines.push("", "识别到你在做结构分析，当前 UI、状态层和引擎适配层已经分离。");
  }

  if (/重构|改造|roadmap|计划/i.test(prompt)) {
    lines.push("", "识别到你在做重构规划，建议优先实现真实远程引擎适配器。");
  }

  return lines.join("\n");
}

function runPrompt({ workspace, sessionId, prompt }) {
  return Promise.resolve({
    ok: true,
    exitCode: 0,
    sessionId,
    text: summarizePrompt(prompt, workspace),
    error: "",
    rawEvents: []
  });
}

function runHealthCheck() {
  return Promise.resolve({
    ok: true,
    title: "运行正常",
    details: "VGO Sim Engine 为本地纯模拟引擎，不依赖登录和外部 CLI。"
  });
}

function openLoginShell() {
  return;
}

module.exports = {
  engineId: "vgo-sim",
  engineLabel: "VGO Sim Engine",
  providerLabel: "Local Simulation Provider",
  runPrompt,
  runHealthCheck,
  openLoginShell
};
