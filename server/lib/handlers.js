function makeChatResponse(body, db) {
  const remoteModel = body.model || "vgo-coder-pro";
  const account = body.displayName || "本地测试模式";
  const prompt = body.prompt || "";
  const modelMeta = db.models.find((item) => item.id === remoteModel);

  const sections = [
    "VGO AI Local API 已响应。",
    "",
    `当前模式: ${account}`,
    `当前模型: ${remoteModel}`,
    `模型说明: ${modelMeta?.description || "未找到模型描述"}`,
    `工作目录: ${body.workspace || "unknown"}`,
    "",
    "收到的请求：",
    prompt
  ];

  if (Array.isArray(body.history) && body.history.length) {
    sections.push("", `历史消息数: ${body.history.length}`);
  }

  sections.push(
    "",
    "说明：",
    "1. 当前回复来自本地测试 API，不代表真实网页账户已绑定。",
    "2. 当桌面端拿到真实 accessToken 后，聊天会切换到真实 VGO 接口。",
    "3. 如果网页登录后桌面端仍未登录，说明网页还没有完成有效回调。"
  );

  return sections.join("\n");
}

module.exports = {
  makeChatResponse
};
