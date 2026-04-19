import React, { useEffect, useState } from 'react'
import type { Message } from '../store/appStore'
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
  const isAssistant = message.role === 'assistant'
  const isLoading = message.status === 'loading'
  const isProgressMessage = message.kind === 'progress'
  const [displayedText, setDisplayedText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(Boolean(message.collapsed))

  useEffect(() => {
    if (isLoading) {
      setDisplayedText(message.text || '')
      setIsStreaming(true)
      return
    }

    setDisplayedText(message.text || '')
    setIsStreaming(false)
  }, [isLoading, message.text])

  useEffect(() => {
    setIsCollapsed(Boolean(message.collapsed))
  }, [message.collapsed, message.id])

  useEffect(() => {
    if (isLoading || !isStreaming || !message.text || displayedText === message.text) return

    const timeout = window.setTimeout(() => {
      setDisplayedText((prev) => {
        if (prev.length < message.text.length) {
          return message.text.slice(0, prev.length + 3)
        }
        return prev
      })
    }, 24)

    return () => window.clearTimeout(timeout)
  }, [isStreaming, displayedText, message.text, isLoading])

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })

  const previewLine = (() => {
    const lines = (displayedText || message.text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    return lines[lines.length - 1] || t('message.clickToExpand')
  })()

  const renderContent = () => {
    if (isProgressMessage && !isLoading && isCollapsed) {
      return (
        <button
          type="button"
          className="message-progress-toggle"
          onClick={() => setIsCollapsed(false)}
        >
          <span className="message-progress-toggle-meta">
            <ChevronRight size={14} />
            <span>{message.title || t('message.reasoning')}</span>
          </span>
          <span className="message-progress-toggle-preview">{previewLine}</span>
        </button>
      )
    }

    if (isLoading) {
      return (
        <div className="message-loading message-loading-stream">
          <span className="loading-text">{message.title || t('message.thinking')}</span>
          <StreamingContent text={displayedText || t('message.preparing')} isStreaming={true} />
        </div>
      )
    }

    if (isAssistant && displayedText) {
      return (
        <>
          {isProgressMessage && (
            <button
              type="button"
              className="message-progress-inline-toggle"
              onClick={() => setIsCollapsed(true)}
            >
              <ChevronDown size={14} />
              <span>{message.title || t('message.reasoning')}</span>
            </button>
          )}
          <StreamingContent text={displayedText} isStreaming={isStreaming} />
        </>
      )
    }

    return <div className="message-content">{message.text}</div>
  }

  return (
    <div className={`message-item ${message.role} ${message.status || ''} ${isProgressMessage ? 'progress-message' : ''}`}>
      <div className="message-avatar">
        {isUser ? <User size={18} /> : <Bot size={18} />}
      </div>

      <div className="message-body">
        <div className="message-meta">
          <span className="message-role">{isUser ? t('message.roleUser') : isProgressMessage ? t('message.roleProgress') : t('message.roleAssistant')}</span>
          <span className="message-time">
            <Clock size={12} />
            {formatTime(message.timestamp)}
          </span>
        </div>

        <div className="message-bubble">
          {renderContent()}
          {message.status === 'error' && (
            <div className="message-error">
              <AlertTriangle size={14} />
              <span>{t('message.failed')}</span>
            </div>
          )}
        </div>

        {!isLoading && (
          <div className="message-actions">
            <button
              className="message-action"
              onClick={() => onCopy(message.id, message.text)}
              title="复制"
            >
              {copiedId === message.id ? <CheckCheck size={14} /> : <Copy size={14} />}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function StreamingContent({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const parts = parseMarkdownWithCode(text)
  const hasCode = parts.some((part) => part.type === 'code')
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
      {parts.map((part, index) => {
        if (part.type === 'code') {
          if (!syntaxHighlighter || !syntaxStyle) {
            return (
              <pre key={index} className="code-block code-block-fallback">
                <code>{part.content}</code>
              </pre>
            )
          }

          const SyntaxHighlighter = syntaxHighlighter
          return (
            <div key={index} className="code-block">
              <SyntaxHighlighter
                language={part.language || 'text'}
                style={syntaxStyle}
                customStyle={{
                  margin: '0.5rem 0',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                }}
              >
                {part.content}
              </SyntaxHighlighter>
            </div>
          )
        }

        return (
          <div
            key={index}
            dangerouslySetInnerHTML={{ __html: formatInlineMarkdown(part.content) }}
          />
        )
      })}
      {isStreaming && <span className="cursor-blink">|</span>}
    </div>
  )
}

function parseMarkdownWithCode(text: string) {
  const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = []
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }

    parts.push({
      type: 'code',
      language: match[1] || 'text',
      content: match[2].trim(),
    })

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) })
  }

  return parts.length > 0 ? parts : [{ type: 'text', content: text }]
}

function formatInlineMarkdown(text: string): string {
  const escapeHtmlAttr = (value: string) =>
    String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

  const sanitizeHref = (href: string) => {
    const normalized = String(href || '').trim().replace(/[\u0000-\u001F\u007F\s]+/g, '')
    if (!normalized) return '#'
    if (/^(javascript|data|vbscript|file):/i.test(normalized)) return '#'
    if (/^(https?:|mailto:|tel:)/i.test(normalized)) return normalized
    return '#'
  }

  let html = text

  html = html.replace(/&/g, '&amp;')
  html = html.replace(/</g, '&lt;')
  html = html.replace(/>/g, '&gt;')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    const safeHref = escapeHtmlAttr(sanitizeHref(href))
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`
  })
  html = html.replace(/^\- (.*$)/gm, '<li>$1</li>')
  html = html.replace(/^\d+\. (.*$)/gm, '<li>$1</li>')
  html = html.replace(/\n/g, '<br>')

  return html
}
