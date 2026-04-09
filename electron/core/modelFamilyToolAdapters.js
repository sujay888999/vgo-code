const { getModelFamily } = require("./modelAdapterRegistry");

function getToolProtocolTemplates(modelId = "") {
  switch (getModelFamily(modelId)) {
    case "minimax":
      return {
        missingToolsNudge:
          "该任务必须调用真实工具，不接受口头说明。下一条回复使用 XML 格式输出工具调用，不要写解释。",
        genericAcknowledgementNudge:
          "这不是最终答复。请停止口头承诺，立刻用合适的工具继续任务。必须使用 XML 格式调用工具，如 list_dir、read_file、write_file、run_command 等。",
        writeFollowupNudge:
          "你还没有完成用户要求的创建或写入文件操作。若任务需要落文件，请立即使用 XML 格式调用 write_file；如果确实不能写入，请明确说明原因。",
        finalAnswerNudge:
          "不要再调用工具。请基于已有工具结果，直接输出最终用户可见答复，明确说明已完成什么、未完成什么，以及下一步建议。"
      };
    case "qwen":
      return {
        missingToolsNudge:
          "不要只说，我来帮你看看。该任务必须实际调用工具。下一条回复直接输出工具调用，不要解释。",
        genericAcknowledgementNudge:
          "你还没有执行任务。请立刻通过 list_dir、read_file、write_file、run_command、search_code 中的合适工具推进任务。",
        writeFollowupNudge:
          "用户要求落文件，但你尚未写入。请立即调用 write_file，或者明确说明为什么不能写。",
        finalAnswerNudge:
          "停止继续规划，基于当前工具结果直接给出最终结果说明。"
      };
    case "openai":
    case "claude":
    case "generic":
    default:
      return {
        missingToolsNudge:
          "该任务必须使用真实工具，不接受口头说明。请下一条只输出 vgo_plan 和 vgo_tool_call，并选择合适工具开始执行。",
        genericAcknowledgementNudge:
          "这不是最终答复。请不要只做口头回应，立刻使用合适的工具继续完成任务；如需改文件或移动文件，请调用 write_file 或 run_command。",
        writeFollowupNudge:
          "你还没有完成用户要求的创建或写入文件操作。若任务需要落文件，请立即调用 write_file；如确实不能写入，请明确说明原因。",
        finalAnswerNudge:
          "不要再调用工具。请基于已有工具结果，直接输出最终用户可见答复，明确写出你完成了什么、没有完成什么，以及下一步建议。"
      };
  }
}

function getToolCallingInstructions(modelId = "") {
  const family = getModelFamily(modelId);
  
  if (family === "minimax") {
    return [
      "",
      "## Tool Calling (MiniMax XML Format)",
      "When you need to use a tool, you MUST output a tool call in XML format. Do NOT add any text before or after the tool call.",
      "",
      "### Tool Call Format:",
      "<minimax:tool_call>",
      "<invoke name=\"tool_name\">",
      "<parameter name=\"param1\">value1</parameter>",
      "<parameter name=\"param2\">value2</parameter>",
      "</invoke>",
      "</minimax:tool_call>",
      "",
      "### Available Tools:",
      "- list_dir: list files in directory (params: path, maxEntries)",
      "- read_file: read file content (params: path, maxLines)",
      "- write_file: write text to file (params: path, content)",
      "- run_command: run shell command (params: command, cwd, timeoutMs)",
      "- search_code: search text in files (params: path, query, maxResults)",
      "- copy_file: copy file (params: source, destination)",
      "- move_file: move file (params: source, destination)",
      "- make_dir: create directory (params: path)",
      "- delete_file: delete file (params: path)",
      "- delete_dir: delete directory (params: path)",
      "- fetch_web: fetch web page (params: url, format, maxChars)",
      "- transcribe_media: transcribe audio or video into text (params: path, outputDir, model, language, task, timeoutMs)",
      "- generate_word_doc: generate Word document (params: path, title, items)",
      "",
      "### Examples:",
      "Example 1 - List directory:",
      "<minimax:tool_call>",
      "<invoke name=\"list_dir\">",
      "<parameter name=\"path\">.</parameter>",
      "</invoke>",
      "</minimax:tool_call>",
      "",
      "Example 2 - Read file:",
      "<minimax:tool_call>",
      "<invoke name=\"read_file\">",
      "<parameter name=\"path\">package.json</parameter>",
      "</invoke>",
      "</minimax:tool_call>",
      "",
      "Example 3 - Write file:",
      "<minimax:tool_call>",
      "<invoke name=\"write_file\">",
      "<parameter name=\"path\">test.txt</parameter>",
      "<parameter name=\"content\">Hello World</parameter>",
      "</invoke>",
      "</minimax:tool_call>",
      "",
      "Example 4 - Run command:",
      "<minimax:tool_call>",
      "<invoke name=\"run_command\">",
      "<parameter name=\"command\">npm install</parameter>",
      "<parameter name=\"cwd\">.</parameter>",
      "</invoke>",
      "</minimax:tool_call>",
      "",
      "### Rules:",
      "1. Output ONLY the minimax:tool_call XML block. Nothing else.",
      "2. Do NOT use JSON format for tool calls.",
      "3. Do NOT use markdown code blocks (no ```).",
      "4. Do NOT explain. Just output the XML tool call.",
      "5. Use exact tool names listed above.",
      "6. Parameters must be wrapped in <parameter name=\"param_name\"> tags."
    ].join("\n");
  }
  
  return null;
}

module.exports = {
  getToolProtocolTemplates,
  getToolCallingInstructions
};
