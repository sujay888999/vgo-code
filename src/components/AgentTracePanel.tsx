import React from 'react'
import type { TaskStep } from '../store/appStore'
import {
  Loader2,
  ShieldAlert,
  Wrench,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
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

function normalizeText(text?: string) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function isThinkingStep(step: TaskStep) {
  const title = normalizeText(step.title).toLowerCase()
  return (
    step.state === 'planning' ||
    (step.state === 'working' &&
      (title.includes('思考') ||
        title.includes('规划') ||
        title.includes('继续处理') ||
        title.includes('工作流') ||
        title.includes('前置检查') ||
        title.includes('continu') ||
        title.includes('thinking') ||
        title.includes('workflow')))
  )
}

function toThinkingLines(steps: TaskStep[]) {
  const seen = new Set<string>()
  const lines: string[] = []

  for (const step of steps.filter(isThinkingStep)) {
    const title = normalizeText(step.title)
    const detailLines = String(step.detail || '')
      .split('\n')
      .map((line) => normalizeText(line))
      .filter(Boolean)

    if (title && !seen.has(title)) {
      seen.add(title)
      lines.push(title)
    }

    for (const detail of detailLines) {
      if (!seen.has(detail)) {
        seen.add(detail)
        lines.push(detail)
      }
    }
  }

  return lines.slice(-6)
}

function isExecutionStep(step: TaskStep) {
  return !isThinkingStep(step)
}

function getIcon(step: TaskStep) {
  const title = normalizeText(step.title).toLowerCase()

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
    .slice(-12)

  const thinkingLines = toThinkingLines(visible)
  const executionSteps = visible.filter(isExecutionStep).slice(-6)

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

      {!!thinkingLines.length && (
        <div className="agent-thinking-block">
          <div className="agent-thinking-head">
            <Lightbulb size={15} className="process-icon muted" />
            <span className="agent-thinking-title">Thinking...</span>
          </div>
          <ol className="agent-thinking-list">
            {thinkingLines.map((line, index) => (
              <li key={`${index}-${line}`} className="agent-thinking-line">
                {line}
              </li>
            ))}
          </ol>
        </div>
      )}

      {!!executionSteps.length && (
        <div className="agent-process-list">
          {executionSteps.map((step) => (
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
      )}
    </section>
  )
}
