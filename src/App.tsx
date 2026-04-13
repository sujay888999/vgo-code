import React, { useEffect, useState } from 'react'
import { useI18n } from './i18n'
import { useAppStore } from './store/appStore'
import { useI18n, setI18nLocale } from './i18n'
import { Sidebar } from './components/Sidebar'
import { MainPanel } from './components/MainPanel'
import { SettingsModal } from './components/SettingsModal'
import { RenameModal } from './components/RenameModal'
import { UpdateNotification } from './components/UpdateNotification'

const LIVE_MESSAGE_PREFIX = 'live-assistant-'
const FINAL_MESSAGE_PREFIX = 'final-assistant-'

function buildLiveMessageId(sessionId?: string) {
  return `${LIVE_MESSAGE_PREFIX}${sessionId || 'active'}`
}

function buildFinalMessageId(sessionId?: string) {
  return `${FINAL_MESSAGE_PREFIX}${sessionId || 'active'}`
}

function appendUniqueBlock(currentText: string, nextBlock: string) {
  const normalizedCurrent = String(currentText || '').trim()
  const normalizedNext = String(nextBlock || '').trim()

  if (!normalizedNext) return normalizedCurrent
  if (!normalizedCurrent) return normalizedNext
  if (normalizedCurrent.includes(normalizedNext)) return normalizedCurrent

  return `${normalizedCurrent}\n\n${normalizedNext}`.trim()
}

function buildLiveProgressBlock(eventType: string, payload: any, t: (key: string) => string) {
  if (eventType === 'task_status') {
    if (payload?.message) return payload.message
    if (payload?.detail) return payload.detail
  }

  if (eventType === 'plan') {
    const steps = Array.isArray(payload?.steps) ? payload.steps.filter(Boolean) : []
    return [payload?.summary || t('task.plan'), ...steps.map((step: string) => `- ${step}`)]
      .filter(Boolean)
      .join('\n')
  }

  if (eventType === 'workflow_selected') {
    return payload?.detail || (payload?.label ? `${t('task.workflowSwitched')} ${payload.label}` : '')
  }

  if (eventType === 'workflow_probe') {
    return payload?.detail || t('task.probeComplete')
  }

  if (eventType === 'tool_result') {
    const summary = payload?.summary || payload?.output || ''
    return `${payload?.ok ? t('tool.completed') : t('tool.failed')}: ${payload?.tool || 'unknown'}${summary ? `\n${summary}` : ''}`
  }

  if (eventType === 'permission_requested') {
    return `${t('permission.waiting')}: ${payload?.tool || 'unknown'}${payload?.detail ? `\n${payload.detail}` : ''}`
  }

  if (eventType === 'permission_granted') {
    return `${t('permission.granted')}${payload?.tool ? `: ${payload.tool}` : ''}`
  }

  if (eventType === 'permission_denied') {
    return `${t('permission.denied')}${payload?.tool ? `: ${payload.tool}` : ''}`
  }

  if (eventType === 'capability_gap' || eventType === 'skill_suggestions') {
    return payload?.detail || ''
  }

  return ''
}

function getTaskCopy(status?: string, payload?: any, t: (key: string) => string = (k: string) => k) {
  switch (status) {
    case 'planning':
      return {
        title: t('task.planningTitle'),
        detail: payload?.message || t('task.analyzing'),
        state: 'planning' as const,
      }
    case 'thinking':
      return {
        title: t('task.thinking'),
        detail: payload?.message || t('task.thinkingContext'),
        state: 'working' as const,
      }
    case 'continuing':
      return {
        title: t('task.continuing'),
        detail: payload?.message || t('task.continuingDetail'),
        state: 'working' as const,
      }
    case 'tool_running':
      return {
        title: payload?.message || t('task.running'),
        detail: payload?.detail || '',
        state: 'working' as const,
      }
    case 'retrying':
    case 'fallback_model':
      return {
        title: payload?.message || t('task.switching'),
        detail: payload?.detail || t('task.switchingDetail'),
        state: 'working' as const,
      }
    case 'completed':
      return {
        title: payload?.message || t('task.completed'),
        detail: payload?.detail || '',
        state: 'completed' as const,
      }
    case 'error':
    case 'failed':
      return {
        title: payload?.message || t('task.error'),
        detail: payload?.detail || '',
        state: 'error' as const,
      }
    default:
      return null
  }
}

