import React, { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Bot,
  Cpu,
  Globe,
  Loader2,
  Palette,
  Plus,
  Save,
  Settings2,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useI18n, setI18nLocale } from '../i18n'

type SettingsTab = 'appearance' | 'language' | 'behavior' | 'agent' | 'runtime'
type ManualProvider = 'Ollama' | 'Custom HTTP Provider'
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

function TabsComponent({ t }: { t: (key: string) => string }) {
  return [
    { id: 'appearance' as SettingsTab, label: t('settings.appearance'), icon: <Palette size={16} /> },
    { id: 'language' as SettingsTab, label: t('settings.language'), icon: <Globe size={16} /> },
    { id: 'behavior' as SettingsTab, label: t('settings.behavior'), icon: <Settings2 size={16} /> },
    { id: 'agent' as SettingsTab, label: t('settings.agent'), icon: <Bot size={16} /> },
    { id: 'runtime' as SettingsTab, label: t('settings.runtime'), icon: <Cpu size={16} /> },
  ]
}

function ToggleRow({
  title,
  hint,
  enabled,
  onToggle,
}: {
  title: string
  hint: string
  enabled: boolean
  onToggle: () => Promise<void> | void
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-copy">
        <span>{title}</span>
        <p className="hint">{hint}</p>
      </div>
      <button
        type="button"
        className={`toggle ${enabled ? 'on' : ''}`}
        onClick={() => void onToggle()}
      />
    </div>
  )
}

