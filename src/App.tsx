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

function buildLiveProgressBlock(eventType: string, payload: any, _t: (key: string) => string) {
  if (eventType === 'task_status') {
    const s = payload?.status
    if (s === 'thinking' || s === 'continuing' || s === 'planning') return ''
    if (s === 'retrying' || s === 'fallback_model') return '↻ 切换策略中...'
    const msg = String(payload?.message || payload?.detail || '').trim()
    return msg || ''
  }

  if (eventType === 'plan') {
    const steps = Array.isArray(payload?.steps) ? payload.steps.filter(Boolean) : []
    return steps.map((s: string) => `· ${s}`).join('\n')
  }

  if (eventType === 'workflow_selected') return ''
  if (eventType === 'workflow_probe') return ''

  if (eventType === 'tool_result') {
    const tool = String(payload?.tool || '').trim()
    const ok = payload?.ok !== false
    const recovered = payload?.recovered === true
    // Strip any "建议整改" remediation text that leaked into summary
    const rawSummary = String(payload?.summary || payload?.output || '').trim()
    const summary = rawSummary.replace(/\n?建议整改[：:][^\n]*/g, '').trim()
    const icon = ok ? '✓' : recovered ? '↻' : '✗'
    const line = `${icon} ${tool}${summary ? `  ${summary}` : ''}`
    return line
  }

  if (eventType === 'permission_requested') {
    return `⏸ 等待授权: ${payload?.tool || ''}${payload?.detail ? `  ${payload.detail}` : ''}`
  }
  if (eventType === 'permission_granted') return `✓ 已授权: ${payload?.tool || ''}`
  if (eventType === 'permission_denied') return `✗ 授权拒绝: ${payload?.tool || ''}`
  if (eventType === 'capability_gap') return payload?.detail ? `⚠ ${payload.detail}` : ''
  if (eventType === 'skill_suggestions') return ''

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

      // Single unified stream message — no separate progress bubble.
      // All tool logs, status updates, and final reply flow into one message.
      const getStream = () =>
        useAppStore.getState().messages.find((m) => m.id === finalMessageId)

      const upsertLiveMessage = (logLine: string, nextStatus: 'loading' | 'done' | 'error' = 'loading') => {
        if (!logLine.trim()) return
        const existing = getStream()
        const prev = existing?.logLines || []
        // Mark the last pending line as done, then push new line
        const updated = prev.map((l, i) =>
          i === prev.length - 1 && !l.done ? { ...l, done: true } : l
        )
        const newLines = [...updated, { text: logLine, done: false }]
        if (existing) {
          updateMessage(finalMessageId, { logLines: newLines, status: nextStatus, timestamp })
        } else {
          addMessage({ id: finalMessageId, role: 'assistant', text: '', logLines: newLines, status: nextStatus, timestamp, kind: 'stream' })
        }
      }

      const markLastLogDone = () => {
        const existing = getStream()
        if (!existing?.logLines?.length) return
        const updated = existing.logLines.map((l, i) =>
          i === existing.logLines!.length - 1 ? { ...l, done: true } : l
        )
        updateMessage(finalMessageId, { logLines: updated })
      }

      const upsertFinalMessage = (text: string, nextStatus: 'loading' | 'done' | 'error' = 'done') => {
        if (!text.trim()) return
        const existing = getStream()
        if (existing) {
          // Only update text — logText is preserved untouched
          updateMessage(finalMessageId, { text, status: nextStatus, timestamp, kind: 'final' })
        } else {
          addMessage({ id: finalMessageId, role: 'assistant', text, logText: '', status: nextStatus, timestamp, kind: 'final' })
        }
      }

      const settleLiveMessage = (_nextStatus: 'done' | 'error') => {
        markLastLogDone()
      }

      const settleFinalMessage = (nextStatus: 'done' | 'error' | 'loading') => {
        const existing = getStream()
        if (!existing) return
        updateMessage(finalMessageId, { status: nextStatus, timestamp, kind: 'final' })
      }

      const finalizeLiveMessage = (finalText: string, nextStatus: 'done' | 'error') => {
        markLastLogDone()
        const existing = getStream()
        // Append last log line to logLines if meaningful, mark done
        if (finalText.trim()) {
          const prev = existing?.logLines || []
          const newLines = [...prev, { text: finalText, done: true }]
          if (existing) {
            updateMessage(finalMessageId, { logLines: newLines, status: nextStatus, timestamp, kind: 'final' })
          } else {
            addMessage({ id: finalMessageId, role: 'assistant', text: '', logLines: newLines, status: nextStatus, timestamp, kind: 'final' })
          }
        } else if (existing) {
          updateMessage(finalMessageId, { status: nextStatus, timestamp, kind: 'final' })
        }
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
      // currentLiveText is no longer used (logLines replaced logText), kept for safety
      // const currentLiveText = ...

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
            // Don't show system template text — just keep stream alive
            const existing = getStream()
            if (existing) {
              updateMessage(finalMessageId, { status: 'loading', timestamp })
            } else {
              addMessage({ id: finalMessageId, role: 'assistant', text: '', logLines: [], status: 'loading', timestamp, kind: 'stream' })
            }
            upsertTaskStep('task-status-running', {
              title: taskCopy.title,
              detail: taskCopy.detail,
              state: taskCopy.state,
            })
          }

          if (status === 'thinking' || status === 'continuing') {
            const existing = getStream()
            if (existing) {
              updateMessage(finalMessageId, { status: 'loading', timestamp })
            } else {
              addMessage({ id: finalMessageId, role: 'assistant', text: '', logLines: [], status: 'loading', timestamp, kind: 'stream' })
            }
            upsertTaskStep('task-status-running', { title: taskCopy.title, detail: taskCopy.detail, state: taskCopy.state })
          }

          if (status === 'tool_running' || status === 'retrying' || status === 'fallback_model') {
            if (progressBlock) upsertLiveMessage(progressBlock, 'loading')
            upsertTaskStep('task-status-running', { title: taskCopy.title, detail: taskCopy.detail, state: taskCopy.state })
          }

          if (status === 'completed') {
            settleTaskSteps('completed')
            setPromptRunning(false)
            upsertTaskStep('task-status-final', {
              title: taskCopy.title,
              detail: taskCopy.detail,
              state: taskCopy.state,
            })
            // Mark last log done, don't append system text
            markLastLogDone()
            const existing = getStream()
            if (existing) updateMessage(finalMessageId, { status: 'done', timestamp, kind: 'final' })
          }

          if (status === 'error' || status === 'failed') {
            settleTaskSteps('warning')
            setPromptRunning(false)
            upsertTaskStep('task-status-final', {
              title: taskCopy.title,
              detail: taskCopy.detail,
              state: taskCopy.state,
            })
            markLastLogDone()
            const existing = getStream()
            if (existing) updateMessage(finalMessageId, { status: 'error', timestamp, kind: 'final' })
          }
        }
      }

      if (eventType === 'permission_requested') {
        if (progressBlock) upsertLiveMessage(progressBlock, 'loading')
        upsertTaskStep(payload.requestId || `perm-${eventId}`, {
          requestId: payload.requestId,
          tool: payload.tool || 'unknown_tool',
          title: `${t('permission.request')}: ${payload.tool || t('permission.unknown')}`,
          detail: payload.detail || '',
          state: 'permission_requested',
        })
      }

      if (eventType === 'permission_granted' && payload.requestId) {
        if (progressBlock) upsertLiveMessage(progressBlock, 'loading')
        updateTaskStep(payload.requestId, {
          state: 'permission_granted',
          detail: payload.detail || t('permission.granted'),
        })
      }

      if (eventType === 'permission_denied' && payload.requestId) {
        if (progressBlock) upsertLiveMessage(progressBlock, 'error')
        settleTaskSteps('error')
        setPromptRunning(false)
        updateTaskStep(payload.requestId, {
          state: 'permission_denied',
          detail: payload.detail || t('permission.denied'),
        })
      }

      if (eventType === 'plan') {
        if (progressBlock) upsertLiveMessage(progressBlock, 'loading')
        upsertTaskStep('task-plan', {
          title: payload.summary || t('task.plan'),
          detail: Array.isArray(payload.steps) ? payload.steps.join('\n') : '',
          state: 'planning',
        })
      }

      if (eventType === 'workflow_selected') {
        // workflow_selected returns '' from buildLiveProgressBlock, skip
        upsertTaskStep('task-workflow', {
          title: payload.label ? `${t('agentTrace.workflow')}: ${payload.label}` : t('task.workflowSwitched'),
          detail: payload.detail || '',
          state: 'planning',
        })
      }

      if (eventType === 'workflow_probe') {
        upsertTaskStep('task-probe', {
          title: t('agentTrace.prerequisite'),
          detail: payload.detail || '',
          state: 'working',
        })
      }

      if (eventType === 'capability_gap') {
        if (progressBlock) upsertLiveMessage(progressBlock, 'error')
        upsertTaskStep('task-gap', {
          title: t('agentTrace.capabilityGap'),
          detail: payload.detail || '',
          state: 'error',
        })
      }

      if (eventType === 'skill_suggestions') {
        const skills = Array.isArray(payload.skills) ? payload.skills : []
        upsertTaskStep('task-skills', {
          title: t('agentTrace.skillSuggestion'),
          detail:
            payload.detail ||
            skills.map((skill: any) => `${skill.name}: ${skill.path}`).join('\n') ||
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
        if (progressBlock) upsertLiveMessage(progressBlock, 'loading')
        setPromptRunning(true)

        // Detect file writes from tool name + extract path from summary/output
        const isWriteTool = /write_file|append_file|str_replace|create_file|patch/i.test(payload?.tool || '')
        if (isWriteTool && payload?.ok !== false) {
          // Path is typically in summary like "Wrote E:\...\file.ts" or "Created ..."
          const summaryText = String(payload?.summary || payload?.output || '')
          const pathMatch = summaryText.match(/(?:Wrote|Created|Updated|Patched)\s+(.+?)(?:\s+lines?|$)/i)
          const filePath = pathMatch?.[1]?.trim() || ''
          if (filePath) {
            const existing = getStream()
            const patches = [...(existing?.patches || []), { file: filePath, summary: '' }]
            if (existing) updateMessage(finalMessageId, { patches })
          }
        }

        addTaskStep({
          id: `tool-result-${eventId}`,
          title: `${payload.tool || t('agentTrace.tool')} ${t('agentTrace.result')}`,
          detail: payload.summary || payload.output || '',
          state: payload.ok ? 'completed' : payload?.recovered ? 'completed' : 'warning',
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
