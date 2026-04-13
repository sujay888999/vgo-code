import React, { useEffect, useRef, useState } from 'react'
import { useAppStore, type AttachmentItem } from '../store/appStore'
import { useI18n } from '../i18n'
import {
  Send,
  Paperclip,
  Square,
  FileText,
  Image as ImageIcon,
  Music4,
  Video,
  File,
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

function getAttachmentIcon(file: AttachmentItem) {
  if (file.mediaType === 'image') return <ImageIcon size={12} />
  if (file.mediaType === 'audio') return <Music4 size={12} />
  if (file.mediaType === 'video') return <Video size={12} />
  if (file.isText) return <FileText size={12} />
  return <File size={12} />
}

function inferClipboardImageName(file: File) {
  const extension = file.type.split('/')[1] || 'png'
  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png'
  return `clipboard-image-${Date.now()}.${safeExtension}`
}

function readClipboardImage(file: File): Promise<AttachmentItem | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve(null)
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const imageBase64 = result.includes(',') ? result.split(',')[1] || '' : ''
      if (!imageBase64) {
        resolve(null)
        return
      }

      const name = file.name?.trim() || inferClipboardImageName(file)
      resolve({
        name,
        path: `clipboard://${name}`,
        size: file.size,
        isText: false,
        mediaType: 'image',
        imageBase64,
      })
    }
    reader.readAsDataURL(file)
  })
}

function buildAttachmentContext(items: AttachmentItem[], t: (key: string) => string) {
  if (!items.length) return ''

  return [
    '',
    '[Attachment Info]',
    ...items.map((file, index) => {
      const kindLabel =
        file.mediaType === 'image'
          ? t('attachment.image')
          : file.mediaType === 'audio'
            ? t('attachment.audio')
            : file.mediaType === 'video'
              ? t('attachment.video')
              : file.isText
                ? t('attachment.text')
                : t('attachment.file')
      const head = `${index + 1}. ${file.name} (${kindLabel}, ${formatFileSize(file.size)})`
      if (file.isText && file.content) {
        return `${head}\nPath: ${file.path}\nContent:\n${file.content}`
      }
      return `${head}\nPath: ${file.path}\nNote: Non-text attachment, process with multimodal support if available.`
    }),
  ].join('\n\n')
}

