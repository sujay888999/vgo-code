import React, { useState, useEffect } from 'react'
import { X, Download, RefreshCw } from 'lucide-react'

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
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)

  useEffect(() => {
    const handleUpdateAvailable = (e: Event) => {
      const info = (e as CustomEvent).detail
      if (info) {
        setUpdateInfo(info)
      }
    }

    window.addEventListener('vgoUpdateAvailable', handleUpdateAvailable)

    return () => {
      window.removeEventListener('vgoUpdateAvailable', handleUpdateAvailable)
    }
  }, [])

  const handleDownload = async () => {
    if (!updateInfo?.downloadUrl) return
    setIsDownloading(true)
    try {
      await window.vgoDesktop?.shell?.openExternal?.(updateInfo.downloadUrl)
    } finally {
      setIsDownloading(false)
    }
  }

  const handleCheckUpdates = async () => {
    setIsDownloading(true)
    try {
      await window.vgoDesktop?.checkForUpdates?.({ force: true })
    } finally {
      setIsDownloading(false)
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
          <span>发现新版本</span>
        </div>
        <button className="icon-button" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      
      <div className="update-notification-body">
        <div className="update-version-info">
          <span className="update-label">当前版本</span>
          <span className="update-version">{updateInfo.currentVersion}</span>
        </div>
        <div className="update-arrow">→</div>
        <div className="update-version-info">
          <span className="update-label">最新版本</span>
          <span className="update-version update-version-new">{updateInfo.latestVersion}</span>
        </div>
      </div>

      {updateInfo.releaseNotes && (
        <div className="update-release-notes">
          <div className="update-label">更新说明</div>
          <div className="update-notes-content">
            {updateInfo.releaseNotes.length > 200 
              ? updateInfo.releaseNotes.slice(0, 200) + '...' 
              : updateInfo.releaseNotes}
          </div>
        </div>
      )}

      <div className="update-notification-actions">
        <button 
          className="btn btn-primary"
          onClick={handleDownload}
          disabled={isDownloading || !updateInfo.downloadUrl}
        >
          <Download size={14} />
          {isDownloading ? '正在下载...' : '下载新版本'}
        </button>
        <button 
          className="btn btn-secondary"
          onClick={handleSkipVersion}
          disabled={isDownloading}
        >
          跳过此版本
        </button>
        <button 
          className="btn btn-text"
          onClick={handleLater}
          disabled={isDownloading}
        >
          稍后提醒
        </button>
      </div>
    </div>
  )
}
