const fs = require('fs');
const path = 'E:\\VGO-CODE\\electron\\core\\agentProtocol.js';

let content = fs.readFileSync(path, 'utf8');

const startMarker = 'function parseToolCalls(rawText = "") {';
const endMarker = '\n}\n\nfunction parsePlanBlock';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker, startIndex);

if (startIndex === -1 || endIndex === -1) {
  console.error('Could not find parseToolCalls function boundaries');
  process.exit(1);
}

const before = content.substring(0, startIndex);
const after = content.substring(endIndex + 1);

// Build regex patterns using String.raw to avoid escaping issues
const LT = '<';
const GT = '>';
const SLASH = '/';

function makePattern(tagName) {
  return new RegExp(LT + tagName + '>([\\s\\S]*?)' + LT + SLASH + tagName + GT, 'gi');
}

const patterns = [
  makePattern('vgo_tool_call'),
  makePattern('minimax:tool_call'),
  makePattern('function_call'),
  makePattern('tool_call'),
  makePattern('function')
];

const newFunctionLines = [];
newFunctionLines.push('function parseToolCalls(rawText = "") {');
newFunctionLines.push('  const source = String(rawText || "");');
newFunctionLines.push('  const tagPatterns = [');
newFunctionLines.push("    'vgo_tool_call',");
newFunctionLines.push("    'minimax:tool_call',");
newFunctionLines.push("    'function_call',");
newFunctionLines.push("    'tool_call',");
newFunctionLines.push("    'function'");
newFunctionLines.push('  ];');
newFunctionLines.push('');
newFunctionLines.push('  const calls = [];');
newFunctionLines.push('  for (const tagName of tagPatterns) {');
newFunctionLines.push('    const pattern = new RegExp(LT + tagName + ">([\\\\s\\\\S]*?)" + LT + SLASH + tagName + GT, "gi");');
newFunctionLines.push('    const matches = [...source.matchAll(pattern)];');
newFunctionLines.push('    for (const match of matches) {');
newFunctionLines.push('      const parsed = parseJsonObjectBlock(match[1]);');
newFunctionLines.push('      calls.push(...collectToolCalls(parsed));');
newFunctionLines.push('    }');
newFunctionLines.push('  }');
newFunctionLines.push('');
newFunctionLines.push('  if (calls.length) {');
newFunctionLines.push('    return calls.filter((call) => call && typeof call === "object" && call.name);');
newFunctionLines.push('  }');
newFunctionLines.push('');
newFunctionLines.push('  const codeBlockMatch = source.match(/```(?:json)?\\s*([\\s\\S]*?)```/i);');
newFunctionLines.push('  if (codeBlockMatch) {');
newFunctionLines.push('    const parsed = parseJsonObjectBlock(codeBlockMatch[1]);');
newFunctionLines.push('    const blockCalls = collectToolCalls(parsed).filter((call) => call && typeof call === "object" && call.name);');
newFunctionLines.push('    if (blockCalls.length) return blockCalls;');
newFunctionLines.push('  }');
newFunctionLines.push('');
newFunctionLines.push('  const jsonMatch = source.match(/\\{\\s*"name"\\s*:\\s*"([^"]+)"[\\s\\S]*?\\}/);');
newFunctionLines.push('  if (jsonMatch) {');
newFunctionLines.push('    const parsed = parseJsonObjectBlock(jsonMatch[0]);');
newFunctionLines.push('    const jsonCalls = collectToolCalls(parsed).filter((call) => call && typeof call === "object" && call.name);');
newFunctionLines.push('    if (jsonCalls.length) return jsonCalls;');
newFunctionLines.push('  }');
newFunctionLines.push('');
newFunctionLines.push('  const invokeMatches = [');
newFunctionLines.push('    ...source.matchAll(/<invoke\\b[^>]*name=["\\x27]([^"\\x27]+)["\\x27][^>]*>([\\s\\S]*?)<\\/invoke>/gi)');
newFunctionLines.push('  ];');
newFunctionLines.push('  if (invokeMatches.length) {');
newFunctionLines.push('    return invokeMatches.map((match) => {');
newFunctionLines.push('      const parsed = parseJsonObjectBlock(match[2]);');
newFunctionLines.push('      return {');
newFunctionLines.push('        name: match[1],');
newFunctionLines.push('        arguments: parsed || {}');
newFunctionLines.push('      };');
newFunctionLines.push('    });');
newFunctionLines.push('  }');
newFunctionLines.push('');
newFunctionLines.push('  return [];');
newFunctionLines.push('}');

const newFunction = newFunctionLines.join('\n');

// Also need to add LT, SLASH constants at top of file if not present
if (!content.includes('const LT = ')) {
  const insertPoint = content.indexOf('function sanitizeAssistantText');
  const constants = [
    'const LT = String.fromCharCode(60);',
    'const GT = String.fromCharCode(62);',
    'const SLASH = String.fromCharCode(47);',
    ''
  ].join('\n');
  content = content.substring(0, insertPoint) + constants + content.substring(insertPoint);
}

const newContent = before + '\n' + newFunction + after;

fs.writeFileSync(path, newContent, 'utf8');
console.log('Successfully patched agentProtocol.js');
console.log('New parseToolCalls function length:', newFunction.length, 'chars');
