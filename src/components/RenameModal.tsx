import React, { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useI18n } from '../i18n'
import { X, Check, AlertCircle } from 'lucide-react'

export function RenameModal() {
  const { t } = useI18n()
  const { setRenameOverlayOpen, activeSessionId, sessions, hydrate } = useAppStore()

  const session = sessions.find((s) => s.id === activeSessionId)
  const [name, setName] = useState(session?.title || '')
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t('rename.nameCannotEmpty'))
      return
    }

    if (name.length > 100) {
      setError(t('rename.nameTooLong'))
      return
    }

    try {
      const result = await window.vgoDesktop?.renameSession?.(name.trim())
      if (result?.state) {
        hydrate(result.state)
      }
    } catch (e) {
      console.error('Failed to rename session:', e)
    }
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
          <h2>{t('rename.title')}</h2>
          <button className="icon-button" onClick={() => setRenameOverlayOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="session-name">{t('rename.threadName')}</label>
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
              placeholder={t('rename.inputPlaceholder')}
              autoFocus
              maxLength={100}
            />
            {error && (
              <div className="form-error">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}
            <p className="form-hint">{t('rename.charLimit')}</p>
          </div>
        </div>

        <div className="modal-footer">
          <button className="ghost-button" onClick={() => setRenameOverlayOpen(false)}>
            {t('rename.cancel')}
          </button>
          <button className="primary-button" onClick={handleSubmit}>
            <Check size={16} />
            {t('rename.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
