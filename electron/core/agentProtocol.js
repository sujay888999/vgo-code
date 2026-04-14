const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
const SLASH = String.fromCharCode(47);

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
  cleaned = cleaned.replace(/\uFFFD/g, "");
  cleaned = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  cleaned = cleaned.replace(/<vgo_plan>[\s\S]*?<\/vgo_plan>/gi, "");
  cleaned = cleaned.replace(/<vgo_tool_call>[\s\S]*?<\/vgo_tool_call>/gi, "");
  cleaned = cleaned.replace(/<vgo_tool_call>[\s\S]*$/gi, "");
  cleaned = cleaned.replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/gi, "");
  cleaned = cleaned.replace(/<minimax:tool_call>[\s\S]*$/gi, "");
  cleaned = cleaned.replace(/<invoke\b[\s\S]*?<\/invoke>/gi, "");
  cleaned = cleaned.replace(/<invoke\b[\s\S]*$/gi, "");
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
    source.replace(/<\/?[^>\n]+>/g, "").trim()
  ].filter(Boolean);

  const firstBrace = source.indexOf("{");
  const lastBrace = source.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(source.slice(firstBrace, lastBrace + 1).replace(/<\/?[^>\n]+>/g, "").trim());
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

function parseToolCalls(rawText = "") {
  const source = String(rawText || "");
  const calls = [];
  
  const minimaxCalls = parseMinimaxToolCalls(source);
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
    const matches = [...source.matchAll(pattern)];
    for (const match of matches) {
      const parsed = parseJsonObjectBlock(match[1]);
      calls.push(...collectToolCalls(parsed));
    }
  }

  if (calls.length) {
    return calls.filter((call) => call && typeof call === "object" && call.name);
  }

  const codeBlockMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    const parsed = parseJsonObjectBlock(codeBlockMatch[1]);
    const blockCalls = collectToolCalls(parsed).filter((call) => call && typeof call === "object" && call.name);
    if (blockCalls.length) return blockCalls;
  }

  const jsonMatch = source.match(/\{\s*"name"\s*:\s*"([^"]+)"[\s\S]*?\}/);
  if (jsonMatch) {
    const parsed = parseJsonObjectBlock(jsonMatch[0]);
    const jsonCalls = collectToolCalls(parsed).filter((call) => call && typeof call === "object" && call.name);
    if (jsonCalls.length) return jsonCalls;
  }

  const invokeMatches = [
    ...source.matchAll(/<invoke\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke>/gi)
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
    const allCodeBlocks = [...source.matchAll(/```(?:\w+)?\s*([\s\S]*?)```/gi)];
    let codeBlockIndex = 0;
    
    for (const call of lineBasedCalls) {
      if ((call.name === "write_file" || call.name === "append_file") && !call.arguments.content) {
        const afterMatch = source.slice(call.matchIndex || 0);
        
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
  
  const toolCallBlockPattern = /<minimax:tool_call>([\s\S]*?)<\/minimax:tool_call>/gi;
  const invokePattern = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi;
  
  const toolBlocks = [...source.matchAll(toolCallBlockPattern)];
  
  for (const block of toolBlocks) {
    const invokeMatches = [...block[1].matchAll(invokePattern)];
    for (const match of invokeMatches) {
      const name = match[1];
      const paramsBlock = match[2];
      
      const paramPattern = /<parameter\s+name=["']([^"']+)["']>([\s\S]*?)<\/parameter>/gi;
      const params = {};
      
      const paramMatches = [...paramsBlock.matchAll(paramPattern)];
      for (const paramMatch of paramMatches) {
        const paramName = paramMatch[1];
        let paramValue = paramMatch[2].trim();
        
        if (paramValue.startsWith('\n')) paramValue = paramValue.slice(1);
        if (paramValue.endsWith('\n')) paramValue = paramValue.slice(0, -1);
        
        try {
          const parsed = JSON.parse(paramValue);
          params[paramName] = parsed;
        } catch {
          params[paramName] = paramValue;
        }
      }
      
      if (name) {
        calls.push({
          name,
          arguments: params
        });
      }
    }
  }
  
  if (calls.length === 0) {
    const invokeWithoutBlockPattern = /<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi;
    const standaloneInvokes = [...source.matchAll(invokeWithoutBlockPattern)];
    
    for (const match of standaloneInvokes) {
      if (match[1] && !source.includes('<minimax:tool_call>')) {
        const name = match[1];
        const paramsBlock = match[2];
        
        const paramPattern = /<parameter\s+name=["']([^"']+)["']>([\s\S]*?)<\/parameter>/gi;
        const params = {};
        
        const paramMatches = [...paramsBlock.matchAll(paramPattern)];
        for (const paramMatch of paramMatches) {
          const paramName = paramMatch[1];
          let paramValue = paramMatch[2].trim();
          
          if (paramValue.startsWith('\n')) paramValue = paramValue.slice(1);
          if (paramValue.endsWith('\n')) paramValue = paramValue.slice(0, -1);
          
          try {
            const parsed = JSON.parse(paramValue);
            params[paramName] = parsed;
          } catch {
            params[paramName] = paramValue;
          }
        }
        
        calls.push({
          name,
          arguments: params
        });
      }
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
    const output = String(result.output || "").trim() || "(no output)";
    return [
      `Tool ${index + 1}`,
      `name: ${result.name}`,
      `status: ${status}`,
      `summary: ${result.summary || ""}`,
      "output:",
      output
    ].join("\n");
  });

  return [
    "Below are the latest tool execution results.",
    "Continue the task based on these results. If more information is needed, call more tools. If the information is sufficient, give the final answer directly.",
    "",
    ...blocks
  ].join("\n\n");
}

function buildFallbackCompletionFromResults(prompt = "", results = []) {
  const completed = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const lines = ["This Agent round has finished tool execution."];

  if (prompt) {
    lines.push(`User task: ${prompt}`);
  }

  if (completed.length) {
    lines.push("", "Completed:");
    lines.push(...completed.map((result) => `- ${result.name}: ${result.summary || "success"}`));
  }

  if (failed.length) {
    lines.push("", "Failed or incomplete:");
    lines.push(...failed.map((result) => `- ${result.name}: ${result.summary || "failed"}`));
  }

  lines.push("", "Please inspect the execution results above before continuing with the next step.");
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
