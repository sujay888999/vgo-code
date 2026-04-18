import React, { useEffect, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { useI18n } from '../i18n'

interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  downloadUrl: string
  releaseNotes?: string
  releaseDate?: string
}

interface UpdateNotificationProps {
  onClose: () => void
}

export function UpdateNotification({ onClose }: UpdateNotificationProps) {
  const { t } = useI18n()
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)

  useEffect(() => {
    const handleUpdateAvailable = (event: Event) => {
      const info = (event as CustomEvent).detail
      if (info) {
        setUpdateInfo(info)
      }
    }

    window.addEventListener('vgoUpdateAvailable', handleUpdateAvailable)
    return () => {
      window.removeEventListener('vgoUpdateAvailable', handleUpdateAvailable)
    }
  }, [])

  const handleInstallNow = async () => {
    if (!updateInfo?.downloadUrl) return
    setIsInstalling(true)
    try {
      const result = await window.vgoDesktop?.installUpdate?.({
        downloadUrl: updateInfo.downloadUrl,
        latestVersion: updateInfo.latestVersion,
        releaseNotes: updateInfo.releaseNotes,
        releaseDate: updateInfo.releaseDate
      })
      if (result?.ok) {
        onClose()
      }
    } finally {
      setIsInstalling(false)
    }
  }

  const handleSkipVersion = async () => {
    if (!updateInfo?.latestVersion) return
    await window.vgoDesktop?.skipVersion?.(updateInfo.latestVersion)
    onClose()
  }

  const handleLater = () => {
    onClose()
  }

  if (!updateInfo) return null

  return (
    <div className="update-notification">
      <div className="update-notification-header">
        <div className="update-notification-title">
          <RefreshCw size={16} />
          <span>{t('update.newVersion')}</span>
        </div>
        <button className="icon-button" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="update-notification-body">
        <div className="update-version-info">
          <span className="update-label">{t('update.currentVersion')}</span>
          <span className="update-version">{updateInfo.currentVersion}</span>
        </div>
        <div className="update-arrow">{'->'}</div>
        <div className="update-version-info">
          <span className="update-label">{t('update.latestVersion')}</span>
          <span className="update-version update-version-new">{updateInfo.latestVersion}</span>
        </div>
      </div>

      {updateInfo.releaseNotes && (
        <div className="update-release-notes">
          <div className="update-label">{t('update.releaseNotes')}</div>
          <div className="update-notes-content">
            {updateInfo.releaseNotes.length > 200
              ? `${updateInfo.releaseNotes.slice(0, 200)}...`
              : updateInfo.releaseNotes}
          </div>
        </div>
      )}

      <div className="update-notification-actions">
        <button
          className="btn btn-primary"
          onClick={handleInstallNow}
          disabled={isInstalling || !updateInfo.downloadUrl}
        >
          <Download size={14} />
          {isInstalling ? t('update.downloading') : t('update.downloadNewVersion')}
        </button>
        <button className="btn btn-secondary" onClick={handleSkipVersion} disabled={isInstalling}>
          {t('update.skipVersion')}
        </button>
        <button className="btn btn-text" onClick={handleLater} disabled={isInstalling}>
          {t('update.laterRemind')}
        </button>
      </div>
    </div>
  )
}
