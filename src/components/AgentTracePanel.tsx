import React from 'react'
import type { TaskStep } from '../store/appStore'
import { useI18n } from '../i18n'
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

function formatTime(timestamp: number, locale: string = 'zh-CN') {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function normalizeText(text?: string) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function isThinkingStep(step: TaskStep, t: (key: string) => string) {
  const title = normalizeText(step.title).toLowerCase()
  return (
    step.state === 'planning' ||
    (step.state === 'working' &&
      (title.includes(t('agentTrace.thinking')) ||
        title.includes(t('agentTrace.planning')) ||
        title.includes(t('agentTrace.continuing')) ||
        title.includes(t('agentTrace.workflow')) ||
        title.includes(t('agentTrace.prerequisite')) ||
        title.includes('continu') ||
        title.includes('thinking') ||
        title.includes('workflow')))
  )
}

function toThinkingLines(steps: TaskStep[], t: (key: string) => string) {
  const seen = new Set<string>()
  const lines: string[] = []

  for (const step of steps.filter((s) => isThinkingStep(s, t))) {
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

function isExecutionStep(step: TaskStep, t: (key: string) => string) {
  return !isThinkingStep(step, t)
}

function getIcon(step: TaskStep, t: (key: string) => string) {
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
  if (title.includes(t('agentTrace.tool')) || title.includes('tool')) {
    return <Wrench size={13} className="process-icon active" />
  }
  if (
    title.includes(t('agentTrace.planning')) ||
    title.includes(t('agentTrace.thinking')) ||
    title.includes(t('agentTrace.executionPlan')) ||
    title.includes(t('agentTrace.workflow')) ||
    title.includes('skill')
  ) {
    return <Sparkles size={13} className="process-icon active" />
  }
  return <Loader2 size={13} className="process-icon spinning" />
}

export function AgentTracePanel({ steps, promptRunning }: AgentTracePanelProps) {
  const { t, locale } = useI18n()
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

  const thinkingLines = toThinkingLines(visible, t)
  const executionSteps = visible.filter((s) => isExecutionStep(s, t)).slice(-6)

  if (!promptRunning && !visible.length) return null

  return (
    <section className="agent-process-stream" aria-label="Codex Process">
      <div className="agent-process-head">
        <div className="agent-process-head-copy">
          <span className="agent-process-title">Codex Process</span>
          <span className="agent-process-caption">{t('agentTrace.processVisible')}</span>
        </div>
        <span className="agent-process-subtitle">{promptRunning ? t('agentTrace.running') : t('agentTrace.recentActivity')}</span>
      </div>

      {!!thinkingLines.length && (
        <div className="agent-thinking-block">
          <div className="agent-thinking-head">
            <Lightbulb size={15} className="process-icon muted" />
            <span className="agent-thinking-title">{t('agentTrace.thinkingTitle')}</span>
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
              <div className="agent-process-leading">{getIcon(step, t)}</div>
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
