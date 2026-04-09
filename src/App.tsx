import React, { useEffect } from 'react'
import { useAppStore } from './store/appStore'
import { Sidebar } from './components/Sidebar'
import { MainPanel } from './components/MainPanel'
import { SettingsModal } from './components/SettingsModal'
import { RenameModal } from './components/RenameModal'

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
    hydrate,
    setPromptRunning,
    addMessage,
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

      if (eventType === 'task_status') {
        const taskCopy = getTaskCopy(status, payload)
        if (taskCopy) {
          if (status === 'completed') {
            settleTaskSteps('completed')
            setPromptRunning(false)
          }

          if (status === 'error' || status === 'failed') {
            settleTaskSteps('error')
            setPromptRunning(false)
          }

          addTaskStep({
            id: `${status || 'task'}-${timestamp}`,
            title: taskCopy.title,
            detail: taskCopy.detail,
            state: taskCopy.state,
            timestamp,
          })
        }
      }

      if (eventType === 'permission_requested') {
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
        updateTaskStep(payload.requestId, {
          state: 'permission_granted',
          detail: payload.detail || '已授权，继续执行。',
        })
      }

      if (eventType === 'permission_denied' && payload.requestId) {
        updateTaskStep(payload.requestId, {
          state: 'permission_denied',
          detail: payload.detail || '已拒绝本次操作。',
        })
      }

      if (eventType === 'plan') {
        addTaskStep({
          id: `plan-${timestamp}`,
          title: payload.summary || '执行计划',
          detail: Array.isArray(payload.steps) ? payload.steps.join('\n') : '',
          state: 'planning',
          timestamp,
        })
      }

      if (eventType === 'workflow_selected') {
        addTaskStep({
          id: `workflow-${timestamp}`,
          title: payload.label ? `工作流 · ${payload.label}` : '工作流已切换',
          detail: payload.detail || '',
          state: 'planning',
          timestamp,
        })
      }

      if (eventType === 'workflow_probe') {
        addTaskStep({
          id: `probe-${timestamp}`,
          title: '前置检查',
          detail: payload.detail || '',
          state: 'working',
          timestamp,
        })
      }

      if (eventType === 'capability_gap') {
        addTaskStep({
          id: `gap-${timestamp}`,
          title: '能力缺口',
          detail: payload.detail || '',
          state: 'error',
          timestamp,
        })
      }

      if (eventType === 'skill_suggestions') {
        const skills = Array.isArray(payload.skills) ? payload.skills : []
        addTaskStep({
          id: `skills-${timestamp}`,
          title: 'Skill 建议',
          detail:
            payload.detail ||
            skills.map((skill) => `${skill.name} · ${skill.path}`).join('\n') ||
            '未找到匹配的本机 skill',
          state: skills.length ? 'completed' : 'error',
          timestamp,
        })
      }

      if (eventType === 'model_response' && payload.text) {
        addMessage({
          id: `msg-${timestamp}`,
          role: 'assistant',
          text: payload.text,
          status: 'done',
          timestamp,
        })
      }

      if (eventType === 'tool_result') {
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
  }, [hydrate, setPromptRunning, addMessage, addTaskStep, updateTaskStep, settleTaskSteps])

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
