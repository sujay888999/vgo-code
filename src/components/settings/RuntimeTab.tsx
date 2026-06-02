import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  Loader2,
  Plus,
  Save,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useI18n } from '../../i18n'

type UpdateInfo = {
  currentVersion?: string
  latestVersion?: string
  downloadUrl?: string
  releaseNotes?: string
  releaseDate?: string
}
type UpdateProgress = {
  status: string
  downloadedBytes: number
  totalBytes: number
  speedBytesPerSec: number
  progressPercent: number
}

type ProtocolType = 'ollama' | 'openai' | 'legacy'

function detectEndpointType(baseUrl: string): ProtocolType | null {
  const lower = String(baseUrl || '').trim().toLowerCase()
  if (!lower) return null
  if (/localhost:11434|127\.0\.0\.1:11434/.test(lower)) return 'ollama'
  if (/\/chat\/completions$/.test(lower) || /\/v1$/.test(lower) || /\/openai\/v1$/.test(lower) || /\/api\/paas\/v4$/.test(lower)) return 'openai'
  return 'legacy'
}

function protocolDisplay(type: ProtocolType | null, t: (k: string) => string) {
  if (type === 'ollama') return t('runtime.endpoint.ollama')
  if (type === 'openai') return t('runtime.endpoint.openai')
  if (type === 'legacy') return t('runtime.endpoint.legacy')
  return t('runtime.endpoint.undetected')
}

function endpointBadgeLabel(type: ProtocolType | null, t: (k: string) => string) {
  if (type === 'ollama') return t('runtime.endpointBadge.ollama')
  if (type === 'openai') return t('runtime.endpointBadge.openai')
  if (type === 'legacy') return t('runtime.endpointBadge.legacy')
  return ''
}

