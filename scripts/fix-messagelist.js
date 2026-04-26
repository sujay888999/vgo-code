const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '../src/components/MessageList.tsx')
let src = fs.readFileSync(file, 'utf8')

// Replace the entire MessageItem function with the new clean version
const START = 'function MessageItem({ message, onCopy, copiedId }: MessageItemProps) {'
const END = 'function StreamingContent('

const si = src.indexOf(START)
const ei = src.indexOf(END)
if (si === -1 || ei === -1) { console.error('markers not found', si, ei); process.exit(1) }

const newMessageItem = `function MessageItem({ message, onCopy, copiedId }: MessageItemProps) {
  const { t } = useI18n()
  const isUser = message.role === 'user'
  const isLoading = message.status === 'loading'
  const displayedText = message.text || ''
  const patches = message.patches || []
  const [patchExpanded, setPatchExpanded] = useState(false)

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

  // ── User ──────────────────────────────────────────────────────────────────
  if (isUser) {
    return (
      <div className="message-item user">
        <div className="message-avatar"><User size={18} /></div>
        <div className="message-body">
          <div className="message-meta">
            <span className="message-role">{t('message.roleUser')}</span>
            <span className="message-time"><Clock size={12} />{formatTime(message.timestamp)}</span>
          </div>
          <div className="message-bubble">
            <div className="message-content">{message.text}</div>
          </div>
        </div>
      </div>
    )
  }

  // ── Assistant (all kinds: stream / final / default) ───────────────────────
  return (
    <div className={\`message-item assistant \${message.status || ''}\`}>
      <div className="message-avatar"><Bot size={18} /></div>
      <div className="message-body">

        {/* "思考中..." shown only while loading, no other label */}
        {isLoading && (
          <div className="thinking-indicator">
            <span className="executing-shimmer-text">{t('task.thinking')}</span>
          </div>
        )}

        <div className="message-bubble">
          {displayedText
            ? <StreamingContent text={displayedText} isStreaming={isLoading} />
            : isLoading
              ? <StreamingContent text="" isStreaming={true} />
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

        {!isLoading && (
          <div className="message-meta message-meta-bottom">
            <span className="message-time"><Clock size={12} />{formatTime(message.timestamp)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

`

src = src.slice(0, si) + newMessageItem + src.slice(ei)
fs.writeFileSync(file, src, 'utf8')
console.log('done')
