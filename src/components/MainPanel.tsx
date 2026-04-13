import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import { useI18n } from '../i18n'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { TaskPanel } from './TaskPanel'
import { PermissionCard } from './PermissionCard'
import { ChevronDown, ChevronUp } from 'lucide-react'

export function MainPanel() {
  const { t } = useI18n()
  const {
    activeSessionId,
    messages,
    taskSteps,
    promptRunning,
    showTaskPanel,
    taskPanelCollapsed,
    toggleTaskPanelCollapsed,
    vgoAILoggedIn,
    vgoAIPreferredModel,
    modelCatalog,
    remoteProfiles,
    activeRemoteProfileId,
    runtimeEngineId,
    runtimeProviderLabel,
    contextStats,
    autoScroll,
    workspace,
    hydrate,
  } = useAppStore()

  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [followOutput, setFollowOutput] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const currentModelBadge = useMemo(() => {
    const activeProfile = remoteProfiles.find((profile) => profile.id === activeRemoteProfileId) || null
    const isCloudEngineSelected = runtimeEngineId === 'vgo-remote'
    const isLocalProfile = activeProfile?.provider === 'Ollama'

    if (activeProfile && (isLocalProfile || !isCloudEngineSelected)) {
      return {
        name: activeProfile.model || activeProfile.name || t('mainPanel.noModelSelected'),
        provider: runtimeProviderLabel || 'Local LLM via Ollama',
      }
    }

    const cloudModel = modelCatalog.find((model) => model.id === vgoAIPreferredModel)
    return {
      name: cloudModel?.label || vgoAIPreferredModel || t('mainPanel.noModelSelected'),
      provider: runtimeProviderLabel || 'VGO AI Cloud',
    }
  }, [
    remoteProfiles,
    activeRemoteProfileId,
    runtimeEngineId,
    modelCatalog,
    vgoAIPreferredModel,
    runtimeProviderLabel,
    t,
  ])

  const scrollToBottom = useCallback(() => {
    const container = scrollRef.current
    if (!container || !autoScroll) return

    window.requestAnimationFrame(() => {
      const nextContainer = scrollRef.current
      if (!nextContainer) return
      nextContainer.scrollTop = nextContainer.scrollHeight
    })
  }, [autoScroll])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || !autoScroll) return

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    const shouldStick = followOutput || distanceFromBottom < 48

    if (shouldStick) {
      scrollToBottom()
      if (!followOutput) setFollowOutput(true)
    }
  }, [messages, taskSteps, promptRunning, autoScroll, followOutput, scrollToBottom])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || !autoScroll) return

    const observer = new ResizeObserver(() => {
      if (followOutput) {
        scrollToBottom()
      }
    })

    observer.observe(container)
    const content = container.firstElementChild
    if (content instanceof HTMLElement) {
      observer.observe(content)
    }

    return () => observer.disconnect()
  }, [autoScroll, followOutput, scrollToBottom])

  useEffect(() => {
    if (autoScroll) {
      setFollowOutput(true)
      scrollToBottom()
    }
  }, [autoScroll, activeSessionId, scrollToBottom])

  const handleScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container || !autoScroll) return

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight

    if (distanceFromBottom > 64 && followOutput) {
      setFollowOutput(false)
      return
    }

    if (distanceFromBottom <= 32 && !followOutput) {
      setFollowOutput(true)
    }
  }, [autoScroll, followOutput])

  const handleCreateSession = useCallback(async () => {
    try {
      const result = await window.vgoDesktop?.createSession?.()
      if (result?.state) hydrate(result.state)
    } catch (error) {
      console.error('Failed to create session:', error)
    }
  }, [hydrate])

  const copyMessage = useCallback((id: string, text: string) => {
    void navigator.clipboard.writeText(text)
    setCopiedId(id)
    window.setTimeout(() => setCopiedId(null), 1800)
  }, [])

  const pendingPermissionStep =
    [...taskSteps]
      .reverse()
      .find((step) => step.state === 'permission_requested' && step.requestId) || null

  if (!activeSessionId) {
    return (
      <main className="main-panel empty">
        <div className="empty-state">
          <div className="empty-icon">
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <h2>{t('mainPanel.startNewChat')}</h2>
          <p>{t('mainPanel.tip')}</p>
          <button className="primary-button" onClick={handleCreateSession}>
            {t('sidebar.newChat')}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="main-panel">
      <header className="main-header">
        <div className="header-left">
          <div className="session-info">
            <span className="session-label">会话</span>
            {workspace && (
              <span className="workspace-indicator" title={workspace}>
                {workspace.split(/[/\\]/).pop()}
              </span>
            )}
          </div>
        </div>

        <div className="header-center">
          {vgoAILoggedIn && (
            <div className="model-badge">
              <span className="model-name">{currentModelBadge.name}</span>
              {currentModelBadge.provider && (
                <span className="provider-name">{currentModelBadge.provider}</span>
              )}
            </div>
          )}
        </div>

        <div className="header-right">
          {contextStats.estimatedTokens > 0 && (
            <div
              className="context-meter"
              title={`${contextStats.estimatedTokens} / ${contextStats.thresholdTokens} tokens`}
            >
              <div className="context-bar">
                <div
                  className="context-fill"
                  style={{
                    width: `${Math.min(
                      100,
                      (contextStats.estimatedTokens / contextStats.thresholdTokens) * 100,
                    )}%`,
                  }}
                />
              </div>
              <span className="context-label">{contextStats.estimatedTokens}</span>
            </div>
          )}


        </div>
      </header>

      <div className="content-area">
        <div className="messages-container" ref={scrollRef} onScroll={handleScroll}>
          <MessageList messages={messages} onCopy={copyMessage} copiedId={copiedId} />
          {pendingPermissionStep && <PermissionCard step={pendingPermissionStep} />}

          {messages.length === 0 && (
            <div className="welcome-messages">
              <div className="welcome-card">
                <h3>欢迎使用 VGO Code</h3>
                <p>我可以帮你推进这些工作：</p>
                <ul>
                  <li>分析和编写代码</li>
                  <li>重构和优化现有实现</li>
                  <li>排查错误与稳定性问题</li>
                  <li>解释项目结构和关键逻辑</li>
                  <li>生成测试、脚本和说明文档</li>
                </ul>
                <p className="tip">输入一个任务，或使用下方输入框快速开始。</p>
              </div>
            </div>
          )}
        </div>

        {showTaskPanel && (
          <div className={`task-panel-wrapper ${taskPanelCollapsed ? 'collapsed' : ''}`}>
            <div className="task-panel-header">
              <span>{t('mainPanel.taskPanel')}</span>
              <button
                className="icon-button"
                onClick={toggleTaskPanelCollapsed}
                title={taskPanelCollapsed ? t('mainPanel.expandPanel') : t('mainPanel.collapsePanel')}
              >
                {taskPanelCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </button>
            </div>
            {!taskPanelCollapsed && <TaskPanel steps={taskSteps} />}
          </div>
        )}
      </div>

      <div className="composer-wrapper">
        <Composer />
      </div>
    </main>
  )
}
