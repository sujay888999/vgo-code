# Brand Audit Report

Generated: 2026-04-24T06:59:58.677Z

## VGO Code
- Matches: 0

## desktop shell
- Matches: 0

## Codex
- Matches: 2

- .\src\components\AgentTracePanel.tsx:126:    <section className="agent-process-stream" aria-label="Codex Process">
- .\src\components\AgentTracePanel.tsx:129:          <span className="agent-process-title">Codex Process</span>

## OpenAI
- Matches: 2

- .\src\components\Sidebar.tsx:71:  if (text.includes('gpt') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) return 'OpenAI'
- .\electron\core\vgoSimAdapter.js:14:    "1. 接入真正的 VGO Remote Adapter 或 OpenAI Adapter。",

## ChatGPT
- Matches: 0

## Claude
- Matches: 3

- .\src\components\Sidebar.tsx:72:  if (text.includes('claude')) return 'Claude'
- .\electron\core\bundledCliAdapter.js:170:  providerLabel: "Claude Code 2.1.88 Package",
- .\electron\core\state.js:127:      providerLabel: "Claude Code 2.1.88 Package"

## Cursor
- Matches: 0

## Trae
- Matches: 0

## Windsurf
- Matches: 0

## Summary
- Total matches: 7
- Action: replace/remove legacy naming before next release.

