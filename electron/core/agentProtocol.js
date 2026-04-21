const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const SLASH = String.fromCharCode(47);
const MAX_TOOL_SUMMARY_CHARS = 500;
const MAX_TOOL_OUTPUT_CHARS = 1800;
const MAX_TOOL_RESULT_MESSAGE_CHARS = 12000;

function truncateForTransport(text = "", maxChars = 0) {
  const source = String(text || "");
  if (!maxChars || source.length <= maxChars) {
    return source;
  }
  return `${source.slice(0, Math.max(0, maxChars - 80))}\n...[truncated ${source.length - maxChars} chars]`;
}

function looksLikeMojibake(text = "") {
  const sample = String(text || "");
  if (!sample) return false;
  const weirdMatches = sample.match(/[浣鎴璇鏂囦欢宸插弬鏈椂鍒闂垜]/g) || [];
  return weirdMatches.length >= 3;
}

function tryRecoverMojibake(text = "") {
  const source = String(text || "");
  if (!source || !looksLikeMojibake(source)) {
    return source;
  }

  try {
    const recovered = Buffer.from(source, "latin1").toString("utf8");
    if (recovered && !looksLikeMojibake(recovered)) {
      return recovered;
    }
  } catch {}

  return source;
}

function sanitizeAssistantText(text = "") {
  let cleaned = tryRecoverMojibake(String(text || ""));
  cleaned = normalizeEscapedToolMarkup(cleaned);
  cleaned = cleaned.replace(/\uFFFD/g, "");
  cleaned = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
  cleaned = cleaned.replace(/<(script|iframe|object|embed|style|link|meta|svg|math)\b[\s\S]*?<\/\1>/gi, "");
  cleaned = cleaned.replace(/<\/?(script|iframe|object|embed|style|link|meta|svg|math)\b[^>]*>/gi, "");
  cleaned = cleaned.replace(/\b(on\w+)\s*=\s*(['"]).*?\2/gi, "");
  cleaned = cleaned.replace(/\b(?:javascript|vbscript|data):/gi, "");
  cleaned = cleaned.replace(/\\</g, "<");
  cleaned = cleaned.replace(/\\>/g, ">");
  cleaned = cleaned.replace(/&lt;/gi, "<");
  cleaned = cleaned.replace(/&gt;/gi, ">");
  cleaned = cleaned.replace(/<vgo_plan>[\s\S]*?<\/vgo_plan>/gi, "");
  cleaned = cleaned.replace(/(^|\n)\s*<vgo_tool_call>[\s\S]*?<\/vgo_tool_call>\s*(?=\n|$)/gi, "$1");
  cleaned = cleaned.replace(/(^|\n)\s*<vgo_tool_call>[\s\S]*$/gi, "$1");
  cleaned = cleaned.replace(/(^|\n)\s*<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>\s*(?=\n|$)/gi, "$1");
  cleaned = cleaned.replace(/(^|\n)\s*<minimax:tool_call>[\s\S]*$/gi, "$1");
  cleaned = cleaned.replace(/(^|\n)\s*<invoke\b[\s\S]*?<\/invoke>\s*(?=\n|$)/gi, "$1");
  cleaned = cleaned.replace(/(^|\n)\s*<invoke\b[\s\S]*$/gi, "$1");
  cleaned = cleaned.replace(/<vgo_tool_call>([\s\S]*?)<\/vgo_tool_call>/gi, (match, body) => {
    const parsed = parseJsonObjectBlock(body);
    const calls = (parsed ? collectToolCalls(parsed) : collectLooseToolCalls(body)).filter(
      (call) => call && typeof call === "object" && call.name
    );
    return calls.length ? "" : match;
  });
  cleaned = cleaned.replace(/<minimax:tool_call>([\s\S]*?)<\/minimax:tool_call>/gi, (match, body) => {
    const invokeMatch = body.match(/<invoke\b[^>]*name=["'][^"']+["'][^>]*>[\s\S]*?<\/invoke>/i);
    return invokeMatch ? "" : match;
  });
  cleaned = cleaned.replace(/<invoke\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke>/gi, (match, name, body) => {
    if (!name) return match;
    const parsed = parseJsonObjectBlock(body);
    const validArgs = parsed && typeof parsed === "object";
    return validArgs ? "" : match;
  });
  cleaned = cleaned.replace(/<\/?tool_call[^>]*>/gi, "");
  cleaned = cleaned.replace(/^\s*<[^>]+>\s*$/gm, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

function parseJsonObjectBlock(text = "") {
  const source = String(text || "").trim();
  if (!source) {
    return null;
  }

  const candidates = [
    source,
    source.replace(/<\/?[^>\n]+>/g, "").trim(),
    source.replace(/\\"/g, "\"").replace(/\\'/g, "'").replace(/<\/?[^>\n]+>/g, "").trim()
  ].filter(Boolean);

  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(source.slice(firstBrace, lastBrace + 1).replace(/<\/?[^>\n]+>/g, "").trim());
    candidates.push(
      source
        .slice(firstBrace, lastBrace + 1)
        .replace(/\\"/g, "\"")
        .replace(/\\'/g, "'")
        .replace(/<\/?[^>\n]+>/g, "")
        .trim()
    );
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {}
  }

  return null;
}

function looksLikeContinuationIntent(text = "") {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return false;
  }

  return /(?:\u7ee7\u7eed\u8bfb\u53d6|\u7ee7\u7eed\u68c0\u67e5|\u7ee7\u7eed\u67e5\u770b|\u5148\u68c0\u67e5|\u5148\u8bfb\u53d6|\u5148\u67e5\u770b|\u5148\u5217\u51fa|\u4e0b\u4e00\u6b65|\u63a5\u4e0b\u6765|\u7136\u540e|\u7ee7\u7eed\u5b8c\u6210|\u7ee7\u7eed\u5904\u7406|\u7ee7\u7eed\u5206\u6790|continue|next step|keep going|remaining files?|components?|directory|read|inspect|check|list|scan|open|review|analy[sz]e)/i.test(
    normalized
  );
}

function collectToolCalls(parsed) {
  if (!parsed) {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed.calls)) {
    return parsed.calls;
  }
  if (parsed.name) {
    return [parsed];
  }
  return [];
}

function extractBalancedObjectBlock(text = "", startIndex = -1) {
  const source = String(text || "");
  const start = Number(startIndex);
  if (!source || start < 0 || start >= source.length || source[start] !== "{") {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return null;
}

function collectLooseToolCalls(rawText = "") {
  const source = String(rawText || "");
  if (!source) {
    return [];
  }

  const calls = [];
  const namePattern = /"name"\s*:\s*"([^"]+)"/gi;
  const allowed = new Set([
    "read_file",
    "list_dir",
    "search_code",
    "write_file",
    "append_file",
    "run_command",
    "open_path",
    "move_path",
    "copy_path",
    "delete_path"
  ]);
  let match;

  while ((match = namePattern.exec(source)) !== null) {
    const name = String(match[1] || "").trim();
    if (!name) {
      continue;
    }

    const tail = source.slice(match.index);
    const argsKey = tail.search(/"arguments"\s*:/i);
    let args = {};

    if (argsKey >= 0) {
      const absoluteArgsKey = match.index + argsKey;
      const braceStart = source.indexOf("{", absoluteArgsKey);
      if (braceStart >= 0) {
        const block = extractBalancedObjectBlock(source, braceStart);
        if (block) {
          try {
            const parsedArgs = JSON.parse(block);
            if (parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)) {
              args = parsedArgs;
            }
          } catch {}
        }
      }
    }

    if (allowed.has(name.toLowerCase()) || Object.keys(args).length > 0) {
      calls.push({ name, arguments: args });
    }
  }

  return calls;
}

function parseToolCalls(rawText = "") {
  const source = String(rawText || "");
  const normalizedSource = normalizeEscapedToolMarkup(source);
  const calls = [];
  
  const minimaxCalls = parseMinimaxToolCalls(normalizedSource);
  if (minimaxCalls.length) {
    return minimaxCalls;
  }
  
  const tagPatterns = [
    'vgo_tool_call',
    'qwen:tool_call',
    'glm:tool_call',
    'function_call',
    'tool_call',
    'function'
  ];

  for (const tagName of tagPatterns) {
    const pattern = new RegExp(LT + tagName + ">([\\s\\S]*?)" + LT + SLASH + tagName + GT, "gi");
    const matches = [...normalizedSource.matchAll(pattern)];
    for (const match of matches) {
      const parsed = parseJsonObjectBlock(match[1]);
      if (parsed) {
        calls.push(...collectToolCalls(parsed));
      } else {
        calls.push(...collectLooseToolCalls(match[1]));
      }
    }
  }

  if (calls.length) {
    return calls.filter((call) => call && typeof call === "object" && call.name);
  }

  const codeBlockMatch = normalizedSource.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    const parsed = parseJsonObjectBlock(codeBlockMatch[1]);
    const blockCalls = collectToolCalls(parsed).filter((call) => call && typeof call === "object" && call.name);
    if (blockCalls.length) return blockCalls;
  }

  const jsonMatch = normalizedSource.match(/\{\s*"name"\s*:\s*"([^"]+)"[\s\S]*?\}/);
  if (jsonMatch) {
    const parsed = parseJsonObjectBlock(jsonMatch[0]);
    const jsonCalls = collectToolCalls(parsed).filter((call) => call && typeof call === "object" && call.name);
    if (jsonCalls.length) return jsonCalls;
  }
  const looseJsonCalls = collectLooseToolCalls(normalizedSource).filter(
    (call) => call && typeof call === "object" && call.name
  );
  if (looseJsonCalls.length) {
    return looseJsonCalls;
  }

  const invokeMatches = [
    ...normalizedSource.matchAll(/<invoke\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke>/gi)
  ];
  if (invokeMatches.length) {
    return invokeMatches.map((match) => {
      const parsed = parseJsonObjectBlock(match[2]);
      return {
        name: match[1],
        arguments: parsed || {}
      };
    });
  }

  const lineBasedCalls = [];
  const toolLineMatches = [
    ...source.matchAll(/(?:^|\n)\s*[-*]?\s*(?:Agent\s*)?(?:正在调用工具[:：]?)?\s*(read_file|list_dir|search_code|write_file|run_command|open_path)\s*\|\s*([^\n]+)/gim)
  ];
  if (normalizedSource !== source) {
    toolLineMatches.push(
      ...normalizedSource.matchAll(
        /(?:^|\n)\s*[-*]?\s*(?:Agent\s*)?(?:.*?[:：])?\s*(read_file|list_dir|search_code|write_file|run_command|open_path)\s*\|\s*([^\n]+)/gim
      )
    );
  }
  for (const match of toolLineMatches) {
    const name = String(match[1] || "").trim();
    const argsText = String(match[2] || "").trim();
    if (!name || !argsText) {
      continue;
    }

    const args = {};
    for (const segment of argsText.split(/\s*\|\s*/)) {
      const pairMatch = segment.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
      if (!pairMatch) {
        continue;
      }
      const key = pairMatch[1];
      let value = pairMatch[2].trim();
      value = value.replace(/^["']|["']$/g, "");
      if (!value) {
        continue;
      }

      if (/^(maxEntries|start|end|limit|timeout_ms)$/i.test(key) && /^-?\d+$/.test(value)) {
        args[key] = Number(value);
      } else {
        args[key] = value;
      }
    }

    if (Object.keys(args).length) {
      lineBasedCalls.push({ name, arguments: args, matchIndex: match.index });
    }
  }
  
  if (lineBasedCalls.length) {
    const allCodeBlocks = [...normalizedSource.matchAll(/```(?:\w+)?\s*([\s\S]*?)```/gi)];
    let codeBlockIndex = 0;
    
    for (const call of lineBasedCalls) {
      if ((call.name === "write_file" || call.name === "append_file") && !call.arguments.content) {
        const afterMatch = normalizedSource.slice(call.matchIndex || 0);
        
        const codeBlockMatch = afterMatch.match(/```(?:\w+)?\s*([\s\S]*?)```/i);
        if (codeBlockMatch?.[1]) {
          let content = codeBlockMatch[1].trim();
          const lines = content.split("\n");
          const trimmedLines = lines.map(line => {
            if (line.match(/^def |^import |^from |^class |^\s*(if|else|for|while|return|""""|''')/)) {
              return line;
            }
            return line;
          });
          content = trimmedLines.join("\n").trim();
          if (content.length > 0) {
            call.arguments.content = content;
          }
        }
        
        const directContentMatch = afterMatch.match(/文件内容[：:]\s*([\s\S]*?)(?:\n\n|\n```|$)/i);
        if (directContentMatch?.[1] && !call.arguments.content) {
          call.arguments.content = directContentMatch[1].trim();
        }
      }
    }
    
    const result = lineBasedCalls.map(({ matchIndex, ...rest }) => rest);
    return result.filter(call => call.arguments && Object.keys(call.arguments).length > 0);
  }

  return [];
}

function parseMinimaxToolCalls(source) {
  const calls = [];
  
  const extractParams = (paramsBlock) => {
    const params = {};
    const paramPattern = /<parameter\s+name=["']([^"']+)["']>([\s\S]*?)<\/parameter>/gi;
    const paramMatches = [...paramsBlock.matchAll(paramPattern)];
    for (const paramMatch of paramMatches) {
      const paramName = paramMatch[1];
      let paramValue = paramMatch[2].trim();
      
      if (paramValue.startsWith('\n')) paramValue = paramValue.slice(1);
      if (paramValue.endsWith('\n')) paramValue = paramValue.slice(0, -1);
      
      try {
        params[paramName] = JSON.parse(paramValue);
      } catch {
        params[paramName] = paramValue;
      }
    }
    return params;
  };
  
  const invokePattern = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi;
  const toolCallBlockPattern = /<minimax:tool_call>([\s\S]*?)<\/minimax:tool_call>/gi;
  
  const toolBlocks = [...source.matchAll(toolCallBlockPattern)];
  const hasToolCallBlocks = toolBlocks.length > 0;
  
  const allInvokes = [...source.matchAll(invokePattern)];
  
  for (const match of allInvokes) {
    const name = match[1];
    const paramsBlock = match[2];
    
    if (hasToolCallBlocks) {
      const inToolBlock = toolBlocks.some(block => block[1].includes(match[0]));
      if (!inToolBlock) continue;
    }
    
    if (name) {
      calls.push({
        name,
        arguments: extractParams(paramsBlock)
      });
    }
  }
  
  return calls;
}

function parsePlanBlock(rawText = "") {
  const match = String(rawText || "").match(/<vgo_plan>([\s\S]*?)<\/vgo_plan>/i);
  if (!match) {
    return null;
  }

  const parsed = parseJsonObjectBlock(match[1]);
  if (!parsed) {
    return null;
  }

  const summary = String(parsed.summary || parsed.goal || "").trim();
  const steps = Array.isArray(parsed.steps)
    ? parsed.steps.map((step) => String(step || "").trim()).filter(Boolean).slice(0, 8)
    : [];

  if (!summary && !steps.length) {
    return null;
  }

  return { summary, steps };
}

function buildToolResultMessage(results) {
  const blocks = results.map((result, index) => {
    const status = result.ok ? "ok" : "error";
    const summary = truncateForTransport(String(result.summary || "").trim(), MAX_TOOL_SUMMARY_CHARS);
    const output = truncateForTransport(String(result.output || "").trim() || "(no output)", MAX_TOOL_OUTPUT_CHARS);
    return [
      `Tool ${index + 1}`,
      `name: ${result.name}`,
      `status: ${status}`,
      `summary: ${summary}`,
      "output:",
      output
    ].join("\n");
  });

  return truncateForTransport([
    "Below are the latest tool execution results.",
    "Continue the task based on these results. If more information is needed, call more tools. If the information is sufficient, give the final answer directly.",
    "",
    ...blocks
  ].join("\n\n"), MAX_TOOL_RESULT_MESSAGE_CHARS);
}

function normalizeEscapedToolMarkup(input = "") {
  let normalized = String(input || "");
  normalized = normalized.replace(/\\</g, "<");
  normalized = normalized.replace(/\\>/g, ">");
  normalized = normalized.replace(/\\"/g, "\"");
  normalized = normalized.replace(/\\'/g, "'");
  normalized = normalized.replace(/&lt;/gi, "<");
  normalized = normalized.replace(/&gt;/gi, ">");
  normalized = normalized.replace(/<\\+\/\s*/g, "</");
  return normalized;
}

function buildFallbackCompletionFromResults(prompt = "", results = []) {
  const completed = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const lines = ["本轮已完成工具执行，以下是可确认的结果："];

  if (prompt) {
    lines.push(`任务主题：${prompt}`);
  }

  if (completed.length) {
    lines.push("", "已完成：");
    lines.push(...completed.map((result) => `- ${result.name}: ${result.summary || "成功"}`));
  }

  if (failed.length) {
    lines.push("", "失败或未完成：");
    lines.push(...failed.map((result) => `- ${result.name}: ${result.summary || "失败"}`));
  }

  if (completed.length && !failed.length) {
    lines.push("", "结论：已拿到可用执行结果，可基于以上结果继续下一步。");
  } else if (completed.length && failed.length) {
    lines.push("", "结论：本轮部分成功，建议优先处理失败项后再继续。");
  } else {
    lines.push("", "结论：本轮未获得有效结果，请重试或调整模型/权限后继续。");
  }
  return lines.join("\n");
}

function promptRequiresWrite(prompt = "") {
  const text = String(prompt || "").toLowerCase();
  return /\u5199\u5165|\u521b\u5efa|\u65b0\u5efa|\u4fdd\u5b58|\u751f\u6210\u6587\u4ef6|\u5199\u4e2a\u6587\u4ef6|append|overwrite|write_file|create file|write file|save file/.test(
    text
  );
}

function promptRequiresRepair(prompt = "") {
  const text = String(prompt || "").toLowerCase();
  return /fix|repair|patch|modify|update|rewrite|refactor|self-heal|self heal|\u81ea\u6108|\u81ea\u4fee\u590d|\u4fee\u590d|\u4fee\u6539|\u66f4\u65b0|\u91cd\u6784|\u8865\u4e01|\u76f4\u63a5\u4fee/.test(
    text
  );
}

function promptRequiresTools(prompt = "") {
  const text = String(prompt || "").toLowerCase();
  return /\u8bfb\u53d6|\u67e5\u770b|\u5217\u51fa|\u626b\u63cf|\u5206\u6790\u5f53\u524d\u76ee\u5f55|\u521b\u5efa|\u65b0\u5efa|\u5199\u5165|\u4fdd\u5b58|\u79fb\u52a8|\u590d\u5236|\u5220\u9664|\u6253\u5f00|run_command|read_file|write_file|list_dir|search_code|read|list|scan|create|write|save|move|copy|delete/.test(
    text
  );
}

function looksLikeGenericAcknowledgement(text = "") {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return false;
  }

  return (
    normalized.length <= 180 &&
    /\u6211\u6765\u5e2e\u4f60|\u6211\u4f1a\u5e2e\u4f60|\u9996\u5148\u8ba9\u6211|\u5148\u8ba9\u6211|\u5148\u67e5\u770b|\u5148\u8bfb\u53d6|\u5148\u5217\u51fa|\u5148\u626b\u63cf|\u6b63\u5728\u5e2e\u4f60|\u6211\u6765\u5b8c\u6210\u8fd9\u4e2a\u4efb\u52a1|\u6211\u4f1a\u7acb\u5373\u6267\u884c/.test(
      normalized
    )
  );
}

module.exports = {
  tryRecoverMojibake,
  sanitizeAssistantText,
  parseToolCalls,
  parsePlanBlock,
  buildToolResultMessage,
  buildFallbackCompletionFromResults,
  promptRequiresWrite,
  promptRequiresRepair,
  promptRequiresTools,
  looksLikeGenericAcknowledgement
  ,
  looksLikeContinuationIntent
};
