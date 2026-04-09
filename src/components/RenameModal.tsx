import React, { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { X, Check, AlertCircle } from 'lucide-react'

export function RenameModal() {
  const { setRenameOverlayOpen, activeSessionId, sessions } = useAppStore()

  const session = sessions.find((s) => s.id === activeSessionId)
  const [name, setName] = useState(session?.title || '')
  const [error, setError] = useState('')

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('名称不能为空')
      return
    }

    if (name.length > 100) {
      setError('名称不能超过 100 个字符')
      return
    }

    void window.vgoDesktop?.renameSession?.(name.trim())
    setRenameOverlayOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit()
    if (e.key === 'Escape') setRenameOverlayOpen(false)
  }

  if (!session) {
    setRenameOverlayOpen(false)
    return null
  }

  return (
    <div className="modal-overlay" onClick={() => setRenameOverlayOpen(false)}>
      <div className="modal rename-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>重命名当前线程</h2>
          <button className="icon-button" onClick={() => setRenameOverlayOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="session-name">线程名称</label>
            <input
              id="session-name"
              type="text"
              className="text-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
              onKeyDown={handleKeyDown}
              placeholder="输入新的线程名称"
              autoFocus
              maxLength={100}
            />
            {error && (
              <div className="form-error">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}
            <p className="form-hint">最多 100 个字符。</p>
          </div>
        </div>

        <div className="modal-footer">
          <button className="ghost-button" onClick={() => setRenameOverlayOpen(false)}>
            取消
          </button>
          <button className="primary-button" onClick={handleSubmit}>
            <Check size={16} />
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
