import React, { useEffect } from 'react'
import { useAppStore } from './store/appStore'
import { Sidebar } from './components/Sidebar'
import { MainPanel } from './components/MainPanel'
import { SettingsModal } from './components/SettingsModal'
import { RenameModal } from './components/RenameModal'

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

function buildLiveProgressBlock(eventType: string, payload: any) {
  if (eventType === 'task_status') {
    if (payload?.message) return payload.message
    if (payload?.detail) return payload.detail
  }

  if (eventType === 'plan') {
    const steps = Array.isArray(payload?.steps) ? payload.steps.filter(Boolean) : []
    return [payload?.summary || '执行计划', ...steps.map((step: string) => `- ${step}`)]
      .filter(Boolean)
      .join('\n')
  }

  if (eventType === 'workflow_selected') {
    return payload?.detail || (payload?.label ? `已切换到 ${payload.label} 工作流` : '')
  }

  if (eventType === 'workflow_probe') {
    return payload?.detail || '已完成前置检查'
  }

  if (eventType === 'tool_result') {
    const summary = payload?.summary || payload?.output || ''
    return `${payload?.ok ? '工具已完成' : '工具失败'}: ${payload?.tool || 'unknown'}${summary ? `\n${summary}` : ''}`
  }

  if (eventType === 'permission_requested') {
    return `等待授权: ${payload?.tool || 'unknown'}${payload?.detail ? `\n${payload.detail}` : ''}`
  }

  if (eventType === 'permission_granted') {
    return `已授权继续执行${payload?.tool ? `: ${payload.tool}` : ''}`
  }

  if (eventType === 'permission_denied') {
    return `授权被拒绝${payload?.tool ? `: ${payload.tool}` : ''}`
  }

  if (eventType === 'capability_gap' || eventType === 'skill_suggestions') {
    return payload?.detail || ''
  }

  return ''
}

function getTaskCopy(status?: string, payload?: any) {
  switch (status) {
    case 'planning':
      return {
        title: '规划任务',
        detail: payload?.message || '正在分析需求并生成执行计划...',
        state: 'planning' as const,
      }
    case 'thinking':
      return {
        title: '思考中',
        detail: payload?.message || '正在整理上下文并请求模型响应...',
        state: 'working' as const,
      }
    case 'continuing':
      return {
        title: '继续处理',
        detail: payload?.message || '正在延续当前任务流并推进下一步...',
        state: 'working' as const,
      }
    case 'tool_running':
      return {
        title: payload?.message || '运行工具',
        detail: payload?.detail || '',
        state: 'working' as const,
      }
    case 'retrying':
    case 'fallback_model':
      return {
        title: payload?.message || '切换策略',
        detail: payload?.detail || '正在重试或切换可用模型链路...',
        state: 'working' as const,
      }
    case 'completed':
      return {
        title: payload?.message || '任务完成',
        detail: payload?.detail || '',
        state: 'completed' as const,
      }
    case 'error':
    case 'failed':
      return {
        title: payload?.message || '任务失败',
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

  useEffect(() => {
    const classes = [theme, `mode-${uiMode}`]
    if (compactMode) classes.push('compact')
    document.body.className = classes.join(' ')
  }, [theme, compactMode, uiMode])

  useEffect(() => {
    const loadInitialState = async () => {
      try {
        const state = await window.vgoDesktop?.getState?.()
        if (state) hydrate(state)
      } catch (error) {
        console.error('Failed to load initial state:', error)
      }
    }

    void loadInitialState()
  }, [hydrate])

  useEffect(() => {
    const handleAgentEvent = (e: Event) => {
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
            title: '推理过程',
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
          title: '推理过程',
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
            title: '最终结果',
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
          title: '最终结果',
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
          title: '推理过程',
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

      const progressBlock = buildLiveProgressBlock(eventType, payload)
      const currentLiveText =
        useAppStore.getState().messages.find((message) => message.id === liveMessageId)?.text || ''

      if (eventType === 'task_status') {
        const taskCopy = getTaskCopy(status, payload)
        if (taskCopy) {
          if (status === 'planning' || status === 'thinking' || status === 'continuing' || status === 'tool_running' || status === 'retrying' || status === 'fallback_model') {
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
            settleLiveMessage('done')
          }

          if (status === 'error' || status === 'failed') {
            settleTaskSteps('error')
            setPromptRunning(false)
            upsertTaskStep('task-status-final', {
              title: taskCopy.title,
              detail: taskCopy.detail,
              state: taskCopy.state,
            })
            upsertLiveMessage(
              appendUniqueBlock(currentLiveText, progressBlock || payload?.message || '任务执行失败'),
              'error',
            )
          }
        }
      }

      if (eventType === 'permission_requested') {
        upsertLiveMessage(appendUniqueBlock(currentLiveText, progressBlock), 'loading')
        addTaskStep({
          id: payload.requestId || `perm-${timestamp}`,
          requestId: payload.requestId,
          tool: payload.tool || 'unknown_tool',
          title: `权限请求 · ${payload.tool || '未知操作'}`,
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
        upsertFinalMessage(payload.text, 'done')
      }

      if (eventType === 'model_stream_delta' && payload.text) {
        if (payload.done) {
          settleLiveMessage('done')
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
      <Sidebar />
      <MainPanel />
      {settingsOverlayOpen && <SettingsModal />}
      {renameOverlayOpen && <RenameModal />}
    </div>
  )
}
