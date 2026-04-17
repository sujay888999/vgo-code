import React, { useCallback, useMemo, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useI18n } from '../i18n'
import {
  MessageSquare,
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
} from 'lucide-react'

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
  const [modelsExpanded, setModelsExpanded] = useState(true)
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [loginEmail, setLoginEmail] = useState(vgoAIEmail || '')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginDisplayName, setLoginDisplayName] = useState(vgoAIDisplayName || 'VGO AI Developer')
  const [loginStatus, setLoginStatus] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [switchingKey, setSwitchingKey] = useState<string | null>(null)

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
    [refreshState],
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
    async (modelId: string) => {
      try {
        setSwitchingKey(`cloud-${modelId}`)
        await window.vgoDesktop?.selectRemoteProfile?.('default')
        await window.vgoDesktop?.setEngine?.('vgo-remote')
        await window.vgoDesktop?.updateVgoAiProfile?.({
          preferredModel: modelId,
          useDefaultCloudProfile: true,
        })
        await refreshState()
      } catch (e) {
        console.error('Failed to switch cloud model:', e)
      } finally {
        setSwitchingKey(null)
      }
    },
    [refreshState],
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

  const filteredSessions = sessions.filter(
    (s) =>
      !sessionSearch ||
      s.title.toLowerCase().includes(sessionSearch.toLowerCase()) ||
      s.preview.toLowerCase().includes(sessionSearch.toLowerCase()),
  )

  const pinnedSessions = filteredSessions.filter((s) => s.pinned)
  const recentSessions = filteredSessions.filter((s) => !s.pinned).slice(0, 5)
  const backlogSessions = filteredSessions.filter((s) => !s.pinned).slice(5)

  const currentModelDisplay = useMemo(() => {
    const activeProfile = remoteProfiles.find((p) => p.id === activeRemoteProfileId)
    const isCloudEngineSelected = runtimeEngineId === 'vgo-remote'
    const isLocalProfile = activeProfile?.provider === 'Ollama'

    if (activeProfile && (isLocalProfile || !isCloudEngineSelected)) {
      return {
        name: activeProfile.name,
        model: activeProfile.model,
        isLocal: true,
      }
    }

    const cloudModel = modelCatalog.find((m) => m.id === vgoAIPreferredModel)
    return {
      name: cloudModel?.label || vgoAIPreferredModel || t('sidebar.noModelSelected'),
      model: vgoAIPreferredModel || '',
      isLocal: false,
    }
  }, [remoteProfiles, activeRemoteProfileId, modelCatalog, vgoAIPreferredModel, runtimeEngineId, t])

  const localProfiles = remoteProfiles.filter((p) => p.provider === 'Ollama')
  const cloudModels = modelCatalog
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

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <section className="brand-hero">
          <div className="brand-lockup">
            <div>
              <div className="brand-title">VGO CODE</div>
              <div className="brand-subtitle">AI Agent 开发工作台</div>
            </div>
          </div>
          <p className="brand-copy">
            把登录、模型、线程、任务面板和工作区整合到一套专业化的 Agent 工作流中。
          </p>
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

          {vgoAILoggedIn ? (
            <>
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

              <div className="model-selector">
                <button
                  className="model-selector-header"
                  onClick={() => setModelsExpanded(!modelsExpanded)}
                >
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
                          {localProfiles.some((p) => p.id === activeRemoteProfileId) && (
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
                              {isSwitching ? (
                                <Loader2 size={14} className="spin" />
                              ) : isActive ? (
                                <div className="model-option-check">✓</div>
                              ) : null}
                            </button>
                          )
                        })}
                      </>
                    )}

                    {cloudModels.length > 0 && (
                      <>
                        <div className="model-list-section-title">
                          <span>云端模型</span>
                          {cloudEngineSelected && (
                            <span className="active-indicator">使用中</span>
                          )}
                        </div>
                        {cloudModels.map((model) => {
                          const isActive = cloudEngineSelected && model.id === cloudSelectedModelId
                          const isSwitching = switchingKey === `cloud-${model.id}`
                          return (
                            <button
                              key={model.id}
                              className={`model-option ${isActive ? 'active' : ''}`}
                              onClick={() => void handleModelSelect(model.id)}
                              disabled={Boolean(switchingKey)}
                            >
                              <div className="model-option-info">
                                <span className="model-option-name">{model.label}</span>
                              </div>
                              {isSwitching ? (
                                <Loader2 size={14} className="spin" />
                              ) : isActive ? (
                                <div className="model-option-check">✓</div>
                              ) : null}
                            </button>
                          )
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="helper-text">
              <LogIn size={14} style={{ marginRight: 8, display: 'inline' }} />
              {t('sidebar.loginRequired')}
            </div>
          )}
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
            {pinnedSessions.length > 0 && (
              <div className="session-group">
                <div className="session-group-title">
                  <Pin size={12} /> {t('sidebar.pinned')}
                </div>
                {pinnedSessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={session.id === activeSessionId}
                    onClick={() => void handleSwitchSession(session.id)}
                    onDelete={() => void handleDeleteSession(session.id)}
                  />
                ))}
              </div>
            )}

            {recentSessions.length > 0 && (
              <div className="session-group">
                <div className="session-group-title">
                  <MessageSquare size={12} /> {t('sidebar.recent')}
                </div>
                {recentSessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={session.id === activeSessionId}
                    onClick={() => void handleSwitchSession(session.id)}
                    onDelete={() => void handleDeleteSession(session.id)}
                  />
                ))}
              </div>
            )}

            {backlogSessions.length > 0 && (
              <div className="session-group">
                <div className="session-group-title">{t('sidebar.more')}</div>
                {backlogSessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={session.id === activeSessionId}
                    onClick={() => void handleSwitchSession(session.id)}
                    onDelete={() => void handleDeleteSession(session.id)}
                  />
                ))}
              </div>
            )}

            {filteredSessions.length === 0 && (
              <div className="helper-text" style={{ padding: '1rem', textAlign: 'center' }}>
                暂无匹配的线程
              </div>
            )}
          </div>

          <div className="session-actions">
            <button className="ghost-button" onClick={() => setRenameOverlayOpen(true)}>
              重命名当前线程
            </button>
            <button className="ghost-button" onClick={() => void handleResetSession()}>
              重置当前线程
            </button>
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
                if (result?.state) {
                  hydrate(result.state)
                } else {
                  await refreshState()
                }
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
              <button
                className="primary-button full-width"
                onClick={() => void handleBrowserLogin()}
                disabled={isLoggingIn}
              >
                <LogIn size={14} /> {t('sidebar.browserLogin')}
              </button>
              <button
                className="ghost-button full-width"
                onClick={() => setShowPasswordForm((value) => !value)}
              >
                <User size={14} /> {t('sidebar.emailLogin')}
              </button>

              {showPasswordForm && (
                <div className="sidebar-login-form">
                  <input
                    className="text-input"
                    placeholder={t('sidebar.emailAddress')}
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                  />
                  <input
                    className="text-input"
                    type="password"
                    placeholder={t('sidebar.password')}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handlePasswordLogin()}
                  />
                  <input
                    className="text-input"
                    placeholder={t('sidebar.displayName')}
                    value={loginDisplayName}
                    onChange={(e) => setLoginDisplayName(e.target.value)}
                  />
                  <button
                    className="primary-button full-width"
                    onClick={() => void handlePasswordLogin()}
                    disabled={isLoggingIn}
                  >
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
            if (result) {
              useAppStore.getState().hydrate(result)
            }
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