export function SettingsModal() {
  const { t, locale: i18nLocale } = useI18n()
  const {
    setSettingsOverlayOpen,
    activeSettingsTab,
    setActiveSettingsTab,
    theme,
    setTheme,
    locale,
    setLocale,
    compactMode,
    toggleCompactMode,
    enterToSend,
    toggleEnterToSend,
    autoScroll,
    toggleAutoScroll,
    showTaskPanel,
    toggleShowTaskPanel,
    confirmDangerousOps,
    toggleConfirmDangerousOps,
    accessScope,
    setAccessScope,
    autoSummarizeContext,
    toggleAutoSummarize,
    showRuntimeMeta,
    toggleShowRuntimeMeta,
    showExecutionPlan,
    toggleShowExecutionPlan,
    compressionThreshold,
    setCompressionThreshold,
    vgoAILoggedIn,
    vgoAIEmail,
    vgoAIDisplayName,
    vgoAIPreferredModel,
    engines,
    runtimeEngineId,
    remoteProfiles,
    activeRemoteProfileId,
    skills,
    hydrate,
  } = useAppStore()

  const TABS = useMemo(() => TabsComponent({ t }), [t, i18nLocale])

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [draftDirty, setDraftDirty] = useState(false)
  const [hydratedProfileId, setHydratedProfileId] = useState<string | null>(null)
  const [configName, setConfigName] = useState('')
  const [provider, setProvider] = useState<ManualProvider>('Ollama')
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:11434')
  const [modelListUrl, setModelListUrl] = useState('')
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
  const [modelCatalogBusy, setModelCatalogBusy] = useState(false)

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
  const visibleEngines = useMemo(
    () => engines.filter((engine) => engine.id === 'ollama' || engine.id === 'vgo-remote'),
    [engines],
  )
  const engineDescriptions = useMemo(
    () => ({
      ollama: t('settings.ollamaDesc'),
      'vgo-remote': t('settings.vgoRemoteDesc'),
    }),
    [t, i18nLocale],
  )

  useEffect(() => {
    if (locale !== i18nLocale) {
      setLocale(i18nLocale as 'zh-CN' | 'en-US')
    }
  }, [i18nLocale, locale, setLocale])

  const refreshState = async () => {
    const nextState = await window.vgoDesktop?.getState?.()
    if (nextState) hydrate(nextState)
  }

  const fillDraftFromProfile = (profile: (typeof remoteProfiles)[number] | null) => {
    if (!profile) {
      setConfigName('')
      setProvider('Ollama')
      setBaseUrl('http://127.0.0.1:11434')
      setModelListUrl('')
      setModel('')
      setApiKey('')
      setSystemPrompt('')
      return
    }

    const nextProvider: ManualProvider =
      profile.provider === 'Ollama' ? 'Ollama' : 'Custom HTTP Provider'
    setConfigName(profile.name || '')
    setProvider(nextProvider)
    setBaseUrl(
      profile.baseUrl ||
        (nextProvider === 'Ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:3210'),
    )
    setModelListUrl(profile.modelListUrl || '')
    setModel(profile.model || '')
    setApiKey(profile.apiKey || '')
    setSystemPrompt(profile.systemPrompt || '')
  }

  useEffect(() => {
    if (draftDirty && hydratedProfileId === activeRemoteProfileId) return
    fillDraftFromProfile(editableActiveProfile)
    setHydratedProfileId(activeRemoteProfileId)
    setDraftDirty(false)
  }, [editableActiveProfile, activeRemoteProfileId, draftDirty, hydratedProfileId])

  const formatUpdateLastCheckTime = useCallback((timestamp: number) => {
    if (!timestamp) {
      return t('settings.update.neverChecked')
    }
    try {
      return new Date(timestamp).toLocaleString()
    } catch {
      return t('settings.update.neverChecked')
    }
  }, [t])

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

  const loadUpdateSettings = useCallback(async () => {
    try {
      const settings = await window.vgoDesktop?.getUpdateSettings?.()
      if (!settings) return
      setUpdateAutoCheck(Boolean(settings.autoCheck))
      setUpdateIntervalHours(Number(settings.checkIntervalHours) || 6)
      setUpdateLastCheckTime(Number(settings.lastCheckTime) || 0)
      setUpdateSkipVersion(String(settings.skipVersion || ''))
    } catch (error: any) {
      setUpdateStatus(error?.message || t('settings.operationFailed'))
    }
  }, [t])

  useEffect(() => {
    if (activeSettingsTab === 'runtime') {
      void loadUpdateSettings()
    }
  }, [activeSettingsTab, loadUpdateSettings])

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
            `正在下载更新包：${progressPercent.toFixed(1)}%（${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}）`,
          )
        } else {
          setUpdateStatus(`正在下载更新包：${formatBytes(downloadedBytes)}`)
        }
      } else if (payload?.status === 'downloaded') {
        setUpdateProgress((prev) => ({
          status: 'downloaded',
          downloadedBytes: prev?.downloadedBytes || 0,
          totalBytes: prev?.totalBytes || prev?.downloadedBytes || 0,
          speedBytesPerSec: prev?.speedBytesPerSec || 0,
          progressPercent: 100,
        }))
        setUpdateStatus('更新包下载完成，正在准备安装...')
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
        setUpdateStatus('安装程序已启动，应用即将重启完成升级...')
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
    } catch (error: any) {
      setUpdateStatus(error?.message || t('settings.operationFailed'))
    } finally {
      setUpdateBusy(false)
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

  const withStatus = async (message: string, fn: () => Promise<void>) => {
    setStatus(message)
    setBusy(true)
    try {
      await fn()
      window.setTimeout(() => setStatus(''), 1400)
    } catch (error: any) {
      setStatus(error?.message || t('settings.operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const applyAppearance = async (payload: Record<string, unknown>) => {
    await withStatus(t('settings.saving'), async () => {
      const result = await window.vgoDesktop?.updateAppearance?.(payload)
      if (result) {
        hydrate(result)
      }
    })
  }

  const applyLocalization = async (payload: Record<string, unknown>) => {
    await withStatus(t('settings.savingLanguage'), async () => {
      const result = await window.vgoDesktop?.updateLocalization?.(payload)
      if (result) {
        hydrate(result)
      }
    })
  }

  const applyBehavior = async (payload: Record<string, unknown>) => {
    await withStatus(t('settings.savingBehavior'), async () => {
      const result = await window.vgoDesktop?.updateBehavior?.(payload)
      if (result) {
        hydrate(result)
      }
    })
  }

  const applyAccess = async (payload: Record<string, unknown>) => {
    await withStatus(t('settings.savingAccess'), async () => {
      const result = await window.vgoDesktop?.updateAccess?.(payload)
      if (result) {
        hydrate(result)
      }
    })
  }

  const applyAgentPrefs = async (payload: Record<string, unknown>) => {
    await withStatus(t('settings.savingAgent'), async () => {
      const result = await window.vgoDesktop?.updateAgentPreferences?.(payload)
      if (result) {
        hydrate(result)
      }
    })
  }

  const handleSaveCurrentProfile = async () => {
    const payload = {
      name: configName.trim() || t('settings.unnamedConfig'),
      provider,
      baseUrl: baseUrl.trim(),
      modelListUrl: provider === 'Ollama' ? '' : modelListUrl.trim(),
      ollamaUrl: provider === 'Ollama' ? baseUrl.trim() : undefined,
      model: model.trim(),
      apiKey: apiKey.trim(),
      systemPrompt,
      activate: true,
    }

    await withStatus(t('settings.savingConfig'), async () => {
      if (editableActiveProfile) {
        const result = await window.vgoDesktop?.updateRemoteProfile?.(editableActiveProfile.id, payload)
        await window.vgoDesktop?.setEngine?.(provider === 'Ollama' ? 'ollama' : 'vgo-remote')
        await window.vgoDesktop?.selectRemoteProfile?.(editableActiveProfile.id)
        if (result) hydrate(result)
      } else {
        const result = await window.vgoDesktop?.createRemoteProfile?.(payload)
        await window.vgoDesktop?.setEngine?.(provider === 'Ollama' ? 'ollama' : 'vgo-remote')
        if (result) hydrate(result)
      }
    })
  }

  const handleCreateNewProfile = async () => {
    const payload = {
      name: configName.trim() || t('settings.newConfig'),
      provider,
      baseUrl: baseUrl.trim(),
      modelListUrl: provider === 'Ollama' ? '' : modelListUrl.trim(),
      ollamaUrl: provider === 'Ollama' ? baseUrl.trim() : undefined,
      model: model.trim(),
      apiKey: apiKey.trim(),
      systemPrompt,
      activate: true,
    }

    await withStatus(t('settings.creatingConfig'), async () => {
      const result = await window.vgoDesktop?.createRemoteProfile?.(payload)
      await window.vgoDesktop?.setEngine?.(provider === 'Ollama' ? 'ollama' : 'vgo-remote')
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

  const handleRefreshProfileModels = async () => {
    if (provider === 'Ollama' || !editableActiveProfile) return
    setModelCatalogBusy(true)
    try {
      const result = await window.vgoDesktop?.refreshRemoteProfileModels?.(editableActiveProfile.id)
      if (result) {
        hydrate(result)
      } else {
        await refreshState()
      }
      setStatus('云模型列表已刷新')
    } catch (error: any) {
      setStatus(error?.message || '刷新云模型列表失败')
    } finally {
      setModelCatalogBusy(false)
    }
  }

  const handleActivateProfile = async (profileId: string, profileProvider: string) => {
    setSwitchingKey(profileId)
    try {
      await window.vgoDesktop?.setEngine?.(profileProvider === 'Ollama' ? 'ollama' : 'vgo-remote')
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

  const handleToggleSkill = async (skillId: string, enabled: boolean) => {
    await withStatus(`${enabled ? t('settings.enabling') : t('settings.disabling')} Skill...`, async () => {
      await window.vgoDesktop?.updateSkillState?.({ id: skillId, enabled })
    })
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
    <div className="modal-overlay" onClick={() => setSettingsOverlayOpen(false)}>
      <div className="modal settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header settings-header">
          <div>
            <h2>{t('settings.title')}</h2>
            <p className="hint">{t('settings.hint')}</p>
          </div>
          <button type="button" className="icon-button" onClick={() => setSettingsOverlayOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div className="settings-layout">
          <aside className="settings-sidebar">
            <div className="settings-sidebar-card">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`settings-tab ${activeSettingsTab === tab.id ? 'active' : ''}`}
                  onClick={() => setActiveSettingsTab(tab.id)}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="settings-content">
            {activeSettingsTab === 'appearance' && (
              <div className="settings-section">
                <h3>{t('settings.theme')}</h3>
                <div className="theme-grid">
                  {[
                    ['aurora', t('settings.theme.aurora')],
                    ['graphite', t('settings.theme.graphite')],
                    ['paper-light', t('settings.theme.paper')],
                    ['solar', t('settings.theme.solar')],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`theme-card ${theme === id ? 'active' : ''}`}
                      onClick={async () => {
                        setTheme(id as any)
                        await applyAppearance({ theme: id })
                      }}
                    >
                      <span>{label}</span>
                    </button>
                  ))}
                </div>

                <ToggleRow
                  title={t('settings.compactLayout')}
                  hint={t('settings.compactLayoutHint')}
                  enabled={compactMode}
                  onToggle={async () => {
                    toggleCompactMode()
                    await applyAppearance({ compactMode: !compactMode })
                  }}
                />
              </div>
            )}

            {activeSettingsTab === 'language' && (
              <div className="settings-section">
                <h3>{t('settings.locale')}</h3>
                <div className="language-grid">
                  {[
                    ['zh-CN', t('settings.zhCN')],
                    ['en-US', t('settings.enUS')],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`theme-card ${locale === id ? 'active' : ''}`}
                      onClick={async () => {
                        setLocale(id as any)
                        setI18nLocale(id as any)
                        await applyLocalization({ locale: id })
                      }}
                    >
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeSettingsTab === 'behavior' && (
              <div className="settings-section">
                <ToggleRow
                  title={t('settings.enterToSend')}
                  hint={t('settings.enterToSendHint')}
                  enabled={enterToSend}
                  onToggle={async () => {
                    toggleEnterToSend()
                    await applyBehavior({ enterToSend: !enterToSend })
                  }}
                />
                <ToggleRow
                  title={t('settings.autoScroll')}
                  hint={t('settings.autoScrollHint')}
                  enabled={autoScroll}
                  onToggle={async () => {
                    toggleAutoScroll()
                    await applyBehavior({ autoScroll: !autoScroll })
                  }}
                />
                <ToggleRow
                  title={t('settings.taskPanel')}
                  hint={t('settings.taskPanelHint')}
                  enabled={showTaskPanel}
                  onToggle={async () => {
                    toggleShowTaskPanel()
                    await applyBehavior({ showTaskPanel: !showTaskPanel })
                  }}
                />
                <ToggleRow
                  title={t('settings.confirmDanger')}
                  hint={t('settings.confirmDangerHint')}
                  enabled={confirmDangerousOps}
                  onToggle={async () => {
                    toggleConfirmDangerousOps()
                    await applyBehavior({ confirmDangerousOps: !confirmDangerousOps })
                  }}
                />

                <div className="slider-row">
                  <div>
                    <span>{t('settings.accessScope')}</span>
                    <p className="hint">{t('settings.accessScopeHint')}</p>
                  </div>
                  <div className="language-grid">
                    {[
                      ['workspace-only', t('settings.workspaceOnly')],
                      ['workspace-and-desktop', t('settings.workspaceAndDesktop')],
                      ['full-system', t('settings.fullSystem')],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`theme-card ${accessScope === id ? 'active' : ''}`}
                        onClick={async () => {
                          setAccessScope(id as 'workspace-only' | 'workspace-and-desktop' | 'full-system')
                          await applyAccess({ scope: id })
                        }}
                      >
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeSettingsTab === 'agent' && (
              <div className="settings-section">
                <ToggleRow
                  title={t('settings.autoCompress')}
                  hint={t('settings.autoCompressHint')}
                  enabled={autoSummarizeContext}
                  onToggle={async () => {
                    toggleAutoSummarize()
                    await applyAgentPrefs({ autoSummarizeContext: !autoSummarizeContext })
                  }}
                />
                <div className="slider-row">
                  <div>
                    <span>{t('settings.compressionThreshold')}</span>
                    <p className="hint">{t('settings.compressionThresholdHint')}</p>
                  </div>
                  <div className="slider-control">
                    <input
                      type="range"
                      min={0.5}
                      max={0.98}
                      step={0.01}
                      value={compressionThreshold}
                      onChange={async (event) => {
                        const next = Number(event.target.value)
                        setCompressionThreshold(next)
                        await applyAgentPrefs({ contextCompressionThreshold: next })
                      }}
                    />
                    <span>{Math.round(compressionThreshold * 100)}%</span>
                  </div>
                </div>
                <ToggleRow
                  title={t('settings.showRuntimeMeta')}
                  hint={t('settings.showRuntimeMetaHint')}
                  enabled={showRuntimeMeta}
                  onToggle={async () => {
                    toggleShowRuntimeMeta()
                    await applyAgentPrefs({ showRuntimeMeta: !showRuntimeMeta })
                  }}
                />
                <ToggleRow
                  title={t('settings.showExecutionPlan')}
                  hint={t('settings.showExecutionPlanHint')}
                  enabled={showExecutionPlan}
                  onToggle={async () => {
                    toggleShowExecutionPlan()
                    await applyAgentPrefs({ showExecutionPlan: !showExecutionPlan })
                  }}
                />

                <h3>{t('settings.installedSkills')}</h3>
                <div className="manual-config-card">
                  <p className="hint">{t('settings.skillsHint')}</p>
                  <div className="remote-profiles skill-list">
                    {skills.map((skill) => (
                      <div key={skill.id} className={`profile-item skill-item ${skill.enabled ? 'active' : ''}`}>
                        <div className="profile-info">
                          <span className="profile-name">{skill.name}</span>
                          <span className="profile-model">
                            {skill.source} · {skill.path}
                          </span>
                          <span className="hint">{skill.description}</span>
                        </div>
                        <button
                          type="button"
                          className={`skill-toggle-button ${skill.enabled ? 'ghost-button' : 'primary-button'}`}
                          onClick={() => void handleToggleSkill(skill.id, !skill.enabled)}
                          disabled={busy}
                        >
                          {skill.enabled ? t('settings.disable') : t('settings.enable')}
                        </button>
                      </div>
                    ))}
                    {skills.length === 0 && (
                      <p className="manual-config-status">{t('settings.noSkills')}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeSettingsTab === 'runtime' && (
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
                  {visibleEngines.map((engine) => (
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
                          {engineDescriptions[engine.id as 'ollama' | 'vgo-remote']}
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
                  <p className="hint">
                    {t('settings.capabilityMaintenanceHint')}
                  </p>
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
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void handleCheckForUpdatesNow()}
                      disabled={updateBusy}
                    >
                      {updateBusy ? <Loader2 size={14} className="spin" /> : <Wrench size={14} />}
                      {t('settings.update.checkNow')}
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void handleInstallUpdateNow()}
                      disabled={updateBusy || !updateCandidate?.latestVersion}
                    >
                      <Save size={14} />
                      {t('settings.update.installNow')}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void handleApplyUpdateSettings()}
                      disabled={updateBusy}
                    >
                      <Save size={14} />
                      {t('settings.update.saveConfig')}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void handleResetSkippedVersion()}
                      disabled={updateBusy}
                    >
                      <Wrench size={14} />
                      {t('settings.update.resetSkip')}
                    </button>
                  </div>

                  {updateProgress && (
                    <div className="update-progress-card">
                      <div className="update-progress-head">
                        <span>更新进度</span>
                        <span>{Math.max(0, Math.min(100, updateProgress.progressPercent)).toFixed(1)}%</span>
                      </div>
                      <div className="update-progress-track">
                        <div
                          className="update-progress-fill"
                          style={{ width: `${Math.max(0, Math.min(100, updateProgress.progressPercent))}%` }}
                        />
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
                  <p className="hint">
                    {t('settings.manualConfigHint')}
                  </p>

                  <div className="simple-config-grid">
                    <input
                      className="text-input"
                      placeholder={t('settings.configNamePlaceholder')}
                      value={configName}
                      onChange={(event) => {
                        setConfigName(event.target.value)
                        setDraftDirty(true)
                      }}
                    />

                    <select
                      className="text-input"
                      value={provider}
                      onChange={(event) => {
                        const nextProvider = event.target.value as ManualProvider
                        setDraftDirty(true)
                        setProvider(nextProvider)
                        setBaseUrl(
                          nextProvider === 'Ollama'
                            ? 'http://127.0.0.1:11434'
                            : 'http://127.0.0.1:3210',
                        )
                        setModelListUrl(nextProvider === 'Ollama' ? '' : 'http://127.0.0.1:3210/v1/models')
                      }}
                    >
                      <option value="Ollama">{t('settings.localOllama')}</option>
                      <option value="Custom HTTP Provider">{t('settings.cloudHttpProvider')}</option>
                    </select>

                    <input
                      className="text-input"
                      placeholder={
                        provider === 'Ollama'
                          ? 'http://127.0.0.1:11434'
                          : 'https://api.example.com'
                      }
                      value={baseUrl}
                      onChange={(event) => {
                        setBaseUrl(event.target.value)
                        setDraftDirty(true)
                      }}
                    />

                    {provider !== 'Ollama' && (
                      <input
                        className="text-input"
                        placeholder="Model list URL (optional), e.g. https://api.example.com/v1/models"
                        value={modelListUrl}
                        onChange={(event) => {
                          setModelListUrl(event.target.value)
                          setDraftDirty(true)
                        }}
                      />
                    )}

                    <input
                      className="text-input"
                      placeholder={provider === 'Ollama' ? t('settings.modelPlaceholderOllama') : t('settings.modelPlaceholderHttp')}
                      value={model}
                      onChange={(event) => {
                        setModel(event.target.value)
                        setDraftDirty(true)
                      }}
                    />

                    {provider !== 'Ollama' && (
                      <input
                        className="text-input"
                        placeholder={t('settings.apiKeyPlaceholder')}
                        value={apiKey}
                        onChange={(event) => {
                          setApiKey(event.target.value)
                          setDraftDirty(true)
                        }}
                      />
                    )}

                    <textarea
                      className="text-input config-textarea"
                      placeholder={t('settings.systemPromptPlaceholder')}
                      value={systemPrompt}
                      onChange={(event) => {
                        setSystemPrompt(event.target.value)
                        setDraftDirty(true)
                      }}
                    />
                  </div>

                  {provider !== 'Ollama' && editableActiveProfile && (
                    <div className="manual-config-card" style={{ marginTop: 12 }}>
                      <div className="button-row manual-config-actions">
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => void handleRefreshProfileModels()}
                          disabled={modelCatalogBusy || busy}
                        >
                          {modelCatalogBusy ? <Loader2 size={14} className="spin" /> : <Wrench size={14} />}
                          刷新云模型列表
                        </button>
                      </div>
                      {Array.isArray(editableActiveProfile.modelCatalog) && editableActiveProfile.modelCatalog.length > 0 && (
                        <div className="remote-profiles" style={{ marginTop: 8 }}>
                          {editableActiveProfile.modelCatalog.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className={`profile-item ${model === item.id ? 'active' : ''}`}
                              onClick={() => {
                                setModel(item.id)
                                setDraftDirty(true)
                              }}
                            >
                              <div className="profile-info">
                                <span className="profile-name">{item.label || item.id}</span>
                                <span className="profile-model">{item.id}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
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
                    <button
                      type="button"
                      className="ghost-button danger-outline"
                      onClick={() => void handleDeleteProfile()}
                      disabled={busy || !editableActiveProfile}
                    >
                      <Trash2 size={14} />
                      {t('settings.deleteCurrentConfig')}
                    </button>
                  </div>
                  {status && <p className="manual-config-status">{status}</p>}
                </div>

                <h3>{t('settings.existingConfigs')}</h3>
                <div className="remote-profiles">
                  {editableProfiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className={`profile-item ${activeRemoteProfileId === profile.id ? 'active' : ''}`}
                      onClick={() => void handleActivateProfile(profile.id, profile.provider)}
                      disabled={Boolean(switchingKey)}
                    >
                      <div className="profile-info">
                        <span className="profile-name">{profile.name}</span>
                        <span className="profile-model">
                          {profile.provider} · {profile.model}
                        </span>
                      </div>
                      {switchingKey === profile.id ? (
                        <Loader2 size={14} className="spin" />
                      ) : activeRemoteProfileId === profile.id ? (
                        <span className="profile-badge">{t('settings.enabled')}</span>
                      ) : null}
                    </button>
                  ))}
                  {editableProfiles.length === 0 && (
                    <p className="manual-config-status">{t('settings.noManualConfigs')}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
