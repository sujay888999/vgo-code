import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Message, LogLine } from '../store/appStore'
import { useI18n } from '../i18n'
import {
  Copy,
  CheckCheck,
  AlertTriangle,
  Clock,
  Bot,
  User,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

interface SyntaxModule {
  default: React.ComponentType<any> & {
    registerLanguage?: (name: string, syntax: unknown) => void
  }
}

interface SyntaxStyleModule {
  oneDark: Record<string, React.CSSProperties>
}

interface MessageListProps {
  messages: Message[]
  onCopy: (id: string, text: string) => void
  copiedId: string | null
}

export function MessageList({ messages, onCopy, copiedId }: MessageListProps) {
  return (
    <div className="message-list">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} onCopy={onCopy} copiedId={copiedId} />
      ))}
    </div>
  )
}

interface MessageItemProps {
  message: Message
  onCopy: (id: string, text: string) => void
  copiedId: string | null
}

function MessageItem({ message, onCopy, copiedId }: MessageItemProps) {
  const { t } = useI18n()
  const isUser = message.role === 'user'
  const isLoading = message.status === 'loading'
  const displayedText = message.text || ''
  const patches = message.patches || []
  const logLines: LogLine[] = message.logLines || []
  const [patchExpanded, setPatchExpanded] = useState(false)

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

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

  const hasLines = logLines.length > 0
  const hasReply = displayedText.trim().length > 0
  const showThinking = isLoading && !hasLines && !hasReply

  return (
    <div className={`message-item assistant ${message.status || ''}`}>
      <div className="message-avatar"><Bot size={18} /></div>
      <div className="message-body">
        {showThinking && (
          <div className="thinking-indicator">
            <span className="executing-shimmer-text">{t('task.thinking')}</span>
          </div>
        )}
        {hasLines && (
          <div className="exec-log">
            {logLines.map((line, i) => (
              <div key={i} className={`exec-log-line ${!line.done ? 'exec-log-line--active' : ''}`}>
                <span className="exec-log-icon">{line.done ? '✓' : <span className="exec-dot-pulse" />}</span>
                <span className="exec-log-text">{line.text}</span>
              </div>
            ))}
          </div>
        )}
        {(hasReply || (isLoading && hasLines)) && (
          <div className="message-bubble">
            {hasReply ? <StreamingContent text={displayedText} isStreaming={isLoading} /> : null}
            {message.status === 'error' && (
              <div className="message-error">
                <AlertTriangle size={14} />
                <span>{t('message.failed')}</span>
              </div>
            )}
          </div>
        )}
        {patches.length > 0 && (
          <div className="patch-summary">
            <button type="button" className="patch-toggle" onClick={() => setPatchExpanded(v => !v)}>
              {patchExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>改动了 {patches.length} 个文件</span>
            </button>
            {patchExpanded && (
              <ul className="patch-list">
                {patches.map((p, idx) => (
                  <li key={idx} className="patch-item">
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

function StreamingContent({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const hasCode = /```/.test(text)
  const [syntaxHighlighter, setSyntaxHighlighter] = useState<SyntaxModule['default'] | null>(null)
  const [syntaxStyle, setSyntaxStyle] = useState<SyntaxStyleModule['oneDark'] | null>(null)

  useEffect(() => {
    if (!hasCode) return

    let cancelled = false

    const load = async () => {
      const [
        syntaxModule,
        { oneDark },
        jsModule,
        tsModule,
        bashModule,
        jsonModule,
        diffModule,
        pythonModule,
        cssModule,
        markdownModule,
        yamlModule,
        sqlModule,
      ] = await Promise.all([
        import('react-syntax-highlighter/dist/esm/prism-async-light'),
        import('react-syntax-highlighter/dist/esm/styles/prism'),
        import('react-syntax-highlighter/dist/esm/languages/prism/javascript'),
        import('react-syntax-highlighter/dist/esm/languages/prism/typescript'),
        import('react-syntax-highlighter/dist/esm/languages/prism/bash'),
        import('react-syntax-highlighter/dist/esm/languages/prism/json'),
        import('react-syntax-highlighter/dist/esm/languages/prism/diff'),
        import('react-syntax-highlighter/dist/esm/languages/prism/python'),
        import('react-syntax-highlighter/dist/esm/languages/prism/css'),
        import('react-syntax-highlighter/dist/esm/languages/prism/markdown'),
        import('react-syntax-highlighter/dist/esm/languages/prism/yaml'),
        import('react-syntax-highlighter/dist/esm/languages/prism/sql'),
      ])

      const SyntaxHighlighter = syntaxModule.default
      SyntaxHighlighter.registerLanguage?.('javascript', jsModule.default)
      SyntaxHighlighter.registerLanguage?.('js', jsModule.default)
      SyntaxHighlighter.registerLanguage?.('typescript', tsModule.default)
      SyntaxHighlighter.registerLanguage?.('ts', tsModule.default)
      SyntaxHighlighter.registerLanguage?.('tsx', tsModule.default)
      SyntaxHighlighter.registerLanguage?.('jsx', jsModule.default)
      SyntaxHighlighter.registerLanguage?.('bash', bashModule.default)
      SyntaxHighlighter.registerLanguage?.('shell', bashModule.default)
      SyntaxHighlighter.registerLanguage?.('sh', bashModule.default)
      SyntaxHighlighter.registerLanguage?.('json', jsonModule.default)
      SyntaxHighlighter.registerLanguage?.('diff', diffModule.default)
      SyntaxHighlighter.registerLanguage?.('python', pythonModule.default)
      SyntaxHighlighter.registerLanguage?.('py', pythonModule.default)
      SyntaxHighlighter.registerLanguage?.('css', cssModule.default)
      SyntaxHighlighter.registerLanguage?.('markdown', markdownModule.default)
      SyntaxHighlighter.registerLanguage?.('md', markdownModule.default)
      SyntaxHighlighter.registerLanguage?.('yaml', yamlModule.default)
      SyntaxHighlighter.registerLanguage?.('yml', yamlModule.default)
      SyntaxHighlighter.registerLanguage?.('sql', sqlModule.default)

      if (!cancelled) {
        setSyntaxHighlighter(() => SyntaxHighlighter)
        setSyntaxStyle(oneDark)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [hasCode])

  return (
    <div className={`message-content markdown-content${isStreaming ? ' streaming' : ''}`}>
      <ReactMarkdown
        components={{
          code({ className, children, ...props }) {
            const rawContent = String(children ?? '').replace(/\n$/, '')
            const langMatch = /language-([\w-]+)/.exec(className || '')
            const isBlock = Boolean(langMatch) || rawContent.includes('\n')

            if (!isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              )
            }

            if (!syntaxHighlighter || !syntaxStyle) {
              return (
                <pre className="code-block code-block-fallback">
                  <code>{rawContent}</code>
                </pre>
              )
            }

            const SyntaxHighlighter = syntaxHighlighter
            return (
              <div className="code-block">
                <SyntaxHighlighter
                  language={langMatch?.[1] || 'text'}
                  style={syntaxStyle}
                  customStyle={{
                    margin: '0.5rem 0',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                  }}
                >
                  {rawContent}
                </SyntaxHighlighter>
              </div>
            )
          },
          a({ href, children, ...props }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
      {isStreaming && <span className="cursor-blink">|</span>}
    </div>
  )
}
