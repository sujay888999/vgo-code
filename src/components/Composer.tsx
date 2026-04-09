import React, { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import {
  Send,
  Paperclip,
  Square,
  FileText,
  X,
  Zap,
  Search,
  Code,
  Bug,
  BookOpen,
  Sparkles,
  Globe,
  FolderOpen,
  Lock,
  Unlock,
} from 'lucide-react'

const QUICK_TEMPLATES = [
  { id: 'analyze', icon: <Search size={14} />, label: '分析代码', prompt: '请分析当前项目的代码结构和主要功能。' },
  { id: 'refactor', icon: <Code size={14} />, label: '重构代码', prompt: '请帮我重构以下代码，提升可读性和可维护性：\n' },
  { id: 'debug', icon: <Bug size={14} />, label: '调试问题', prompt: '我遇到了以下问题，请帮我调试：\n' },
  { id: 'explain', icon: <BookOpen size={14} />, label: '解释代码', prompt: '请解释以下代码的工作原理：\n' },
  { id: 'test', icon: <Sparkles size={14} />, label: '生成测试', prompt: '请为以下功能编写测试用例：\n' },
]

interface QuickTemplate {
  id: string
  icon: React.ReactNode
  label: string
  prompt: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function Composer() {
  const {
    promptRunning,
    setPromptRunning,
    enterToSend,
    attachments,
    addAttachments,
    removeAttachmentAt,
    clearAttachments,
    vgoAILoggedIn,
    hydrate,
    permissionMode,
    setPermissionMode,
    accessScope,
    setAccessScope,
  } = useAppStore()

  const [input, setInput] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
  }, [input])

  const pollLatestState = async () => {
    try {
      const state = await window.vgoDesktop?.getState?.()
      if (state) hydrate(state)
      return state
    } catch (error) {
      console.error('Error polling state:', error)
      return null
    }
  }

  const buildAttachmentContext = () => {
    if (!attachments.length) return ''

    return [
      '',
      '[附件信息]',
      ...attachments.map((file, index) => {
        const head = `${index + 1}. ${file.name} (${formatFileSize(file.size)})`
        if (file.isText && file.content) {
          return `${head}\n路径: ${file.path}\n内容:\n${file.content}`
        }
        return `${head}\n路径: ${file.path}\n说明: 非文本附件，请按该路径访问或处理。`
      }),
    ].join('\n\n')
  }

  const handleSubmit = async () => {
    if (!input.trim() || promptRunning) return

    const promptText = `${input.trim()}${buildAttachmentContext()}`
    setInput('')
    setPromptRunning(true)
    setShowTemplates(false)

    try {
      await window.vgoDesktop?.submitPrompt?.(promptText)
      await pollLatestState()

      const maxPolls = 60
      let pollCount = 0
      let lastHistoryLength = 0
      let stableCount = 0

      const pollInterval = window.setInterval(async () => {
        pollCount += 1
        const state = await pollLatestState()
        const currentHistoryLength = state?.history?.length || 0

        if (currentHistoryLength === lastHistoryLength && lastHistoryLength > 0) {
          stableCount += 1
        } else {
          stableCount = 0
          lastHistoryLength = currentHistoryLength
        }

        if (stableCount >= 3 || pollCount >= maxPolls) {
          window.clearInterval(pollInterval)
          setPromptRunning(false)
          clearAttachments()
        }
      }, 1000)
    } catch (error) {
      console.error('Error submitting prompt:', error)
      setPromptRunning(false)
    }
  }

  const handleStop = () => {
    void window.vgoDesktop?.stopPrompt?.()
    setPromptRunning(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey && enterToSend) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  const handleTemplateClick = (template: QuickTemplate) => {
    setInput(template.prompt)
    setShowTemplates(false)
    textareaRef.current?.focus()
  }

  const handleAttachFiles = async () => {
    try {
      const files = (await window.vgoDesktop?.attachFile?.()) || []
      if (files.length) addAttachments(files)
    } catch (error) {
      console.error('Error attaching files:', error)
    }
  }

  const handlePermissionModeChange = async (mode: 'full' | 'workload-only') => {
    setPermissionMode(mode)
    try {
      await window.vgoDesktop?.updatePermissions?.({ mode })
    } catch (error) {
      console.error('Error updating permissions:', error)
    }
  }

  const handleAccessScopeChange = async (
    scope: 'workspace-only' | 'workspace-and-desktop' | 'full-system',
  ) => {
    setAccessScope(scope)
    try {
      await window.vgoDesktop?.updateAccess?.({ scope })
    } catch (error) {
      console.error('Error updating access:', error)
    }
  }

  const handleRemoveAttachment = (index: number) => {
    void window.vgoDesktop?.removeAttachment?.(index)
    removeAttachmentAt(index)
  }

  const canSend = input.trim().length > 0 && !promptRunning && vgoAILoggedIn

  return (
    <div className="composer">
      <div className="permission-bar">
        <div className="permission-group">
          <span className="permission-label">权限:</span>
          <button
            className={`permission-button ${permissionMode === 'workload-only' ? 'active' : ''}`}
            onClick={() => void handlePermissionModeChange('workload-only')}
            title="默认权限"
          >
            <Lock size={14} />
            <span>默认</span>
          </button>
          <button
            className={`permission-button ${permissionMode === 'full' ? 'active' : ''}`}
            onClick={() => void handlePermissionModeChange('full')}
            title="完全访问权限"
          >
            <Unlock size={14} />
            <span>完全访问</span>
          </button>
        </div>

<div className="permission-divider" />

        <div className="permission-group">
          <span className="permission-label">范围:</span>
          <button
            className={`permission-button ${accessScope === 'workspace-only' ? 'active' : ''}`}
            onClick={() => void handleAccessScopeChange('workspace-only')}
            title="仅工作区"
          >
            <FolderOpen size={14} />
            <span>工作区</span>
          </button>
          <button
            className={`permission-button ${accessScope === 'workspace-and-desktop' ? 'active' : ''}`}
            onClick={() => void handleAccessScopeChange('workspace-and-desktop')}
            title="工作区和桌面"
          >
            <Globe size={14} />
            <span>工作区 + 桌面</span>
          </button>
          <button
            className={`permission-button ${accessScope === 'full-system' ? 'active' : ''}`}
            onClick={() => void handleAccessScopeChange('full-system')}
            title="全局范围"
          >
            <Globe size={14} />
            <span>全局</span>
          </button>
        </div>
      </div>

      <div className="composer-toolbar">
        <div className="template-buttons">
          <button
            className={`toolbar-button ${showTemplates ? 'active' : ''}`}
            onClick={() => setShowTemplates(!showTemplates)}
            title="快捷模板"
          >
            <Zap size={16} />
            <span>模板</span>
          </button>

          <button className="toolbar-button" onClick={() => void handleAttachFiles()} title="添加附件">
            <Paperclip size={16} />
            <span>附件</span>
          </button>
        </div>

        {showTemplates && (
          <div className="template-dropdown">
            {QUICK_TEMPLATES.map((template) => (
              <button
                key={template.id}
                className="template-item"
                onClick={() => handleTemplateClick(template)}
              >
                {template.icon}
                <span>{template.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {attachments.length > 0 && (
        <div className="attachments-bar">
          {attachments.map((file, index) => (
            <div key={`${file.path}-${index}`} className="attachment-chip">
              <FileText size={12} />
              <span className="attachment-name" title={file.path}>
                {file.name}
              </span>
              <span className="attachment-size">{formatFileSize(file.size)}</span>
              <button className="attachment-remove" onClick={() => handleRemoveAttachment(index)}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="composer-input-wrapper">
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          placeholder={vgoAILoggedIn ? '输入你的问题，按 Enter 发送…' : '请先登录 VGO AI 账号'}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!vgoAILoggedIn}
          rows={1}
        />

        <div className="composer-actions">
          {promptRunning ? (
            <button className="stop-button" onClick={handleStop} title="停止推理">
              <Square size={18} />
            </button>
          ) : (
            <button
              className={`send-button ${canSend ? 'ready' : ''}`}
              onClick={() => void handleSubmit()}
              disabled={!canSend}
              title="发送消息"
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="composer-hint">
        <span>Shift + Enter 换行</span>
        <span>·</span>
        <span>Enter 发送</span>
      </div>
    </div>
  )
}
