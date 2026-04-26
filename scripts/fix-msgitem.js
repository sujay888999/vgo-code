const fs = require('fs')
const f = 'src/components/MessageList.tsx'
let src = fs.readFileSync(f, 'utf8')

// Find the assistant block start and end markers
const START = '  // ── Assistant (all kinds: stream / final / default) ───────────────────────'
const END = 'function StreamingContent('

const si = src.indexOf(START)
const ei = src.indexOf(END)
if (si === -1 || ei === -1) { console.error('markers not found', si, ei); process.exit(1) }

const newBlock = `  // ── Assistant ──────────────────────────────────────────────────────────────
  const logText = message.logText || ''
  const hasLog = logText.trim().length > 0
  const hasReply = displayedText.trim().length > 0
  const showThinking = isLoading && !hasLog && !hasReply

  return (
    <div className={\`message-item assistant \${message.status || ''}\`}>
      <div className="message-avatar"><Bot size={18} /></div>
      <div className="message-body">

        {/* "思考中..." only when nothing has appeared yet */}
        {showThinking && (
          <div className="thinking-indicator">
            <span className="executing-shimmer-text">{t('task.thinking')}</span>
          </div>
        )}

        {/* Execution log lines — always preserved, shown in muted small text */}
        {hasLog && (
          <div className="exec-log">
            {logText.split('\\n').filter(Boolean).map((line, i) => (
              <div key={i} className="exec-log-line">{line}</div>
            ))}
          </div>
        )}

        {/* Model reply — streams in after logs */}
        <div className="message-bubble">
          {hasReply
            ? <StreamingContent text={displayedText} isStreaming={isLoading} />
            : null
          }
          {message.status === 'error' && (
            <div className="message-error">
              <AlertTriangle size={14} />
              <span>{t('message.failed')}</span>
            </div>
          )}
        </div>

        {/* File patches — collapsed at the bottom */}
        {patches.length > 0 && (
          <div className="patch-summary">
            <button
              type="button"
              className="patch-toggle"
              onClick={() => setPatchExpanded(v => !v)}
            >
              {patchExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>改动了 {patches.length} 个文件</span>
            </button>
            {patchExpanded && (
              <ul className="patch-list">
                {patches.map((p, i) => (
                  <li key={i} className="patch-item">
                    <code className="patch-file">{p.file}</code>
                    {p.summary && <span className="patch-desc">{p.summary}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!isLoading && (
          <div className="message-actions">
            <button className="message-action" onClick={() => onCopy(message.id, message.text)} title="复制">
              {copiedId === message.id ? <CheckCheck size={14} /> : <Copy size={14} />}
            </button>
          </div>
        )}

        <div className="message-meta message-meta-bottom">
          <span className="message-time"><Clock size={12} />{formatTime(message.timestamp)}</span>
        </div>
      </div>
    </div>
  )
}

`

src = src.slice(0, si) + newBlock + src.slice(ei)
fs.writeFileSync(f, src, 'utf8')
console.log('done')
