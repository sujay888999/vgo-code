import React from 'react'
import type { TaskStep } from '../store/appStore'
import {
  Loader2,
  ShieldAlert,
  Wrench,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'

interface AgentTracePanelProps {
  steps: TaskStep[]
  promptRunning: boolean
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function getIcon(step: TaskStep) {
  const title = step.title.toLowerCase()

  if (step.state === 'permission_requested') {
    return <ShieldAlert size={13} className="process-icon warning" />
  }
  if (step.state === 'error' || step.state === 'permission_denied') {
    return <AlertTriangle size={13} className="process-icon warning" />
  }
  if (step.state === 'completed' || step.state === 'permission_granted') {
    return <CheckCircle2 size={13} className="process-icon success" />
  }
  if (title.includes('工具') || title.includes('tool')) {
    return <Wrench size={13} className="process-icon active" />
  }
  if (
    title.includes('规划') ||
    title.includes('思考') ||
    title.includes('计划') ||
    title.includes('工作流') ||
    title.includes('skill')
  ) {
    return <Sparkles size={13} className="process-icon active" />
  }
  return <Loader2 size={13} className="process-icon spinning" />
}

export function AgentTracePanel({ steps, promptRunning }: AgentTracePanelProps) {
  const visible = steps
    .filter((step) =>
      [
        'planning',
        'working',
        'permission_requested',
        'permission_granted',
        'completed',
        'error',
      ].includes(step.state),
    )
    .slice(-8)

  if (!promptRunning && !visible.length) return null

  return (
    <section className="agent-process-stream" aria-label="Codex 思考过程">
      <div className="agent-process-head">
        <div className="agent-process-head-copy">
          <span className="agent-process-title">Codex Process</span>
          <span className="agent-process-caption">思考与执行过程可见</span>
        </div>
        <span className="agent-process-subtitle">{promptRunning ? '运行中' : '最近活动'}</span>
      </div>
      <div className="agent-process-list">
        {visible.map((step) => (
          <div key={step.id} className={`agent-process-item ${step.state}`}>
            <div className="agent-process-leading">{getIcon(step)}</div>
            <div className="agent-process-main">
              <div className="agent-process-line">
                <span className="agent-process-name">{step.title}</span>
                <span className="agent-process-time">{formatTime(step.timestamp)}</span>
              </div>
              {step.detail && <div className="agent-process-detail">{step.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
