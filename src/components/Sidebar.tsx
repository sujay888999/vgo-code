import React, { useCallback, useMemo, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useI18n } from '../i18n'
import {
  FolderOpen,
  Settings,
  Plus,
  Search,
  LogIn,
  LogOut,
  Pin,
  Trash2,
  ChevronDown,
  ChevronUp,
  Bot,
  User,
  Zap,
  Globe,
  Loader2,
  Star,
} from 'lucide-react'

type ModelPrefs = {
  favorites: string[]
  recent: string[]
  collapsedFamilies: string[]
}

type CloudModelEntry = {
  key: string
  source: 'default-cloud' | 'custom-cloud'
  profileId: string
  profileName: string
  modelId: string
  modelLabel: string
  family: string
}

const MODEL_PREFS_STORAGE_KEY = 'vgo.code.model.prefs.v1'

function readModelPrefs(): ModelPrefs {
  try {
    const raw = window.localStorage.getItem(MODEL_PREFS_STORAGE_KEY)
    if (!raw) return { favorites: [], recent: [], collapsedFamilies: [] }
    const parsed = JSON.parse(raw)
    return {
      favorites: Array.isArray(parsed?.favorites) ? parsed.favorites.filter((item: unknown) => typeof item === 'string') : [],
      recent: Array.isArray(parsed?.recent) ? parsed.recent.filter((item: unknown) => typeof item === 'string') : [],
      collapsedFamilies: Array.isArray(parsed?.collapsedFamilies)
        ? parsed.collapsedFamilies.filter((item: unknown) => typeof item === 'string')
        : [],
    }
  } catch {
    return { favorites: [], recent: [], collapsedFamilies: [] }
  }
}

