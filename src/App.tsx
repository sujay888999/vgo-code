import React, { useEffect, useRef, useState } from 'react'
import { useI18n, setI18nLocale } from './i18n'
import { useAppStore } from './store/appStore'
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

function looksLikeMojibake(text: string) {
  const sample = String(text || '')
  if (!sample) return false
  const weirdMatches = sample.match(/[娴ｉ幋鐠囬弬鍥︽瀹告彃寮張顏呮閸掗梻顔藉灉]/g) || []
  return weirdMatches.length >= 3
}

function tryRecoverMojibake(text: string) {
  const source = String(text || '')
  if (!source || !looksLikeMojibake(source)) return source
  try {
    const bytes = Uint8Array.from(Array.from(source).map((char) => char.charCodeAt(0) & 0xff))
    const recovered = new TextDecoder('utf-8').decode(bytes)
    if (recovered && !looksLikeMojibake(recovered)) {
      return recovered
    }
  } catch {
    // noop
  }
  return source
}

function normalizeEventPayload<T>(value: T): T {
  if (typeof value === 'string') {
    return tryRecoverMojibake(value) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeEventPayload(item)) as T
  }
  if (value && typeof value === 'object') {
    const normalized: Record<string, unknown> = {}
    Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
      normalized[key] = normalizeEventPayload(val)
    })
    return normalized as T
  }
  return value
}

