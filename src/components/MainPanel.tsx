import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { useAppStore } from '../store/appStore'
import { useI18n } from '../i18n'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { PermissionCard } from './PermissionCard'

export function MainPanel() {
  const { t } = useI18n()
  const {
    activeSessionId,
    messages,
    taskSteps,
    promptRunning,
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
    const isManualCloudProfile = Boolean(activeProfile && activeProfile.id !== 'default' && !isLocalProfile)

    if (activeProfile && (isLocalProfile || isManualCloudProfile || !isCloudEngineSelected)) {
      return {
        name: activeProfile.model || activeProfile.name || t('mainPanel.noModelSelected'),
        provider: isLocalProfile
          ? runtimeProviderLabel || 'Local LLM via Ollama'
          : activeProfile.provider || runtimeProviderLabel || 'Custom Cloud',
      }
    }

    const cloudModel = modelCatalog.find((model) => model.id === vgoAIPreferredModel)
    return {
      name: cloudModel?.label || vgoAIPreferredModel || t('mainPanel.noModelSelected'),
      provider: runtimeProviderLabel || t('mainPanel.cloudBadge'),
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

  // Live status indicator — surfaces the most recent in-flight step so the user
  // can see exactly what the agent is doing (planning/thinking/running tools/etc).
  const liveStatus = useMemo(() => {
    if (!promptRunning) return null
    const inflight = [...taskSteps].reverse().find((s) =>
      ['planning', 'working', 'tool_running', 'permission_requested'].includes(s.state)
    ) || null
    if (!inflight) {
      return { state: 'working', title: t('task.thinking'), detail: '' }
    }
    return { state: inflight.state, title: inflight.title, detail: inflight.detail }
  }, [promptRunning, taskSteps, t])

  // Idle watchdog — if promptRunning stays true for > agent.promptIdleWatchdogMs
  // without a new step, force-resolve it so the UI doesn't appear stuck forever.
  useEffect(() => {
    if (!promptRunning) return
    const settings = useAppStore.getState().settings as {
      agent?: { promptIdleWatchdogMs?: number }
    } | undefined
    const idleMs = Math.max(30000, Number(settings?.agent?.promptIdleWatchdogMs) || 300000)
    const lastTs = taskSteps.reduce((max, s) => {
      const t = Number(s.timestamp) || 0
      return t > max ? t : max
    }, 0)
    const targetDelay = Date.now() - lastTs >= idleMs ? 1000 : idleMs - (Date.now() - lastTs)
    const timer = window.setTimeout(() => {
      const stillRunning = useAppStore.getState().promptRunning
      if (stillRunning) {
        useAppStore.getState().setPromptRunning(false)
      }
    }, Math.max(15000, targetDelay))
    return () => window.clearTimeout(timer)
  }, [promptRunning, taskSteps])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || !autoScroll) return

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    const shouldStick = followOutput || distanceFromBottom < 48

    if (shouldStick) {
      scrollToBottom()
    }
  }, [messages, taskSteps, promptRunning, autoScroll, followOutput, scrollToBottom])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || !autoScroll) return

    const observer = new ResizeObserver(() => {
      // Only re-scroll when user is already following output.
      // Observing only the container (not inner children) prevents
      // the reasoning-block's internal resize from bouncing the outer scroll.
      if (followOutput) {
        window.requestAnimationFrame(() => {
          const c = scrollRef.current
          if (!c) return
          c.scrollTop = c.scrollHeight
        })
      }
    })

    observer.observe(container)
    // Do NOT observe container.firstElementChild — that causes the reasoning
    // panel's height changes to trigger outer scroll jumps.

    return () => observer.disconnect()
  }, [autoScroll, followOutput])

  const sessionChangeRef = useRef(activeSessionId)
  useEffect(() => {
    if (!autoScroll) return
    if (sessionChangeRef.current !== activeSessionId) {
      sessionChangeRef.current = activeSessionId
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
            <span className="session-label">{t('mainPanel.sessionTab')}</span>
            {workspace && (
              <span className="workspace-indicator" title={workspace}>
                {workspace.split(/[/\\]/).pop()}
              </span>
            )}
          </div>
        </div>

        <div className="header-center">
          {currentModelBadge.name && (
            <div className="model-badge">
              {promptRunning && <span className="running-indicator" aria-label="thinking" />}
              <span className="model-name">{currentModelBadge.name}</span>
              {currentModelBadge.provider && (
                <span className="provider-name">{currentModelBadge.provider}</span>
              )}
              {promptRunning && (
                <span className="running-text">{liveStatus?.title || t('mainPanel.thinking') || '思考中'}</span>
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
              <div className="welcome-card welcome-card-conversation">
                <p className="welcome-kicker">{t('app.title')}</p>
                <h3>{t('welcome.cardTitle')}</h3>
                <p className="welcome-lead">
                  {t('welcome.cardLead')}
                </p>
                <div className="welcome-chips" aria-hidden="true">
                  <span className="welcome-chip">{t('welcome.chip1')}</span>
                  <span className="welcome-chip">{t('welcome.chip2')}</span>
                  <span className="welcome-chip">{t('welcome.chip3')}</span>
                </div>
                <p className="tip">{t('welcome.tip')}</p>
              </div>
            </div>
          )}
        </div>

        
      </div>

      <div className="composer-wrapper">
        <Composer />
      </div>
    </main>
  )
}