export function RuntimeTab() {
  const { t } = useI18n()
  const {
    vgoAILoggedIn,
    vgoAIEmail,
    vgoAIDisplayName,
    vgoAIPreferredModel,
    engines,
    runtimeEngineId,
    remoteProfiles,
    activeRemoteProfileId,
    hydrate,
  } = useAppStore()

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [draftDirty, setDraftDirty] = useState(false)
  const [configName, setConfigName] = useState('')
  const [baseUrl, setBaseUrl] = useState('http://localhost:11434')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [switchingKey, setSwitchingKey] = useState<string | null>(null)
  const [updateAutoCheck, setUpdateAutoCheck] = useState(true)
  const [updateIntervalHours, setUpdateIntervalHours] = useState(6)
  const [updateLastCheckTime, setUpdateLastCheckTime] = useState(0)
  const [updateSkipVersion, setUpdateSkipVersion] = useState('')
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateStatus, setUpdateStatus] = useState('')
  const [updateCandidate, setUpdateCandidate] = useState<UpdateInfo | null>(null)
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null)

  const activeProfile = useMemo(
    () => remoteProfiles.find((item) => item.id === activeRemoteProfileId) || null,
    [remoteProfiles, activeRemoteProfileId],
  )
  const editableProfiles = useMemo(
    () => remoteProfiles.filter((profile) => profile.id !== 'default'),
    [remoteProfiles],
  )
  const editableActiveProfile = useMemo(
    () => (activeProfile?.id === 'default' ? null : activeProfile),
    [activeProfile],
  )

  const detectedProtocol = useMemo(() => detectEndpointType(baseUrl), [baseUrl])

  const refreshState = async () => {
    const nextState = await window.vgoDesktop?.getState?.()
    if (nextState) hydrate(nextState)
  }

  const previousProfileRef = useRef(activeRemoteProfileId)
  useEffect(() => {
    if (draftDirty && previousProfileRef.current === activeRemoteProfileId) return
    previousProfileRef.current = activeRemoteProfileId
    requestAnimationFrame(() => {
      if (!editableActiveProfile) {
        setConfigName('')
        setBaseUrl('http://localhost:11434')
        setModel('')
        setApiKey('')
        setSystemPrompt('')
      } else {
        setConfigName(editableActiveProfile.name || '')
        setBaseUrl(editableActiveProfile.baseUrl || 'http://localhost:11434')
        setModel(editableActiveProfile.model || '')
        setApiKey(editableActiveProfile.apiKey || '')
        setSystemPrompt(editableActiveProfile.systemPrompt || '')
      }
    })
  }, [editableActiveProfile, activeRemoteProfileId, draftDirty])

  const formatBytes = useCallback((bytes: number) => {
    const value = Number(bytes) || 0
    if (value <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let size = value
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex += 1
    }
    return `${size >= 100 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
  }, [])

  const formatUpdateLastCheckTime = useCallback((timestamp: number) => {
    if (!timestamp) return t('settings.update.neverChecked')
    try {
      return new Date(timestamp).toLocaleString()
    } catch {
      return t('settings.update.neverChecked')
    }
  }, [t])

  useEffect(() => {
    const loadUpdateSettings = async () => {
      try {
        const settings = await window.vgoDesktop?.getUpdateSettings?.()
        if (!settings) return
        setUpdateAutoCheck(Boolean(settings.autoCheck))
        setUpdateIntervalHours(Number(settings.checkIntervalHours) || 6)
        setUpdateLastCheckTime(Number(settings.lastCheckTime) || 0)
        setUpdateSkipVersion(String(settings.skipVersion || ''))
      } catch (error: unknown) {
        setUpdateStatus(error instanceof Error ? error.message : t('settings.operationFailed'))
      }
    }
    loadUpdateSettings()
  }, [t])

  useEffect(() => {
    const handleUpdateAvailable = (event: Event) => {
      const info = (event as CustomEvent).detail || {}
      if (info?.latestVersion && info?.downloadUrl) {
        setUpdateCandidate(info)
      }
    }
    const handleUpdateStatus = (event: Event) => {
      const payload = (event as CustomEvent).detail || {}
      if (payload?.status === 'downloading') {
        const downloadedBytes = Number(payload.downloadedBytes) || 0
        const totalBytes = Number(payload.totalBytes) || 0
        const progressPercent = Number(payload.progressPercent) || 0
        const speedBytesPerSec = Number(payload.speedBytesPerSec) || 0
        setUpdateProgress({
          status: 'downloading',
          downloadedBytes,
          totalBytes,
          progressPercent,
          speedBytesPerSec,
        })
        if (totalBytes > 0) {
          setUpdateStatus(
            t('runtime.status.downloadingPkg', { percent: progressPercent.toFixed(1), downloaded: formatBytes(downloadedBytes), total: formatBytes(totalBytes) }),
          )
        } else {
          setUpdateStatus(t('runtime.status.downloading', { downloaded: formatBytes(downloadedBytes) }))
        }
      } else if (payload?.status === 'downloaded') {
        setUpdateProgress((prev) => ({
          status: 'downloaded',
          downloadedBytes: prev?.downloadedBytes || 0,
          totalBytes: prev?.totalBytes || prev?.downloadedBytes || 0,
          speedBytesPerSec: prev?.speedBytesPerSec || 0,
          progressPercent: 100,
        }))
        setUpdateStatus(t('runtime.status.downloadCompleted'))
      } else if (payload?.status === 'installing') {
        setUpdateProgress((prev) => ({
          status: 'installing',
          downloadedBytes: prev?.downloadedBytes || 0,
          totalBytes: prev?.totalBytes || prev?.downloadedBytes || 0,
          speedBytesPerSec: prev?.speedBytesPerSec || 0,
          progressPercent: 100,
        }))
        setUpdateStatus(t('settings.update.installingPkg'))
      } else if (payload?.status === 'restarting') {
        setUpdateProgress((prev) => ({
          status: 'restarting',
          downloadedBytes: prev?.downloadedBytes || 0,
          totalBytes: prev?.totalBytes || prev?.downloadedBytes || 0,
          speedBytesPerSec: prev?.speedBytesPerSec || 0,
          progressPercent: 100,
        }))
        setUpdateStatus(t('runtime.status.installStarted'))
      } else if (payload?.status === 'failed') {
        setUpdateProgress((prev) => (prev ? { ...prev, status: 'failed' } : null))
        setUpdateStatus(payload?.error || t('settings.operationFailed'))
      }
    }

    window.addEventListener('vgoUpdateAvailable', handleUpdateAvailable)
    window.addEventListener('vgoUpdateStatus', handleUpdateStatus)
    return () => {
      window.removeEventListener('vgoUpdateAvailable', handleUpdateAvailable)
      window.removeEventListener('vgoUpdateStatus', handleUpdateStatus)
    }
  }, [formatBytes, t])

  const withUpdateStatus = async (message: string, fn: () => Promise<void>) => {
    setUpdateStatus(message)
    setUpdateBusy(true)
    try {
      await fn()
    } catch (error: unknown) {
      setUpdateStatus(error instanceof Error ? error.message : t('settings.operationFailed'))
    } finally {
      setUpdateBusy(false)
    }
  }

  const withStatus = async (message: string, fn: () => Promise<void>) => {
    setStatus(message)
    setBusy(true)
    try {
      await fn()
      window.setTimeout(() => setStatus(''), 1400)
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : t('settings.operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleCheckForUpdatesNow = async () => {
    setUpdateProgress(null)
    await withUpdateStatus(t('settings.update.checking'), async () => {
      const result = await window.vgoDesktop?.checkForUpdates?.({ force: true })
      await loadUpdateSettings()
      if (!result?.ok) {
        setUpdateStatus(result?.error || t('settings.operationFailed'))
        return
      }
      if (result.updateAvailable) {
        setUpdateCandidate({
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          downloadUrl: result.downloadUrl,
          releaseNotes: result.releaseNotes,
          releaseDate: result.releaseDate,
        })
        setUpdateStatus(
          t('settings.update.available')
            .replace('{current}', result.currentVersion || '-')
            .replace('{latest}', result.latestVersion || '-'),
        )
        return
      }
      setUpdateCandidate(null)
      setUpdateStatus(t('settings.update.upToDate'))
    })
  }

  const handleInstallUpdateNow = async () => {
    if (!updateCandidate?.downloadUrl || !updateCandidate?.latestVersion) {
      setUpdateStatus(t('settings.update.noCandidate'))
      return
    }
    setUpdateProgress({
      status: 'starting',
      downloadedBytes: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      progressPercent: 0,
    })
    await withUpdateStatus(t('settings.update.installing'), async () => {
      const result = await window.vgoDesktop?.installUpdate?.({
        downloadUrl: updateCandidate.downloadUrl,
        latestVersion: updateCandidate.latestVersion,
        releaseNotes: updateCandidate.releaseNotes,
        releaseDate: updateCandidate.releaseDate,
      })
      if (!result?.ok) {
        setUpdateStatus(result?.error || t('settings.operationFailed'))
        return
      }
      setUpdateStatus(t('settings.update.installTriggered'))
    })
  }

  const handleApplyUpdateSettings = async () => {
    await withUpdateStatus(t('settings.update.saving'), async () => {
      await window.vgoDesktop?.setAutoCheck?.(updateAutoCheck, updateIntervalHours)
      await loadUpdateSettings()
      setUpdateStatus(t('settings.update.saved'))
    })
  }

  const handleResetSkippedVersion = async () => {
    await withUpdateStatus(t('settings.update.resettingSkip'), async () => {
      await window.vgoDesktop?.resetSkipVersion?.()
      await loadUpdateSettings()
      setUpdateStatus(t('settings.update.skipResetDone'))
    })
  }

  const buildProfilePayload = () => ({
    name: configName.trim() || t('settings.unnamedConfig'),
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    apiKey: apiKey.trim(),
    systemPrompt,
    activate: true,
  })

  const handleSaveCurrentProfile = async () => {
    const payload = buildProfilePayload()

    await withStatus(t('settings.savingConfig'), async () => {
      if (editableActiveProfile) {
        const result = await window.vgoDesktop?.updateRemoteProfile?.(editableActiveProfile.id, payload)
        await window.vgoDesktop?.setEngine?.(detectedProtocol === 'ollama' ? 'ollama' : 'vgo-remote')
        await window.vgoDesktop?.selectRemoteProfile?.(editableActiveProfile.id)
        if (result) hydrate(result)
      } else {
        const result = await window.vgoDesktop?.createRemoteProfile?.(payload)
        await window.vgoDesktop?.setEngine?.(detectedProtocol === 'ollama' ? 'ollama' : 'vgo-remote')
        if (result) hydrate(result)
      }
    })
  }

  const handleCreateNewProfile = async () => {
    const payload = buildProfilePayload()

    await withStatus(t('settings.creatingConfig'), async () => {
      const result = await window.vgoDesktop?.createRemoteProfile?.(payload)
      await window.vgoDesktop?.setEngine?.(detectedProtocol === 'ollama' ? 'ollama' : 'vgo-remote')
      if (result) hydrate(result)
    })
  }

  const handleDeleteProfile = async () => {
    if (!editableActiveProfile) return
    await withStatus(t('settings.deletingConfig'), async () => {
      const result = await window.vgoDesktop?.deleteRemoteProfile?.(editableActiveProfile.id)
      if (result) hydrate(result)
    })
  }

  const handleActivateProfile = async (profileId: string) => {
    const profile = remoteProfiles.find((p) => p.id === profileId)
    if (!profile) return
    setSwitchingKey(profileId)
    try {
      const protocol = detectEndpointType(profile.baseUrl)
      await window.vgoDesktop?.setEngine?.(protocol === 'ollama' ? 'ollama' : 'vgo-remote')
      await window.vgoDesktop?.selectRemoteProfile?.(profileId)
      await refreshState()
    } finally {
      setSwitchingKey(null)
    }
  }

  const handleSwitchEngine = async (engineId: string) => {
    setSwitchingKey(engineId)
    try {
      await window.vgoDesktop?.setEngine?.(engineId)
      await refreshState()
    } finally {
      setSwitchingKey(null)
    }
  }

  const handleInstallWhisper = async () => {
    await withStatus(t('settings.installingWhisper'), async () => {
      await window.vgoDesktop?.installWhisper?.()
    })
  }

  const handleNormalizeLog = async () => {
    await withStatus(t('settings.normalizingLog'), async () => {
      await window.vgoDesktop?.normalizeEngineLog?.()
    })
  }

  return (
    <div className="settings-section">
      <h3>{t('settings.accountStatus')}</h3>
      <div className="account-info">
        <div className="info-row">
          <span className="label">{t('settings.loginStatus')}</span>
          <span className="value">{vgoAILoggedIn ? t('settings.loggedIn') : t('settings.notLoggedIn')}</span>
        </div>
        <div className="info-row">
          <span className="label">{t('settings.account')}</span>
          <span className="value">{vgoAIDisplayName || vgoAIEmail || t('settings.notBound')}</span>
        </div>
        <div className="info-row">
          <span className="label">{t('settings.cloudDefaultModel')}</span>
          <span className="value">{vgoAIPreferredModel || t('settings.notSet')}</span>
        </div>
      </div>

      <h3>{t('settings.runtimeEngine')}</h3>
      <div className="engine-list">
        {engines.filter((e) => e.id === 'ollama' || e.id === 'vgo-remote').map((engine) => (
          <button
            key={engine.id}
            type="button"
            className={`engine-item ${runtimeEngineId === engine.id ? 'active' : ''}`}
            onClick={() => void handleSwitchEngine(engine.id)}
            disabled={Boolean(switchingKey)}
          >
            <div className="engine-info">
              <span className="engine-label">{engine.label}</span>
              <span className="engine-provider">{engine.provider}</span>
              <span className="engine-provider">
                {engine.id === 'ollama' ? t('settings.ollamaDesc') : t('settings.vgoRemoteDesc')}
              </span>
            </div>
            {switchingKey === engine.id ? (
              <Loader2 size={14} className="spin" />
            ) : runtimeEngineId === engine.id ? (
              <span className="engine-badge">{t('settings.current')}</span>
            ) : null}
          </button>
        ))}
      </div>

      <h3>{t('settings.capabilityMaintenance')}</h3>
      <div className="manual-config-card">
        <p className="hint">{t('settings.capabilityMaintenanceHint')}</p>
        <div className="button-row manual-config-actions">
          <button type="button" className="primary-button" onClick={() => void handleInstallWhisper()} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <Wrench size={14} />}
            {t('settings.installWhisper')}
          </button>
          <button type="button" className="ghost-button" onClick={() => void handleNormalizeLog()} disabled={busy}>
            <Wrench size={14} />
            {t('settings.normalizeLog')}
          </button>
        </div>
        {status && <p className="manual-config-status">{status}</p>}
      </div>

      <h3>{t('settings.update.title')}</h3>
      <div className="manual-config-card">
        <p className="hint">{t('settings.update.hint')}</p>

        <div className="toggle-row">
          <div className="toggle-copy">
            <span>{t('settings.update.autoCheck')}</span>
            <p className="hint">{t('settings.update.autoCheckHint')}</p>
          </div>
          <button
            type="button"
            className={`toggle ${updateAutoCheck ? 'on' : ''}`}
            onClick={() => setUpdateAutoCheck(!updateAutoCheck)}
            disabled={updateBusy}
          />
        </div>

        <div className="simple-config-grid">
          <label className="hint" htmlFor="update-interval-select">
            {t('settings.update.interval')}
          </label>
          <select
            id="update-interval-select"
            className="text-input"
            value={updateIntervalHours}
            onChange={(event) => setUpdateIntervalHours(Number(event.target.value))}
            disabled={updateBusy}
          >
            {[1, 3, 6, 12, 24].map((value) => (
              <option key={value} value={value}>
                {t('settings.update.intervalOption').replace('{hours}', String(value))}
              </option>
            ))}
          </select>
        </div>

        <div className="account-info">
          <div className="info-row">
            <span className="label">{t('settings.update.lastCheck')}</span>
            <span className="value">{formatUpdateLastCheckTime(updateLastCheckTime)}</span>
          </div>
          <div className="info-row">
            <span className="label">{t('settings.update.skippedVersion')}</span>
            <span className="value">{updateSkipVersion || t('settings.update.none')}</span>
          </div>
        </div>

        {updateCandidate?.latestVersion && (
          <div className="account-info">
            <div className="info-row">
              <span className="label">{t('settings.update.availableVersion')}</span>
              <span className="value">
                {(updateCandidate.currentVersion || '-')} {'->'} {updateCandidate.latestVersion}
              </span>
            </div>
          </div>
        )}

        <div className="button-row manual-config-actions">
          <button type="button" className="primary-button" onClick={() => void handleCheckForUpdatesNow()} disabled={updateBusy}>
            {updateBusy ? <Loader2 size={14} className="spin" /> : <Wrench size={14} />}
            {t('settings.update.checkNow')}
          </button>
          <button type="button" className="primary-button" onClick={() => void handleInstallUpdateNow()} disabled={updateBusy || !updateCandidate?.latestVersion}>
            <Save size={14} />
            {t('settings.update.installNow')}
          </button>
          <button type="button" className="ghost-button" onClick={() => void handleApplyUpdateSettings()} disabled={updateBusy}>
            <Save size={14} />
            {t('settings.update.saveConfig')}
          </button>
          <button type="button" className="ghost-button" onClick={() => void handleResetSkippedVersion()} disabled={updateBusy}>
            <Wrench size={14} />
            {t('settings.update.resetSkip')}
          </button>
        </div>

        {updateProgress && (
          <div className="update-progress-card">
            <div className="update-progress-head">
              <span>{t('runtime.updateProgress')}</span>
              <span>{Math.max(0, Math.min(100, updateProgress.progressPercent)).toFixed(1)}%</span>
            </div>
            <div className="update-progress-track">
              <div className="update-progress-fill" style={{ width: `${Math.max(0, Math.min(100, updateProgress.progressPercent))}%` }} />
            </div>
            <div className="update-progress-meta">
              <span>
                {updateProgress.totalBytes > 0
                  ? `${formatBytes(updateProgress.downloadedBytes)} / ${formatBytes(updateProgress.totalBytes)}`
                  : formatBytes(updateProgress.downloadedBytes)}
              </span>
              {updateProgress.speedBytesPerSec > 0 && (
                <span>{`${formatBytes(updateProgress.speedBytesPerSec)}/s`}</span>
              )}
            </div>
          </div>
        )}

        {updateStatus && <p className="manual-config-status">{updateStatus}</p>}
      </div>

      <h3>{t('settings.manualConfig')}</h3>
      <div className="manual-config-card">
        <p className="hint">{t('settings.manualConfigHint')}</p>

        <div className="simple-config-grid">
          <input
            className="text-input"
            placeholder={t('settings.configNamePlaceholder')}
            value={configName}
            onChange={(event) => { setConfigName(event.target.value); setDraftDirty(true) }}
          />

          <div className="protocol-detect-row">
            <input
              className="text-input"
              placeholder={t('runtime.baseUrlPlaceholder')}
              value={baseUrl}
              onChange={(event) => { setBaseUrl(event.target.value); setDraftDirty(true) }}
            />
            <span className={`protocol-badge ${detectedProtocol || ''}`}>{protocolDisplay(detectedProtocol, t)}</span>
          </div>

          <input
            className="text-input"
            placeholder={t('settings.modelPlaceholderHttp')}
            value={model}
            onChange={(event) => { setModel(event.target.value); setDraftDirty(true) }}
          />

          <input
            className="text-input"
            placeholder={t('settings.apiKeyPlaceholder')}
            value={apiKey}
            onChange={(event) => { setApiKey(event.target.value); setDraftDirty(true) }}
          />

          <textarea
            className="text-input config-textarea"
            placeholder={t('settings.systemPromptPlaceholder')}
            value={systemPrompt}
            onChange={(event) => { setSystemPrompt(event.target.value); setDraftDirty(true) }}
          />
        </div>

        {Array.isArray(editableActiveProfile?.modelCatalog) && editableActiveProfile.modelCatalog.length > 0 && (
          <div className="remote-profiles" style={{ marginTop: 12 }}>
            {editableActiveProfile.modelCatalog.map((item) => (
              <button key={item.id} type="button"
                className={`profile-item ${model === item.id ? 'active' : ''}`}
                onClick={() => { setModel(item.id); setDraftDirty(true) }}>
                <div className="profile-info">
                  <span className="profile-name">{item.label || item.id}</span>
                  <span className="profile-model">{item.id}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="button-row manual-config-actions">
          <button type="button" className="primary-button" onClick={() => void handleSaveCurrentProfile()} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {t('settings.saveAndSwitch')}
          </button>
          <button type="button" className="ghost-button" onClick={() => void handleCreateNewProfile()} disabled={busy}>
            <Plus size={14} />
            {t('settings.saveAsNew')}
          </button>
          <button type="button" className="ghost-button danger-outline"
            onClick={() => void handleDeleteProfile()} disabled={busy || !editableActiveProfile}>
            <Trash2 size={14} />
            {t('settings.deleteCurrentConfig')}
          </button>
        </div>
        {status && <p className="manual-config-status">{status}</p>}
      </div>

      <h3>{t('settings.existingConfigs')}</h3>
      <div className="remote-profiles">
        {editableProfiles.map((profile) => {
          const protocol = detectEndpointType(profile.baseUrl)
          return (
            <button key={profile.id} type="button"
              className={`profile-item ${activeRemoteProfileId === profile.id ? 'active' : ''}`}
              onClick={() => void handleActivateProfile(profile.id)}
              disabled={Boolean(switchingKey)}>
              <div className="profile-info">
                <span className="profile-name">{profile.name}</span>
                <span className="profile-model">
                  <span className={`endpoint-badge ${protocol || ''}`}>{endpointBadgeLabel(protocol, t)}</span> · {profile.model}
                </span>
              </div>
              {switchingKey === profile.id ? (
                <Loader2 size={14} className="spin" />
              ) : activeRemoteProfileId === profile.id ? (
                <span className="profile-badge">{t('settings.enabled')}</span>
              ) : null}
            </button>
          )
        })}
        {editableProfiles.length === 0 && (
          <p className="manual-config-status">{t('settings.noManualConfigs')}</p>
        )}
      </div>
    </div>
  )
}