function buildLiveProgressBlock(eventType: string, payload: any, t: (key: string) => string) {
  if (eventType === 'task_status') {
    const rawMessage = String(payload?.message || '').trim()
    const thinkingLikeMessage =
      /thinking|正在思考|轮推理|推理过程|姝ｅ湪鎬濊/i.test(rawMessage)
    if (payload?.status === 'thinking' || payload?.status === 'continuing') {
      if (!rawMessage || thinkingLikeMessage) {
        return t('task.thinking')
      }
    }
    if (rawMessage) return rawMessage
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
    const recovered = payload?.recovered === true
    if (recovered) {
      return `${t('tool.completed')}: ${payload?.tool || 'unknown'}（已自动切换备用方案）${summary ? `\n${summary}` : ''}`
    }
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
        title: payload?.message || '执行受阻，已尝试切换方案',
        detail: payload?.detail || '',
        state: 'warning' as const,
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
  const [updateNotificationOpen, setUpdateNotificationOpen] = useState(false)
  const seenEventIdsRef = useRef<Map<string, number>>(new Map())
  const lastEventSeqRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    seenEventIdsRef.current.clear()
    lastEventSeqRef.current.clear()
  }, [activeSessionId])

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
      const payload = normalizeEventPayload((e as CustomEvent).detail || {})
      const payloadSessionId = String(payload.sessionId || '').trim()
      if (payloadSessionId && activeSessionId && payloadSessionId !== activeSessionId) {
        return
      }

      const eventType = payload.type || payload.event
      const status = payload.status
      const timestamp = Date.now()
      const eventSessionId = payloadSessionId || activeSessionId || 'active'
      const liveMessageId = buildLiveMessageId(eventSessionId || undefined)
      const finalMessageId = buildFinalMessageId(eventSessionId || undefined)
      const eventSeq = Number(payload.eventSeq || 0)
      const lastSeq = lastEventSeqRef.current.get(eventSessionId) || 0
      if (eventSeq > 0 && eventSeq <= lastSeq) {
        return
      }
      if (eventSeq > 0) {
        lastEventSeqRef.current.set(eventSessionId, eventSeq)
      }

      const eventId =
        String(payload.eventId || '').trim() ||
        `${eventSessionId}:${eventSeq || 0}:${eventType || 'unknown'}:${payload.requestId || ''}:${payload.tool || ''}:${status || ''}:${payload.message || payload.detail || ''}`
      if (seenEventIdsRef.current.has(eventId)) {
        return
      }
      seenEventIdsRef.current.set(eventId, timestamp)
      if (seenEventIdsRef.current.size > 600) {
        const sorted = [...seenEventIdsRef.current.entries()].sort((a, b) => a[1] - b[1])
        const overflow = seenEventIdsRef.current.size - 500
        for (let index = 0; index < overflow; index += 1) {
          const key = sorted[index]?.[0]
          if (key) {
            seenEventIdsRef.current.delete(key)
          }
        }
      }

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

      const settleFinalMessage = (nextStatus: 'done' | 'error' | 'loading') => {
        const existing = useAppStore
          .getState()
          .messages.find((message) => message.id === finalMessageId)
        if (!existing) return

        updateMessage(finalMessageId, {
          status: nextStatus,
          timestamp,
          kind: 'final',
          title: t('message.finalResult'),
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
          state:
            | 'idle'
            | 'planning'
            | 'working'
            | 'completed'
            | 'warning'
            | 'error'
            | 'permission_requested'
            | 'permission_granted'
            | 'permission_denied'
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
          if (
            status === 'planning' ||
            status === 'thinking' ||
            status === 'continuing' ||
            status === 'tool_running' ||
            status === 'retrying' ||
            status === 'fallback_model'
          ) {
            setPromptRunning(true)
          }

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
            upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock || taskCopy.detail), 'loading')
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
            settleTaskSteps('warning')
            setPromptRunning(false)
            upsertTaskStep('task-status-final', {
              title: taskCopy.title,
              detail: taskCopy.detail,
              state: taskCopy.state,
            })
            finalizeLiveMessage(progressBlock || payload?.message || t('task.failed'), 'done')
          }
        }
      }

      if (eventType === 'permission_requested') {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        upsertTaskStep(payload.requestId || `perm-${eventId}`, {
          requestId: payload.requestId,
          tool: payload.tool || 'unknown_tool',
          title: `${t('permission.request')}: ${payload.tool || t('permission.unknown')}`,
          detail: payload.detail || '',
          state: 'permission_requested',
        })
      }

      if (eventType === 'permission_granted' && payload.requestId) {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        updateTaskStep(payload.requestId, {
          state: 'permission_granted',
          detail: payload.detail || t('permission.granted'),
        })
      }

      if (eventType === 'permission_denied' && payload.requestId) {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'error')
        settleTaskSteps('error')
        setPromptRunning(false)
        updateTaskStep(payload.requestId, {
          state: 'permission_denied',
          detail: payload.detail || t('permission.denied'),
        })
      }

      if (eventType === 'plan') {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        upsertTaskStep('task-plan', {
          title: payload.summary || t('task.plan'),
          detail: Array.isArray(payload.steps) ? payload.steps.join('\n') : '',
          state: 'planning',
        })
      }

      if (eventType === 'workflow_selected') {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        upsertTaskStep('task-workflow', {
          title: payload.label ? `${t('agentTrace.workflow')}: ${payload.label}` : t('task.workflowSwitched'),
          detail: payload.detail || '',
          state: 'planning',
        })
      }

      if (eventType === 'workflow_probe') {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        upsertTaskStep('task-probe', {
          title: t('agentTrace.prerequisite'),
          detail: payload.detail || '',
          state: 'working',
        })
      }

      if (eventType === 'capability_gap') {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'error')
        upsertTaskStep('task-gap', {
          title: t('agentTrace.capabilityGap'),
          detail: payload.detail || '',
          state: 'error',
        })
      }

      if (eventType === 'skill_suggestions') {
        const skills = Array.isArray(payload.skills) ? payload.skills : []
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        upsertTaskStep('task-skills', {
          title: t('agentTrace.skillSuggestion'),
          detail:
            payload.detail ||
            skills.map((skill) => `${skill.name}: ${skill.path}`).join('\n') ||
            t('agentTrace.noMatchingSkill'),
          state: skills.length ? 'completed' : 'error',
        })
      }

      if (eventType === 'model_response') {
        settleLiveMessage('done')
        if (payload.text) {
          upsertFinalMessage(payload.text, 'done')
        } else {
          settleFinalMessage('done')
        }
        settleTaskSteps('completed')
        setPromptRunning(false)
      }

      if (eventType === 'model_stream_delta') {
        if (payload.done) {
          settleLiveMessage('done')
          if (payload.text) {
            upsertFinalMessage(payload.text, 'done')
          } else {
            settleFinalMessage('done')
          }
          settleTaskSteps('completed')
          setPromptRunning(false)
        } else if (payload.text) {
          setPromptRunning(true)
          upsertFinalMessage(payload.text, 'loading')
        }
      }

      if (eventType === 'tool_result') {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        setPromptRunning(true)
        const isRecovered = payload?.recovered === true
        addTaskStep({
          id: `tool-result-${eventId}`,
          title: `${payload.tool || t('agentTrace.tool')} ${t('agentTrace.result')}`,
          detail: payload.summary || payload.output || '',
          state: payload.ok ? 'completed' : isRecovered ? 'completed' : 'warning',
          timestamp,
        })
      }

      if (eventType === 'verification') {
        addTaskStep({
          id: `verify-${eventId}`,
          title: payload.detail || t('agentTrace.verification'),
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
      <Sidebar />
      <MainPanel />
      {settingsOverlayOpen && <SettingsModal />}
      {renameOverlayOpen && <RenameModal />}
      {updateNotificationOpen && (
        <UpdateNotification onClose={() => setUpdateNotificationOpen(false)} />
      )}
    </div>
  )
}