export function Composer() {
  const { t } = useI18n()
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

  const QUICK_TEMPLATES: QuickTemplate[] = [
    { id: 'analyze', icon: <Search size={14} />, label: t('template.analyze'), prompt: t('template.analyzePrompt') },
    { id: 'refactor', icon: <Code size={14} />, label: t('template.refactor'), prompt: t('template.refactorPrompt') },
    { id: 'debug', icon: <Bug size={14} />, label: t('template.debug'), prompt: t('template.debugPrompt') },
    { id: 'explain', icon: <BookOpen size={14} />, label: t('template.explain'), prompt: t('template.explainPrompt') },
    { id: 'test', icon: <Sparkles size={14} />, label: t('template.test'), prompt: t('template.testPrompt') },
  ]

  const [input, setInput] = useState('')
  const [showTemplates, setShowTemplates] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
  }, [input])

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  }, [])

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

  const handleSubmit = async () => {
    if (promptRunning) return
    if (!input.trim() && attachments.length === 0) return

    const currentAttachments = [...attachments]
    const promptText = input.trim() ? `${input.trim()}${buildAttachmentContext(currentAttachments)}` : buildAttachmentContext(currentAttachments)
    setInput('')
    setPromptRunning(true)
    setShowTemplates(false)

    try {
      await window.vgoDesktop?.submitPrompt?.({
        text: promptText,
        attachments: currentAttachments,
      })
      await pollLatestState()

      const maxPolls = 60
      let pollCount = 0
      let lastHistoryLength = 0
      let stableCount = 0

      pollIntervalRef.current = window.setInterval(async () => {
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
          if (pollIntervalRef.current) {
            window.clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
          }
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

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardItems = Array.from(event.clipboardData?.items || [])
    const imageFiles = clipboardItems
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file))

    if (!imageFiles.length) {
      return
    }

    event.preventDefault()

    const plainText = event.clipboardData?.getData('text/plain') || ''
    if (plainText) {
      setInput((current) => `${current}${plainText}`)
    }

    const imageAttachments = (
      await Promise.all(imageFiles.map((file) => readClipboardImage(file)))
    ).filter((item): item is AttachmentItem => Boolean(item))

    if (imageAttachments.length) {
      addAttachments(imageAttachments)
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

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !promptRunning && vgoAILoggedIn

  return (
    <div className="composer">
      <div className="permission-bar">
        <div className="permission-group">
          <span className="permission-label">{t('composer.permission')}</span>
          <button
            className={`permission-button ${permissionMode === 'workload-only' ? 'active' : ''}`}
            onClick={() => void handlePermissionModeChange('workload-only')}
            title={t('composer.defaultTitle')}
          >
            <Lock size={14} />
            <span>{t('composer.default')}</span>
          </button>
          <button
            className={`permission-button ${permissionMode === 'full' ? 'active' : ''}`}
            onClick={() => void handlePermissionModeChange('full')}
            title={t('composer.fullAccessTitle')}
          >
            <Unlock size={14} />
            <span>{t('composer.fullAccess')}</span>
          </button>
        </div>

        <div className="permission-divider" />

        <div className="permission-group">
          <span className="permission-label">{t('composer.scope')}</span>
          <button
            className={`permission-button ${accessScope === 'workspace-only' ? 'active' : ''}`}
            onClick={() => void handleAccessScopeChange('workspace-only')}
            title={t('composer.workspaceTitle')}
          >
            <FolderOpen size={14} />
            <span>{t('composer.workspace')}</span>
          </button>
          <button
            className={`permission-button ${accessScope === 'workspace-and-desktop' ? 'active' : ''}`}
            onClick={() => void handleAccessScopeChange('workspace-and-desktop')}
            title={t('composer.workspaceDesktopTitle')}
          >
            <Globe size={14} />
            <span>{t('composer.workspaceDesktop')}</span>
          </button>
          <button
            className={`permission-button ${accessScope === 'full-system' ? 'active' : ''}`}
            onClick={() => void handleAccessScopeChange('full-system')}
            title={t('composer.globalTitle')}
          >
            <Globe size={14} />
            <span>{t('composer.global')}</span>
          </button>
        </div>
      </div>

      <div className="composer-toolbar">
        <div className="template-buttons">
          <button
            className={`toolbar-button ${showTemplates ? 'active' : ''}`}
            onClick={() => setShowTemplates(!showTemplates)}
            title={t('composer.templates')}
          >
            <Zap size={16} />
            <span>{t('composer.templates')}</span>
          </button>

          <button className="toolbar-button" onClick={() => void handleAttachFiles()} title={t('composer.addAttachment')}>
            <Paperclip size={16} />
            <span>{t('composer.attach')}</span>
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
              {getAttachmentIcon(file)}
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
          placeholder={vgoAILoggedIn ? t('composer.placeholder') : t('composer.loginRequired')}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={(event) => void handlePaste(event)}
          disabled={!vgoAILoggedIn}
          rows={1}
        />

        <div className="composer-actions">
          {promptRunning ? (
            <button className="stop-button" onClick={handleStop} title={t('composer.stop')}>
              <Square size={18} />
            </button>
          ) : (
            <button
              className={`send-button ${canSend ? 'ready' : ''}`}
              onClick={() => void handleSubmit()}
              disabled={!canSend}
              title={t('composer.send')}
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="composer-hint">
        <span>Shift + Enter {t('composer.newLine')}</span>
        <span>·</span>
        <span>{t('composer.enterToSend')}</span>
      </div>
    </div>
  )
}