export function App() {
  const {
    settingsOverlayOpen,
    renameOverlayOpen,
    activeSessionId,
    hydrate,
    setPromptRunning,
    addMessage,
    updateMessage,
    addTaskStep,
    updateTaskStep,
    settleTaskSteps,
    theme,
    compactMode,
    uiMode,
  } = useAppStore()
  const { locale: i18nLocale } = useI18n()
  const [localeKey, setLocaleKey] = useState(0)
  const [updateNotificationOpen, setUpdateNotificationOpen] = useState(false)
  
  useEffect(() => {
    setLocaleKey(k => k + 1)
  }, [i18nLocale])

  useEffect(() => {
    const handleUpdateAvailable = () => {
      setUpdateNotificationOpen(true)
    }
    window.addEventListener('vgoUpdateAvailable', handleUpdateAvailable)
    return () => {
      window.removeEventListener('vgoUpdateAvailable', handleUpdateAvailable)
    }
  }, [])

  useEffect(() => {
    const classes = [theme, `mode-${uiMode}`]
    if (compactMode) classes.push('compact')
    document.body.className = classes.join(' ')
  }, [theme, compactMode, uiMode])

  useEffect(() => {
    const loadInitialState = async () => {
      try {
        const state = await window.vgoDesktop?.getState?.()
        if (state) {
          hydrate(state)
          if (state.settings?.localization?.locale) {
            setI18nLocale(state.settings.localization.locale)
          }
        }
      } catch (error) {
        console.error('Failed to load initial state:', error)
      }
    }

    void loadInitialState()
  }, [hydrate])

  useEffect(() => {
    const handleAgentEvent = (e: Event) => {
      const { t } = useI18n.getState()
      const payload = (e as CustomEvent).detail || {}
      const eventType = payload.type || payload.event
      const status = payload.status
      const timestamp = Date.now()
      const liveMessageId = buildLiveMessageId(payload.sessionId || activeSessionId || undefined)
      const finalMessageId = buildFinalMessageId(payload.sessionId || activeSessionId || undefined)

      const upsertLiveMessage = (text: string, nextStatus: 'loading' | 'done' | 'error' = 'loading') => {
        if (!text.trim()) return

        const existing = useAppStore
          .getState()
          .messages.find((message) => message.id === liveMessageId)

        if (existing) {
          updateMessage(liveMessageId, {
            text,
            status: nextStatus,
            timestamp,
            kind: 'progress',
            title: t('message.reasoning'),
          })
          return
        }

        addMessage({
          id: liveMessageId,
          role: 'assistant',
          text,
          status: nextStatus,
          timestamp,
          kind: 'progress',
          title: t('message.reasoning'),
          collapsed: false,
        })
      }

      const upsertFinalMessage = (text: string, nextStatus: 'loading' | 'done' | 'error' = 'done') => {
        if (!text.trim()) return

        const existing = useAppStore
          .getState()
          .messages.find((message) => message.id === finalMessageId)

        if (existing) {
          updateMessage(finalMessageId, {
            text,
            status: nextStatus,
            timestamp,
            kind: 'final',
            title: t('message.finalResult'),
          })
          return
        }

        addMessage({
          id: finalMessageId,
          role: 'assistant',
          text,
          status: nextStatus,
          timestamp,
          kind: 'final',
          title: t('message.finalResult'),
        })
      }

      const settleLiveMessage = (nextStatus: 'done' | 'error') => {
        const existing = useAppStore
          .getState()
          .messages.find((message) => message.id === liveMessageId)

        if (!existing?.text) return

        updateMessage(liveMessageId, {
          status: nextStatus,
          timestamp,
          kind: 'progress',
          title: t('message.reasoning'),
          collapsed: true,
        })
      }

      const finalizeLiveMessage = (finalText: string, nextStatus: 'done' | 'error') => {
        const existing = useAppStore
          .getState()
          .messages.find((message) => message.id === liveMessageId)
        const text = appendUniqueBlock(existing?.text || '', finalText)

        if (!text.trim()) return

        if (existing) {
          updateMessage(liveMessageId, {
            text,
            status: nextStatus,
            timestamp,
            kind: 'progress',
            title: t('message.reasoning'),
            collapsed: true,
          })
          return
        }

        addMessage({
          id: liveMessageId,
          role: 'assistant',
          text,
          status: nextStatus,
          timestamp,
          kind: 'progress',
          title: t('message.reasoning'),
          collapsed: true,
        })
      }

      const upsertTaskStep = (
        id: string,
        step: {
          title: string
          detail: string
          state: 'idle' | 'planning' | 'working' | 'completed' | 'error' | 'permission_requested' | 'permission_granted' | 'permission_denied'
          requestId?: string
          tool?: string
        },
      ) => {
        const existing = useAppStore.getState().taskSteps.find((item) => item.id === id)
        if (existing) {
          updateTaskStep(id, {
            ...step,
            timestamp,
          })
          return
        }

        addTaskStep({
          id,
          timestamp,
          ...step,
        })
      }

      const progressBlock = buildLiveProgressBlock(eventType, payload, t)
      const currentLiveText =
        useAppStore.getState().messages.find((message) => message.id === liveMessageId)?.text || ''

      if (eventType === 'task_status') {
        const taskCopy = getTaskCopy(status, payload, t)
        if (taskCopy) {
          if (status === 'planning') {
            upsertLiveMessage(progressBlock || payload?.message || t('task.analyzing'), 'loading')
            upsertTaskStep('task-status-running', {
              title: taskCopy.title,
              detail: taskCopy.detail,
              state: taskCopy.state,
            })
          }

          if (
            status === 'thinking' ||
            status === 'continuing' ||
            status === 'tool_running' ||
            status === 'retrying' ||
            status === 'fallback_model'
          ) {
            upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
            upsertTaskStep(status === 'planning' ? 'task-status-planning' : 'task-status-running', {
              title: taskCopy.title,
              detail: taskCopy.detail,
              state: taskCopy.state,
            })
          }

          if (status === 'completed') {
            settleTaskSteps('completed')
            setPromptRunning(false)
            upsertTaskStep('task-status-final', {
              title: taskCopy.title,
              detail: taskCopy.detail,
              state: taskCopy.state,
            })
            finalizeLiveMessage(progressBlock || payload?.message || t('task.done'), 'done')
          }

          if (status === 'error' || status === 'failed') {
            settleTaskSteps('error')
            setPromptRunning(false)
            upsertTaskStep('task-status-final', {
              title: taskCopy.title,
              detail: taskCopy.detail,
              state: taskCopy.state,
            })
            finalizeLiveMessage(progressBlock || payload?.message || t('task.failed'), 'error')
          }
        }
      }

      if (eventType === 'permission_requested') {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        addTaskStep({
          id: payload.requestId || `perm-${timestamp}`,
          requestId: payload.requestId,
          tool: payload.tool || 'unknown_tool',
          title: `${t('permission.request')} · ${payload.tool || t('permission.unknown')}`,
          detail: payload.detail || '',
          state: 'permission_requested',
          timestamp,
        })
      }

      if (eventType === 'permission_granted' && payload.requestId) {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        updateTaskStep(payload.requestId, {
          state: 'permission_granted',
          detail: payload.detail || '已授权，继续执行。',
        })
      }

      if (eventType === 'permission_denied' && payload.requestId) {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'error')
        updateTaskStep(payload.requestId, {
          state: 'permission_denied',
          detail: payload.detail || '已拒绝本次操作。',
        })
      }

      if (eventType === 'plan') {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        upsertTaskStep('task-plan', {
          title: payload.summary || '执行计划',
          detail: Array.isArray(payload.steps) ? payload.steps.join('\n') : '',
          state: 'planning',
        })
      }

      if (eventType === 'workflow_selected') {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        upsertTaskStep('task-workflow', {
          title: payload.label ? `工作流 · ${payload.label}` : '工作流已切换',
          detail: payload.detail || '',
          state: 'planning',
        })
      }

      if (eventType === 'workflow_probe') {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        upsertTaskStep('task-probe', {
          title: '前置检查',
          detail: payload.detail || '',
          state: 'working',
        })
      }

      if (eventType === 'capability_gap') {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'error')
        upsertTaskStep('task-gap', {
          title: '能力缺口',
          detail: payload.detail || '',
          state: 'error',
        })
      }

      if (eventType === 'skill_suggestions') {
        const skills = Array.isArray(payload.skills) ? payload.skills : []
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        upsertTaskStep('task-skills', {
          title: 'Skill 建议',
          detail:
            payload.detail ||
            skills.map((skill) => `${skill.name} · ${skill.path}`).join('\n') ||
            '未找到匹配的本机 skill',
          state: skills.length ? 'completed' : 'error',
        })
      }

      if (eventType === 'model_response' && payload.text) {
        settleLiveMessage('done')
        setPromptRunning(false)
        upsertFinalMessage(payload.text, 'done')
      }

      if (eventType === 'model_stream_delta' && payload.text) {
        if (payload.done) {
          settleLiveMessage('done')
          setPromptRunning(false)
          upsertFinalMessage(payload.text, 'done')
        } else {
          upsertFinalMessage(payload.text, 'loading')
        }
      }

      if (eventType === 'tool_result') {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        addTaskStep({
          id: `tool-result-${timestamp}`,
          title: `${payload.tool || '工具'}结果`,
          detail: payload.summary || payload.output || '',
          state: payload.ok ? 'completed' : 'error',
          timestamp,
        })
      }

      if (eventType === 'verification') {
        addTaskStep({
          id: `verify-${timestamp}`,
          title: payload.detail || '结果复核',
          detail: '',
          state: payload.status === 'passed' ? 'completed' : 'working',
          timestamp,
        })
      }
    }

    window.addEventListener('vgoAgentEvent', handleAgentEvent)

    const pollInterval = window.setInterval(async () => {
      try {
        const state = await window.vgoDesktop?.getState?.()
        if (state) hydrate(state)
      } catch {
        // ignore polling errors
      }
    }, 3000)

    return () => {
      window.removeEventListener('vgoAgentEvent', handleAgentEvent)
      window.clearInterval(pollInterval)
    }
  }, [activeSessionId, hydrate, setPromptRunning, addMessage, updateMessage, addTaskStep, updateTaskStep, settleTaskSteps])

  useEffect(() => {
    const handleStateRefresh = (e: Event) => {
      const state = (e as CustomEvent).detail
      if (state) hydrate(state)
    }

    window.addEventListener('vgoStateRefresh', handleStateRefresh)

    return () => {
      window.removeEventListener('vgoStateRefresh', handleStateRefresh)
    }
  }, [hydrate])

  return (
    <div className="layout">
      <Sidebar key={`sidebar-${localeKey}`} />
      <MainPanel key={`mainpanel-${localeKey}`} />
      {settingsOverlayOpen && <SettingsModal key={`settings-${localeKey}`} />}
      {renameOverlayOpen && <RenameModal key={`rename-${localeKey}`} />}
      {updateNotificationOpen && (
        <UpdateNotification onClose={() => setUpdateNotificationOpen(false)} />
      )}
    </div>
  )
}
