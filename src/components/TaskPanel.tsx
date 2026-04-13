import React from 'react'
import type { TaskStep } from '../store/appStore'
import { useI18n } from '../i18n'
import {
  Circle,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Shield,
  ShieldCheck,
  ShieldX,
} from 'lucide-react'

interface TaskPanelProps {
  steps: TaskStep[]
}

export function TaskPanel({ steps }: TaskPanelProps) {
  const { t } = useI18n()

  const getIcon = (state: TaskStep['state']) => {
    switch (state) {
      case 'completed':
        return <CheckCircle size={16} className="icon-success" />
      case 'error':
        return <XCircle size={16} className="icon-error" />
      case 'permission_requested':
        return <Shield size={16} className="icon-warning" />
      case 'permission_granted':
        return <ShieldCheck size={16} className="icon-success" />
      case 'permission_denied':
        return <ShieldX size={16} className="icon-error" />
      case 'working':
      case 'planning':
        return <Loader2 size={16} className="icon-spin" />
      default:
        return <Circle size={16} className="icon-idle" />
    }
  }

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

  const activeSteps = steps.filter((s) =>
    ['working', 'planning', 'permission_requested'].includes(s.state),
  )
  const completedSteps = steps.filter((s) =>
    ['completed', 'permission_granted'].includes(s.state),
  )
  const errorSteps = steps.filter((s) => ['error', 'permission_denied'].includes(s.state))

  return (
    <div className="task-panel">
      {steps.length === 0 ? (
        <div className="task-empty">
          <Clock size={24} />
          <p>{t('task.empty')}</p>
          <p className="hint">{t('task.hint')}</p>
        </div>
      ) : (
        <div className="task-list">
          {activeSteps.length > 0 && (
            <div className="task-section">
              <div className="task-section-title">{t('task.inProgress')}</div>
              {activeSteps.map((step) => (
                <div key={step.id} className={`task-item ${step.state}`}>
                  <div className="task-icon">{getIcon(step.state)}</div>
                  <div className="task-content">
                    <div className="task-title">{step.title}</div>
                    {step.detail && <div className="task-detail">{step.detail}</div>}
                  </div>
                  <div className="task-time">{formatTime(step.timestamp)}</div>
                </div>
              ))}
            </div>
          )}

          {completedSteps.length > 0 && (
            <div className="task-section">
              <div className="task-section-title">
                {t('task.completedWithCount', { count: completedSteps.length })}
              </div>
              {completedSteps.slice(-6).map((step) => (
                <div key={step.id} className={`task-item ${step.state}`}>
                  <div className="task-icon">{getIcon(step.state)}</div>
                  <div className="task-content">
                    <div className="task-title">{step.title}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {errorSteps.length > 0 && (
            <div className="task-section">
              <div className="task-section-title error">
                {t('task.failedWithCount', { count: errorSteps.length })}
              </div>
              {errorSteps.map((step) => (
                <div key={step.id} className={`task-item ${step.state}`}>
                  <div className="task-icon">{getIcon(step.state)}</div>
                  <div className="task-content">
                    <div className="task-title">{step.title}</div>
                    {step.detail && <div className="task-detail error">{step.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