function writeModelPrefs(prefs: ModelPrefs) {
  try {
    window.localStorage.setItem(MODEL_PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {}
}

function detectModelFamily(modelId: string, modelLabel: string) {
  const id = String(modelId || '').toLowerCase()
  const label = String(modelLabel || '').toLowerCase()
  const text = `${id} ${label}`

  if (text.includes('gpt') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) return 'OpenAI'
  if (text.includes('claude')) return 'Claude'
  if (text.includes('gemini')) return 'Gemini'
  if (text.includes('glm')) return 'GLM'
  if (text.includes('qwen') || text.includes('tongyi')) return 'Qwen'
  if (text.includes('deepseek')) return 'DeepSeek'
  if (text.includes('llama')) return 'Llama'
  if (text.includes('mistral')) return 'Mistral'

  const prefix = String(modelId || '')
    .split(/[-_:/.]/)
    .filter(Boolean)[0]
  return prefix ? prefix.toUpperCase() : 'Other'
}

export function Sidebar() {
  const { t, locale } = useI18n()
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    hydrate,
    vgoAILoggedIn,
    vgoAIDisplayName,
    vgoAIEmail,
    vgoAIPreferredModel,
    modelCatalog,
    remoteProfiles,
    activeRemoteProfileId,
    runtimeEngineId,
    setSettingsOverlayOpen,
    setRenameOverlayOpen,
    workspace,
  } = useAppStore()

  const [sessionSearch, setSessionSearch] = useState('')
  const [collapsedProjectPaths, setCollapsedProjectPaths] = useState<string[]>([])
  const [modelsExpanded, setModelsExpanded] = useState(true)
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [loginEmail, setLoginEmail] = useState(vgoAIEmail || '')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginDisplayName, setLoginDisplayName] = useState(vgoAIDisplayName || 'VGO AI Developer')
  const [loginStatus, setLoginStatus] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [switchingKey, setSwitchingKey] = useState<string | null>(null)
  const [modelSearch, setModelSearch] = useState('')
  const [modelPrefs, setModelPrefs] = useState<ModelPrefs>(() => readModelPrefs())

  const updateModelPrefs = useCallback((updater: (prev: ModelPrefs) => ModelPrefs) => {
    setModelPrefs((prev) => {
      const next = updater(prev)
      writeModelPrefs(next)
      return next
    })
  }, [])

  const markModelUsed = useCallback(
    (entryKey: string) => {
      if (!entryKey) return
      updateModelPrefs((prev) => ({
        ...prev,
        recent: [entryKey, ...prev.recent.filter((item) => item !== entryKey)].slice(0, 30),
      }))
    },
    [updateModelPrefs],
  )

  const toggleFavoriteModel = useCallback(
    (entryKey: string) => {
      if (!entryKey) return
      updateModelPrefs((prev) => {
        const exists = prev.favorites.includes(entryKey)
        return {
          ...prev,
          favorites: exists
            ? prev.favorites.filter((item) => item !== entryKey)
            : [entryKey, ...prev.favorites.filter((item) => item !== entryKey)].slice(0, 30),
        }
      })
    },
    [updateModelPrefs],
  )

  const toggleFamilyCollapsed = useCallback(
    (family: string) => {
      updateModelPrefs((prev) => ({
        ...prev,
        collapsedFamilies: prev.collapsedFamilies.includes(family)
          ? prev.collapsedFamilies.filter((item) => item !== family)
          : [...prev.collapsedFamilies, family],
      }))
    },
    [updateModelPrefs],
  )

  const refreshState = useCallback(async () => {
    const result = await window.vgoDesktop?.getState?.()
    if (result) hydrate(result)
  }, [hydrate])

  const handleCreateSession = useCallback(async () => {
    try {
      const result = await window.vgoDesktop?.createSession?.()
      if (result?.state) {
        hydrate(result.state)
      } else {
        await refreshState()
      }
    } catch (e) {
      console.error('Failed to create session:', e)
    }
  }, [hydrate, refreshState])

  const handleSwitchSession = useCallback(
    async (sessionId: string) => {
      try {
        const result = await window.vgoDesktop?.switchSession?.(sessionId)
        if (result?.state) {
          hydrate(result.state)
        } else if (result) {
          hydrate(result)
        } else {
          setActiveSessionId(sessionId)
        }
      } catch (e) {
        console.error('Failed to switch session:', e)
        setActiveSessionId(sessionId)
      }
    },
    [hydrate, setActiveSessionId],
  )

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        const result = await window.vgoDesktop?.deleteSession?.(sessionId)
        if (result?.state) {
          hydrate(result.state)
        } else {
          await refreshState()
        }
      } catch (e) {
        console.error('Failed to delete session:', e)
      }
    },
    [refreshState, hydrate],
  )

  const handleResetSession = useCallback(async () => {
    try {
      const result = await window.vgoDesktop?.resetSession?.()
      if (result?.state) {
        hydrate(result.state)
      } else {
        await refreshState()
      }
    } catch (e) {
      console.error('Failed to reset session:', e)
    }
  }, [hydrate, refreshState])

  const handleModelSelect = useCallback(
    async (modelId: string, entryKey = '') => {
      try {
        setSwitchingKey(`cloud-${modelId}`)
        await window.vgoDesktop?.selectRemoteProfile?.('default')
        await window.vgoDesktop?.setEngine?.('vgo-remote')
        await window.vgoDesktop?.updateVgoAiProfile?.({
          preferredModel: modelId,
          useDefaultCloudProfile: true,
        })
        await refreshState()
        markModelUsed(entryKey || `default:${modelId}`)
      } catch (e) {
        console.error('Failed to switch cloud model:', e)
      } finally {
        setSwitchingKey(null)
      }
    },
    [refreshState, markModelUsed],
  )

  const handleProfileSelect = useCallback(
    async (profileId: string) => {
      try {
        const profile = remoteProfiles.find((p) => p.id === profileId)
        if (!profile) return
        setSwitchingKey(`profile-${profileId}`)
        await window.vgoDesktop?.setEngine?.(profile.provider === 'Ollama' ? 'ollama' : 'vgo-remote')
        await window.vgoDesktop?.selectRemoteProfile?.(profileId)
        await refreshState()
      } catch (e) {
        console.error('Failed to switch profile:', e)
      } finally {
        setSwitchingKey(null)
      }
    },
    [refreshState, remoteProfiles],
  )

  const handleCustomCloudModelSelect = useCallback(
    async (profileId: string, modelId: string, entryKey = '') => {
      try {
        setSwitchingKey(`custom-cloud-${profileId}-${modelId}`)
        await window.vgoDesktop?.updateRemoteProfile?.(profileId, { model: modelId })
        await window.vgoDesktop?.setEngine?.('vgo-remote')
        await window.vgoDesktop?.selectRemoteProfile?.(profileId)
        await refreshState()
        markModelUsed(entryKey || `custom:${profileId}:${modelId}`)
      } catch (e) {
        console.error('Failed to switch custom cloud model:', e)
      } finally {
        setSwitchingKey(null)
      }
    },
    [refreshState, markModelUsed],
  )

  const handleBrowserLogin = useCallback(async () => {
    setIsLoggingIn(true)
    setLoginStatus(t('status.openingLoginPage'))
    try {
      await window.vgoDesktop?.login?.()
      setLoginStatus(t('status.loginPageOpened'))
    } catch (e: any) {
      setLoginStatus(e?.message || t('status.loginFailed'))
    } finally {
      setIsLoggingIn(false)
    }
  }, [t])

  const handlePasswordLogin = useCallback(async () => {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setLoginStatus(t('status.enterEmailPassword'))
      return
    }
    setIsLoggingIn(true)
    setLoginStatus(t('status.loggingIn'))
    try {
      await window.vgoDesktop?.loginWithCredentials?.({
        email: loginEmail.trim(),
        password: loginPassword,
        displayName: loginDisplayName.trim() || 'VGO AI Developer',
        preferredModel: vgoAIPreferredModel || 'vgo-coder-pro',
      })
      await refreshState()
      setLoginPassword('')
      setLoginStatus(t('status.loginSuccess'))
      setShowPasswordForm(false)
    } catch (e: any) {
      setLoginStatus(e?.message || t('status.loginError'))
    } finally {
      setIsLoggingIn(false)
    }
  }, [t, loginEmail, loginPassword, loginDisplayName, vgoAIPreferredModel, refreshState])

  const handleLogout = useCallback(async () => {
    try {
      await window.vgoDesktop?.logout?.()
      await refreshState()
      setLoginStatus(t('status.loggedOut'))
    } catch (e: any) {
      setLoginStatus(e?.message || t('status.logoutError'))
    }
  }, [t, refreshState])

  const filteredSessions = useMemo(() => {
    const keyword = sessionSearch.trim().toLowerCase()
    if (!keyword) return sessions
    return sessions.filter((s) => {
      const projectPath = String(s.directory || '').toLowerCase()
      const projectName = projectPath.split(/[/\\]/).pop() || ''
      return (
        s.title.toLowerCase().includes(keyword) ||
        s.preview.toLowerCase().includes(keyword) ||
        projectPath.includes(keyword) ||
        projectName.toLowerCase().includes(keyword)
      )
    })
  }, [sessions, sessionSearch])

  const projectGroups = useMemo(() => {
    const map = new Map<string, { path: string; name: string; sessions: typeof sessions }>()
    for (const session of filteredSessions) {
      const projectPath = String(session.directory || workspace || '').trim() || '__unassigned__'
      const projectName =
        projectPath === '__unassigned__'
          ? locale === 'en-US'
            ? 'Unassigned'
            : '未绑定目录'
          : projectPath.split(/[/\\]/).pop() || projectPath

      const current = map.get(projectPath)
      if (!current) {
        map.set(projectPath, { path: projectPath, name: projectName, sessions: [session] })
        continue
      }
      current.sessions.push(session)
    }

    return [...map.values()]
      .map((group) => ({
        ...group,
        sessions: [...group.sessions].sort((a, b) => {
          if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        }),
      }))
      .sort((a, b) => {
        const activeInA = a.sessions.some((session) => session.id === activeSessionId)
        const activeInB = b.sessions.some((session) => session.id === activeSessionId)
        if (activeInA !== activeInB) return activeInA ? -1 : 1
        const aLatest = a.sessions[0]?.updatedAt ? new Date(a.sessions[0].updatedAt).getTime() : 0
        const bLatest = b.sessions[0]?.updatedAt ? new Date(b.sessions[0].updatedAt).getTime() : 0
        return bLatest - aLatest
      })
  }, [activeSessionId, filteredSessions, locale, workspace, sessions])

  const toggleProjectCollapsed = useCallback((projectPath: string) => {
    setCollapsedProjectPaths((prev) =>
      prev.includes(projectPath) ? prev.filter((item) => item !== projectPath) : [...prev, projectPath],
    )
  }, [])

  const currentModelDisplay = useMemo(() => {
    const activeProfile = remoteProfiles.find((p) => p.id === activeRemoteProfileId)
    const isLocalProfile = activeProfile?.provider === 'Ollama'
    const isManualCloudProfile = Boolean(activeProfile && activeProfile.id !== 'default' && !isLocalProfile)
    if (activeProfile && (isLocalProfile || isManualCloudProfile)) {
      return { name: activeProfile.name, model: activeProfile.model, isLocal: isLocalProfile }
    }
    const cloudModel = modelCatalog.find((m) => m.id === vgoAIPreferredModel)
    return {
      name: cloudModel?.label || vgoAIPreferredModel || t('sidebar.noModelSelected'),
      model: vgoAIPreferredModel || '',
      isLocal: false,
    }
  }, [remoteProfiles, activeRemoteProfileId, modelCatalog, vgoAIPreferredModel, t])

  const localProfiles = remoteProfiles.filter((p) => p.provider === 'Ollama')
  const manualCloudProfiles = remoteProfiles.filter((p) => p.provider !== 'Ollama' && p.id !== 'default')
  const activeProfile = remoteProfiles.find((p) => p.id === activeRemoteProfileId) || null
  const defaultCloudProfile =
    remoteProfiles.find((p) => p.id === 'default') ||
    remoteProfiles.find((p) => p.provider !== 'Ollama') ||
    null
  const cloudEngineSelected =
    runtimeEngineId === 'vgo-remote' &&
    (!activeProfile || activeProfile.id === 'default' || activeProfile.provider === 'VGO Remote')
  const cloudSelectedModelId = modelCatalog.some((model) => model.id === vgoAIPreferredModel)
    ? vgoAIPreferredModel
    : defaultCloudProfile?.model || vgoAIPreferredModel

  const cloudModelEntries = useMemo<CloudModelEntry[]>(() => {
    const fromDefault = modelCatalog.map((model) => ({
      key: `default:${model.id}`,
      source: 'default-cloud' as const,
      profileId: 'default',
      profileName: defaultCloudProfile?.name || '默认云端',
      modelId: model.id,
      modelLabel: model.label || model.id,
      family: detectModelFamily(model.id, model.label || model.id),
    }))

    const fromCustom = manualCloudProfiles.flatMap((profile) => {
      const profileModels = Array.isArray(profile.modelCatalog) ? profile.modelCatalog : []
      const uniqueModels = new Map<string, { id: string; label?: string }>()
      for (const model of profileModels) {
        const modelId = String(model?.id || '').trim()
        if (!modelId || uniqueModels.has(modelId)) continue
        uniqueModels.set(modelId, { id: modelId, label: model?.label || modelId })
      }
      return [...uniqueModels.values()].map((model) => ({
        key: `custom:${profile.id}:${model.id}`,
        source: 'custom-cloud' as const,
        profileId: profile.id,
        profileName: profile.name,
        modelId: model.id,
        modelLabel: model.label || model.id,
        family: detectModelFamily(model.id, model.label || model.id),
      }))
    })

    return [...fromCustom, ...fromDefault]
  }, [modelCatalog, manualCloudProfiles, defaultCloudProfile?.name])

  const filteredCloudEntries = useMemo(() => {
    const keyword = modelSearch.trim().toLowerCase()
    if (!keyword) return cloudModelEntries
    return cloudModelEntries.filter((entry) =>
      `${entry.modelId} ${entry.modelLabel} ${entry.profileName} ${entry.family}`.toLowerCase().includes(keyword),
    )
  }, [cloudModelEntries, modelSearch])

  const favoriteCloudEntries = useMemo(() => {
    const order = new Map(modelPrefs.favorites.map((key, index) => [key, index]))
    return filteredCloudEntries
      .filter((entry) => order.has(entry.key))
      .sort((a, b) => (order.get(a.key) ?? 9999) - (order.get(b.key) ?? 9999))
  }, [filteredCloudEntries, modelPrefs.favorites])

  const recentCloudEntries = useMemo(() => {
    const favoriteSet = new Set(modelPrefs.favorites)
    const order = new Map(modelPrefs.recent.map((key, index) => [key, index]))
    return filteredCloudEntries
      .filter((entry) => !favoriteSet.has(entry.key) && order.has(entry.key))
      .sort((a, b) => (order.get(a.key) ?? 9999) - (order.get(b.key) ?? 9999))
      .slice(0, 10)
  }, [filteredCloudEntries, modelPrefs.favorites, modelPrefs.recent])

  const familyGroups = useMemo(() => {
    const pinned = new Set([
      ...favoriteCloudEntries.map((entry) => entry.key),
      ...recentCloudEntries.map((entry) => entry.key),
    ])
    const grouped = new Map<string, CloudModelEntry[]>()
    for (const entry of filteredCloudEntries) {
      if (pinned.has(entry.key)) continue
      const list = grouped.get(entry.family) || []
      list.push(entry)
      grouped.set(entry.family, list)
    }
    return [...grouped.entries()]
      .map(([family, entries]) => ({
        family,
        entries: [...entries].sort((a, b) => a.modelLabel.localeCompare(b.modelLabel)),
      }))
      .sort((a, b) => a.family.localeCompare(b.family))
  }, [filteredCloudEntries, favoriteCloudEntries, recentCloudEntries])

  const isCloudEntryActive = useCallback(
    (entry: CloudModelEntry) => {
      if (entry.source === 'default-cloud') return cloudEngineSelected && cloudSelectedModelId === entry.modelId
      return activeRemoteProfileId === entry.profileId && activeProfile?.model === entry.modelId && runtimeEngineId === 'vgo-remote'
    },
    [activeRemoteProfileId, activeProfile?.model, cloudEngineSelected, cloudSelectedModelId, runtimeEngineId],
  )

  const renderCloudEntry = (entry: CloudModelEntry) => {
    const isActive = isCloudEntryActive(entry)
    const isFavorite = modelPrefs.favorites.includes(entry.key)
    const isSwitching =
      entry.source === 'default-cloud'
        ? switchingKey === `cloud-${entry.modelId}`
        : switchingKey === `custom-cloud-${entry.profileId}-${entry.modelId}`

    return (
      <div key={entry.key} className="model-option-row">
        <button
          className={`model-option ${isActive ? 'active' : ''}`}
          onClick={() =>
            void (entry.source === 'default-cloud'
              ? handleModelSelect(entry.modelId, entry.key)
              : handleCustomCloudModelSelect(entry.profileId, entry.modelId, entry.key))
          }
          disabled={Boolean(switchingKey)}
        >
          <div className="model-option-info">
            <span className="model-option-name">{entry.modelLabel}</span>
            <span className="model-option-meta">{entry.profileName}</span>
          </div>
          {isSwitching ? <Loader2 size={14} className="spin" /> : isActive ? <div className="model-option-check">✓</div> : null}
        </button>
        <button
          className={`model-favorite-toggle ${isFavorite ? 'active' : ''}`}
          onClick={(event) => {
            event.stopPropagation()
            toggleFavoriteModel(entry.key)
          }}
          title={isFavorite ? '取消常用' : '加入常用'}
        >
          <Star size={12} />
        </button>
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <section className="brand-hero">
          <div className="brand-lockup">
            <div>
              <div className="brand-title">VGO CODE</div>
              <div className="brand-subtitle">AI Agent 工作台</div>
            </div>
          </div>
          <p className="brand-copy">把登录、模型、线程、任务面板和工作区整合到一套专业化 Agent 工作流中。</p>
          <div className="brand-badges">
            <span className="brand-badge">多线程</span>
            <span className="brand-badge">多模型</span>
            <span className="brand-badge">VGO AI</span>
          </div>
        </section>

        <section className="panel panel-accent">
          <div className="panel-head">
            <div>
              <div className="panel-kicker">{t('sidebar.accountCenter')}</div>
              <h3>{t('sidebar.loginAndModel')}</h3>
            </div>
            <div className={`status-pill ${vgoAILoggedIn ? 'online' : ''}`}>
              {vgoAILoggedIn ? t('sidebar.loggedIn') : t('sidebar.notLoggedIn')}
            </div>
          </div>

          {vgoAILoggedIn || remoteProfiles.length > 0 ? (
            <>
              {vgoAILoggedIn ? (
                <div className="account-summary">
                  <div className="account-row">
                    <User size={14} />
                    <span>{vgoAIDisplayName || t('sidebar.unnamedUser')}</span>
                  </div>
                  {vgoAIEmail && (
                    <div className="account-row">
                      <Globe size={14} />
                      <span>{vgoAIEmail}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="helper-text">
                  <LogIn size={14} style={{ marginRight: 8, display: 'inline' }} />
                  {t('sidebar.loginRequired')}
                </div>
              )}

              <div className="model-selector">
                <button className="model-selector-header" onClick={() => setModelsExpanded(!modelsExpanded)}>
                  <div className="model-selector-label">
                    <Bot size={14} />
                    <span>当前模型</span>
                  </div>
                  <div className="model-selector-current">
                    <span className="current-model-name">
                      {currentModelDisplay.name}
                      {currentModelDisplay.isLocal && <span className="local-badge">本地</span>}
                    </span>
                    {modelsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>
                </button>

                {modelsExpanded && (
                  <div className="model-list model-list-expanded" onClick={(e) => e.stopPropagation()}>
                    {localProfiles.length > 0 && (
                      <>
                        <div className="model-list-section-title">
                          <span>本地模型</span>
                          {localProfiles.some((profile) => profile.id === activeRemoteProfileId) && (
                            <span className="active-indicator">使用中</span>
                          )}
                        </div>
                        {localProfiles.map((profile) => {
                          const isActive = activeRemoteProfileId === profile.id
                          const isSwitching = switchingKey === `profile-${profile.id}`
                          return (
                            <button
                              key={profile.id}
                              className={`model-option ${isActive ? 'active' : ''}`}
                              onClick={() => void handleProfileSelect(profile.id)}
                              disabled={Boolean(switchingKey)}
                            >
                              <div className="model-option-info">
                                <span className="model-option-name">{profile.name}</span>
                                <span className="model-option-meta">{profile.model}</span>
                              </div>
                              {isSwitching ? <Loader2 size={14} className="spin" /> : isActive ? <div className="model-option-check">✓</div> : null}
                            </button>
                          )
                        })}
                      </>
                    )}

                    {manualCloudProfiles.length > 0 && (
                      <>
                        <div className="model-list-section-title">
                          <span>云端配置</span>
                          {activeProfile && activeProfile.id !== 'default' && activeProfile.provider !== 'Ollama' && (
                            <span className="active-indicator">使用中</span>
                          )}
                        </div>
                        {manualCloudProfiles.map((profile) => {
                          const isActive = activeRemoteProfileId === profile.id
                          const isSwitching = switchingKey === `profile-${profile.id}`
                          return (
                            <button
                              key={profile.id}
                              className={`model-option ${isActive ? 'active' : ''}`}
                              onClick={() => void handleProfileSelect(profile.id)}
                              disabled={Boolean(switchingKey)}
                            >
                              <div className="model-option-info">
                                <span className="model-option-name">{profile.name}</span>
                                <span className="model-option-meta">{profile.model}</span>
                              </div>
                              {isSwitching ? <Loader2 size={14} className="spin" /> : isActive ? <div className="model-option-check">✓</div> : null}
                            </button>
                          )
                        })}
                      </>
                    )}

                    {cloudModelEntries.length > 0 && (
                      <>
                        <div className="model-list-section-title">
                          <span>云端模型</span>
                          <span className="active-indicator">{filteredCloudEntries.length}</span>
                        </div>
                        <div className="model-search-row">
                          <Search size={13} className="model-search-icon" />
                          <input
                            type="text"
                            className="model-search-input"
                            placeholder="搜索模型 / 家族"
                            value={modelSearch}
                            onChange={(e) => setModelSearch(e.target.value)}
                          />
                        </div>

                        {favoriteCloudEntries.length > 0 && (
                          <>
                            <div className="model-list-section-title">
                              <span>常用置顶</span>
                              <span className="active-indicator">{favoriteCloudEntries.length}</span>
                            </div>
                            {favoriteCloudEntries.map((entry) => renderCloudEntry(entry))}
                          </>
                        )}

                        {recentCloudEntries.length > 0 && (
                          <>
                            <div className="model-list-section-title">
                              <span>最近使用</span>
                              <span className="active-indicator">{recentCloudEntries.length}</span>
                            </div>
                            {recentCloudEntries.map((entry) => renderCloudEntry(entry))}
                          </>
                        )}

                        {familyGroups.map((group) => {
                          const collapsed = modelPrefs.collapsedFamilies.includes(group.family)
                          return (
                            <div key={group.family}>
                              <button className="model-family-toggle" onClick={() => toggleFamilyCollapsed(group.family)}>
                                <span>{group.family}</span>
                                <span className="model-family-meta">
                                  {group.entries.length}
                                  {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                                </span>
                              </button>
                              {!collapsed && group.entries.map((entry) => renderCloudEntry(entry))}
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-kicker">{t('sidebar.threadCenter')}</div>
              <h3>{t('sidebar.taskThreads')}</h3>
            </div>
            <button className="tiny-button" onClick={() => void handleCreateSession()}>
              <Plus size={14} />
            </button>
          </div>

          <div className="search-input-wrapper">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              className="text-input"
              placeholder={t('sidebar.search')}
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
            />
          </div>

          <div className="session-list">
            {projectGroups.map((group) => {
              const collapsed = collapsedProjectPaths.includes(group.path)
              return (
                <div key={group.path} className="session-group">
                  <button className="session-group-title session-group-toggle" onClick={() => toggleProjectCollapsed(group.path)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <FolderOpen size={12} />
                      <span>{group.name}</span>
                      <span className="active-indicator">{group.sessions.length}</span>
                    </span>
                    {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                  </button>
                  {!collapsed &&
                    group.sessions.map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        isActive={session.id === activeSessionId}
                        onClick={() => void handleSwitchSession(session.id)}
                        onDelete={() => void handleDeleteSession(session.id)}
                      />
                    ))}
                </div>
              )
            })}

            {filteredSessions.length === 0 && <div className="helper-text" style={{ padding: '1rem', textAlign: 'center' }}>暂无匹配线程</div>}
          </div>

          <div className="session-actions">
            <button className="ghost-button" onClick={() => setRenameOverlayOpen(true)}>重命名当前线程</button>
            <button className="ghost-button" onClick={() => void handleResetSession()}>重置当前线程</button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-kicker">{t('sidebar.workspace')}</div>
              <h3>{workspace ? t('sidebar.currentDirectory') : t('sidebar.noDirectorySelected')}</h3>
            </div>
          </div>

          <div className="workspace-path" title={workspace}>
            <FolderOpen size={14} />
            <span>{workspace ? workspace.split(/[/\\]/).pop() : t('sidebar.clickToSelectWorkspace')}</span>
          </div>

          <div className="button-stack">
            <button
              className="ghost-button"
              onClick={async () => {
                const result = await window.vgoDesktop?.pickWorkspace?.()
                if (result?.state) hydrate(result.state)
                else await refreshState()
              }}
            >
              <FolderOpen size={14} /> 切换目录
            </button>
            <button
              className="ghost-button"
              onClick={async () => {
                try {
                  await window.vgoDesktop?.analyze?.()
                  await refreshState()
                } catch (e) {
                  console.error('Error analyzing workspace:', e)
                }
              }}
            >
              <Zap size={14} /> 分析目录
            </button>
          </div>
        </section>
      </div>

      <section className="sidebar-footer">
        <button className="ghost-button full-width" onClick={() => setSettingsOverlayOpen(true)}>
          <Settings size={14} /> {t('settings.label')}
        </button>

        <div className="sidebar-auth-box">
          <div className="sidebar-auth-head">
            <span className="panel-kicker">{t('sidebar.loginEntry')}</span>
            <div className={`status-pill ${vgoAILoggedIn ? 'online' : ''}`}>
              {vgoAILoggedIn ? t('sidebar.loggedIn') : t('sidebar.notLoggedIn')}
            </div>
          </div>

          {vgoAILoggedIn ? (
            <div className="sidebar-auth-summary">
              <div className="helper-text">{vgoAIDisplayName || vgoAIEmail || t('sidebar.accountLoggedIn')}</div>
              <button className="ghost-button full-width" onClick={() => void handleLogout()}>
                <LogOut size={14} /> {t('sidebar.logout')}
              </button>
            </div>
          ) : (
            <>
              <button className="primary-button full-width" onClick={() => void handleBrowserLogin()} disabled={isLoggingIn}>
                <LogIn size={14} /> {t('sidebar.browserLogin')}
              </button>
              <button className="ghost-button full-width" onClick={() => setShowPasswordForm((value) => !value)}>
                <User size={14} /> {t('sidebar.emailLogin')}
              </button>

              {showPasswordForm && (
                <div className="sidebar-login-form">
                  <input className="text-input" placeholder={t('sidebar.emailAddress')} value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
                  <input
                    className="text-input"
                    type="password"
                    placeholder={t('sidebar.password')}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handlePasswordLogin()}
                  />
                  <input className="text-input" placeholder={t('sidebar.displayName')} value={loginDisplayName} onChange={(e) => setLoginDisplayName(e.target.value)} />
                  <button className="primary-button full-width" onClick={() => void handlePasswordLogin()} disabled={isLoggingIn}>
                    <LogIn size={14} /> {isLoggingIn ? t('sidebar.loggingIn') : t('sidebar.confirmLogin')}
                  </button>
                </div>
              )}

              {loginStatus && <div className="login-status">{loginStatus}</div>}
            </>
          )}
        </div>
      </section>
    </aside>
  )
}

interface SessionItemProps {
  session: {
    id: string
    title: string
    preview: string
    pinned: boolean
    createdAt: string
    updatedAt: string
  }
  isActive: boolean
  onClick: () => void
  onDelete: () => void
}

function SessionItem({ session, isActive, onClick, onDelete }: SessionItemProps) {
  const { t, locale } = useI18n()
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return new Intl.DateTimeFormat(locale === 'en-US' ? 'en-US' : 'zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  return (
    <div className={`session-item ${isActive ? 'active' : ''}`} onClick={onClick}>
      <div className="session-item-meta">
        <button
          className={`pin-button ${session.pinned ? 'active' : ''}`}
          onClick={async (e) => {
            e.stopPropagation()
            await window.vgoDesktop?.togglePinSession?.(session.id)
            const result = await window.vgoDesktop?.getState?.()
            if (result) useAppStore.getState().hydrate(result)
          }}
        >
          <Pin size={12} />
        </button>
        <span className="session-time">{formatTime(session.updatedAt)}</span>
        <button
          className="delete-button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="session-title">{session.title || t('session.defaultTitle')}</div>
      <div className="session-preview">{session.preview || t('sidebar.noMessages')}</div>
    </div>
  )
}
