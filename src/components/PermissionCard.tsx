import React from 'react'
import type { TaskStep } from '../store/appStore'
import { ShieldAlert, Check, X } from 'lucide-react'

interface PermissionCardProps {
  step: TaskStep
}

export function PermissionCard({ step }: PermissionCardProps) {
  const requestId = step.requestId

  const respond = async (approved: boolean) => {
    if (!requestId) return
    try {
      await window.vgoDesktop?.respondPermission?.({ requestId, approved })
    } catch (error) {
      console.error('Failed to respond permission:', error)
    }
  }

  return (
    <div className="permission-card">
      <div className="permission-card-header">
        <div className="permission-card-title">
          <ShieldAlert size={16} />
          <span>{step.title}</span>
        </div>
        <span className="permission-card-badge">等待确认</span>
      </div>
      {step.detail && <pre className="permission-card-detail">{step.detail}</pre>}
      <div className="permission-card-actions">
        <button className="ghost-button" onClick={() => void respond(false)}>
          <X size={14} />
          <span>拒绝</span>
        </button>
        <button className="primary-button" onClick={() => void respond(true)}>
          <Check size={14} />
          <span>允许本次</span>
        </button>
      </div>
    </div>
  )
}
