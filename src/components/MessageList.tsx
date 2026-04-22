import React, { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
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
  const isFinalMessage = message.kind === 'final'
  const [isCollapsed, setIsCollapsed] = useState(
    message.collapsed ?? (isProgressMessage && !isLoading),
  )
  const displayedText = message.text || ''
  const isStreaming = isLoading
  const isProgressExpanded = isProgressMessage && !isLoading && !isCollapsed
  const isProgressCollapsed = isProgressMessage && !isLoading && isCollapsed

  useEffect(() => {
    setIsCollapsed(message.collapsed ?? (isProgressMessage && !isLoading))
  }, [message.collapsed, message.id, isProgressMessage, isLoading])

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
    return lines[0] || t('message.clickToExpand')
  })()
  const reasoningTitle =
    message.title === '推理过程' || message.title === 'Reasoning'
      ? t('message.reasoning')
      : message.title || t('message.reasoning')

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
              <span>{reasoningTitle}</span>
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
              <span>{reasoningTitle}</span>
            </button>
          )}
          <StreamingContent text={displayedText} isStreaming={isStreaming} />
        </>
      )
    }

    return <div className="message-content">{message.text}</div>
  }

  return (
    <div
      className={`message-item ${message.role} ${message.status || ''} ${isProgressMessage ? 'progress-message' : ''} ${isFinalMessage ? 'final-message' : ''} ${isProgressExpanded ? 'progress-expanded' : ''} ${isProgressCollapsed ? 'progress-collapsed' : ''}`}
    >
      <div className="message-avatar">
        {isUser ? <User size={18} /> : <Bot size={18} />}
      </div>

      <div className="message-body">
        <div className="message-meta">
          {(isUser || isProgressMessage) && (
            <span className="message-role">
              {isUser ? t('message.roleUser') : reasoningTitle}
            </span>
          )}
          <span className="message-time">
            <Clock size={12} />
            {formatTime(message.timestamp)}
          </span>
        </div>

        <div className={`message-bubble ${isProgressExpanded ? 'progress-bubble-expanded' : ''}`}>
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
