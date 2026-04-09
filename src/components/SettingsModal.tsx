import React, { useEffect, useMemo, useState } from 'react'
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
import { setI18nLocale } from '../i18n'

type SettingsTab = 'appearance' | 'language' | 'behavior' | 'agent' | 'runtime'
type ManualProvider = 'Ollama' | 'Custom HTTP Provider'

const TABS: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  { id: 'appearance', label: '外观', icon: <Palette size={16} /> },
  { id: 'language', label: '语言', icon: <Globe size={16} /> },
  { id: 'behavior', label: '交互', icon: <Settings2 size={16} /> },
  { id: 'agent', label: 'Skills', icon: <Bot size={16} /> },
  { id: 'runtime', label: '运行', icon: <Cpu size={16} /> },
]

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

  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [draftDirty, setDraftDirty] = useState(false)
  const [hydratedProfileId, setHydratedProfileId] = useState<string | null>(null)
  const [configName, setConfigName] = useState('')
  const [provider, setProvider] = useState<ManualProvider>('Ollama')
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:11434')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [switchingKey, setSwitchingKey] = useState<string | null>(null)

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
      ollama: '本地模型链路，适合离线、私有化和低延迟工作流。',
      'vgo-remote': '云端模型链路，适合更强模型、联网能力和多设备同步。',
    }),
    [],
  )

  const refreshState = async () => {
    const nextState = await window.vgoDesktop?.getState?.()
    if (nextState) hydrate(nextState)
  }

  const fillDraftFromProfile = (profile: (typeof remoteProfiles)[number] | null) => {
    if (!profile) {
      setConfigName('')
      setProvider('Ollama')
      setBaseUrl('http://127.0.0.1:11434')
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

  const withStatus = async (message: string, fn: () => Promise<void>) => {
    setBusy(true)
    setStatus(message)
    try {
      await fn()
      await refreshState()
      setStatus('已保存')
      window.setTimeout(() => setStatus(''), 1400)
    } catch (error: any) {
      setStatus(error?.message || '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const applyAppearance = async (payload: Record<string, unknown>) => {
    await withStatus('正在保存外观设置...', async () => {
      await window.vgoDesktop?.updateAppearance?.(payload)
    })
  }

  const applyLocalization = async (payload: Record<string, unknown>) => {
    await withStatus('正在保存语言设置...', async () => {
      await window.vgoDesktop?.updateLocalization?.(payload)
    })
  }

  const applyBehavior = async (payload: Record<string, unknown>) => {
    await withStatus('正在保存交互设置...', async () => {
      await window.vgoDesktop?.updateBehavior?.(payload)
    })
  }

  const applyAccess = async (payload: Record<string, unknown>) => {
    await withStatus('正在保存工作范围...', async () => {
      await window.vgoDesktop?.updateAccess?.(payload)
    })
  }

  const applyAgentPrefs = async (payload: Record<string, unknown>) => {
    await withStatus('正在保存 Agent 设置...', async () => {
      await window.vgoDesktop?.updateAgentPreferences?.(payload)
    })
  }

  const handleSaveCurrentProfile = async () => {
    const payload = {
      name: configName.trim() || '未命名配置',
      provider,
      baseUrl: baseUrl.trim(),
      ollamaUrl: provider === 'Ollama' ? baseUrl.trim() : undefined,
      model: model.trim(),
      apiKey: apiKey.trim(),
      systemPrompt,
      activate: true,
    }

    await withStatus('正在保存当前配置...', async () => {
      if (editableActiveProfile) {
        await window.vgoDesktop?.updateRemoteProfile?.(editableActiveProfile.id, payload)
        await window.vgoDesktop?.setEngine?.(provider === 'Ollama' ? 'ollama' : 'vgo-remote')
        await window.vgoDesktop?.selectRemoteProfile?.(editableActiveProfile.id)
      } else {
        await window.vgoDesktop?.createRemoteProfile?.(payload)
        await window.vgoDesktop?.setEngine?.(provider === 'Ollama' ? 'ollama' : 'vgo-remote')
      }
    })
  }

  const handleCreateNewProfile = async () => {
    const payload = {
      name: configName.trim() || '新配置',
      provider,
      baseUrl: baseUrl.trim(),
      ollamaUrl: provider === 'Ollama' ? baseUrl.trim() : undefined,
      model: model.trim(),
      apiKey: apiKey.trim(),
      systemPrompt,
      activate: true,
    }

    await withStatus('正在创建配置...', async () => {
      await window.vgoDesktop?.createRemoteProfile?.(payload)
      await window.vgoDesktop?.setEngine?.(provider === 'Ollama' ? 'ollama' : 'vgo-remote')
    })
  }

  const handleDeleteProfile = async () => {
    if (!editableActiveProfile) return
    await withStatus('正在删除配置...', async () => {
      await window.vgoDesktop?.deleteRemoteProfile?.(editableActiveProfile.id)
    })
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
    await withStatus(`${enabled ? '启用' : '停用'} Skill 中...`, async () => {
      await window.vgoDesktop?.updateSkillState?.({ id: skillId, enabled })
    })
  }

  const handleInstallWhisper = async () => {
    await withStatus('正在安装 Whisper 运行时...', async () => {
      await window.vgoDesktop?.installWhisper?.()
    })
  }

  const handleNormalizeLog = async () => {
    await withStatus('正在整理日志编码...', async () => {
      await window.vgoDesktop?.normalizeEngineLog?.()
    })
  }

  return (
    <div className="modal-overlay" onClick={() => setSettingsOverlayOpen(false)}>
      <div className="modal settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header settings-header">
          <div>
            <h2>设置</h2>
            <p className="hint">统一管理外观、语言、交互、Skills 和运行能力。</p>
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
                <h3>主题</h3>
                <div className="theme-grid">
                  {[
                    ['aurora', 'Aurora'],
                    ['graphite', 'Graphite'],
                    ['paper-light', 'Paper Light'],
                    ['solar', 'Solar'],
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
                  title="紧凑布局"
                  hint="减少间距，适合高密度工作流。"
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
                <h3>界面语言</h3>
                <div className="language-grid">
                  {[
                    ['zh-CN', '简体中文'],
                    ['en-US', 'English'],
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
                  title="Enter 发送"
                  hint="按 Enter 直接发送，Shift + Enter 换行。"
                  enabled={enterToSend}
                  onToggle={async () => {
                    toggleEnterToSend()
                    await applyBehavior({ enterToSend: !enterToSend })
                  }}
                />
                <ToggleRow
                  title="自动滚动"
                  hint="停留在底部时，自动跟随最新输出。"
                  enabled={autoScroll}
                  onToggle={async () => {
                    toggleAutoScroll()
                    await applyBehavior({ autoScroll: !autoScroll })
                  }}
                />
                <ToggleRow
                  title="显示右侧任务面板"
                  hint="展示结构化的执行状态和步骤结果。"
                  enabled={showTaskPanel}
                  onToggle={async () => {
                    toggleShowTaskPanel()
                    await applyBehavior({ showTaskPanel: !showTaskPanel })
                  }}
                />
                <ToggleRow
                  title="危险操作确认"
                  hint="写文件、执行命令等敏感操作先弹出授权卡。"
                  enabled={confirmDangerousOps}
                  onToggle={async () => {
                    toggleConfirmDangerousOps()
                    await applyBehavior({ confirmDangerousOps: !confirmDangerousOps })
                  }}
                />

                <div className="slider-row">
                  <div>
                    <span>工作范围</span>
                    <p className="hint">
                      控制 Agent 默认可访问的位置。选择“全局范围”后，作用域会扩大到整台电脑。
                    </p>
                  </div>
                  <div className="language-grid">
                    {[
                      ['workspace-only', '仅工作区'],
                      ['workspace-and-desktop', '工作区 + 桌面'],
                      ['full-system', '全局范围'],
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
                  title="自动压缩上下文"
                  hint="长会话时自动总结历史，降低上下文膨胀。"
                  enabled={autoSummarizeContext}
                  onToggle={async () => {
                    toggleAutoSummarize()
                    await applyAgentPrefs({ autoSummarizeContext: !autoSummarizeContext })
                  }}
                />
                <div className="slider-row">
                  <div>
                    <span>压缩阈值</span>
                    <p className="hint">达到上下文窗口阈值后自动触发压缩。</p>
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
                  title="显示运行元信息"
                  hint="展示模型、上下文和来源等运行信息。"
                  enabled={showRuntimeMeta}
                  onToggle={async () => {
                    toggleShowRuntimeMeta()
                    await applyAgentPrefs({ showRuntimeMeta: !showRuntimeMeta })
                  }}
                />
                <ToggleRow
                  title="显示执行计划"
                  hint="在任务开始阶段展示规划步骤。"
                  enabled={showExecutionPlan}
                  onToggle={async () => {
                    toggleShowExecutionPlan()
                    await applyAgentPrefs({ showExecutionPlan: !showExecutionPlan })
                  }}
                />

                <h3>已安装 Skills</h3>
                <div className="manual-config-card">
                  <p className="hint">
                    这里会自动列出本机已安装的 Skills。以后新安装的 Skill 也会自动出现在这里，并可单独启用或停用。
                  </p>
                  <div className="remote-profiles">
                    {skills.map((skill) => (
                      <div key={skill.id} className={`profile-item ${skill.enabled ? 'active' : ''}`}>
                        <div className="profile-info">
                          <span className="profile-name">{skill.name}</span>
                          <span className="profile-model">
                            {skill.source} · {skill.path}
                          </span>
                          <span className="hint">{skill.description}</span>
                        </div>
                        <button
                          type="button"
                          className={skill.enabled ? 'ghost-button' : 'primary-button'}
                          onClick={() => void handleToggleSkill(skill.id, !skill.enabled)}
                          disabled={busy}
                        >
                          {skill.enabled ? '停用' : '启用'}
                        </button>
                      </div>
                    ))}
                    {skills.length === 0 && (
                      <p className="manual-config-status">当前还没有发现可管理的本机 Skill。</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeSettingsTab === 'runtime' && (
              <div className="settings-section">
                <h3>账号状态</h3>
                <div className="account-info">
                  <div className="info-row">
                    <span className="label">登录状态</span>
                    <span className="value">{vgoAILoggedIn ? '已登录' : '未登录'}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">账号</span>
                    <span className="value">{vgoAIDisplayName || vgoAIEmail || '未绑定'}</span>
                  </div>
                  <div className="info-row">
                    <span className="label">云端默认模型</span>
                    <span className="value">{vgoAIPreferredModel || '未设置'}</span>
                  </div>
                </div>

                <h3>运行引擎</h3>
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
                        <span className="engine-badge">当前</span>
                      ) : null}
                    </button>
                  ))}
                </div>

                <h3>能力维护</h3>
                <div className="manual-config-card">
                  <p className="hint">
                    安装本地 Whisper 转写能力，或整理历史 `ollama-engine.log` 的乱码记录。
                  </p>
                  <div className="button-row manual-config-actions">
                    <button type="button" className="primary-button" onClick={() => void handleInstallWhisper()} disabled={busy}>
                      {busy ? <Loader2 size={14} className="spin" /> : <Wrench size={14} />}
                      安装 Whisper
                    </button>
                    <button type="button" className="ghost-button" onClick={() => void handleNormalizeLog()} disabled={busy}>
                      <Wrench size={14} />
                      整理日志编码
                    </button>
                  </div>
                  {status && <p className="manual-config-status">{status}</p>}
                </div>

                <h3>手动配置模型</h3>
                <div className="manual-config-card">
                  <p className="hint">
                    填写配置名称、类型、地址和模型名即可保存，并立即切换到这条模型链路。系统默认云端配置不在这里展示。
                  </p>

                  <div className="simple-config-grid">
                    <input
                      className="text-input"
                      placeholder="配置名称，例如 Gemma4 本地模型"
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
                      }}
                    >
                      <option value="Ollama">本地 Ollama</option>
                      <option value="Custom HTTP Provider">云端 HTTP Provider</option>
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

                    <input
                      className="text-input"
                      placeholder={provider === 'Ollama' ? '例如 gemma4:e4b' : '例如 gpt-5.4-mini'}
                      value={model}
                      onChange={(event) => {
                        setModel(event.target.value)
                        setDraftDirty(true)
                      }}
                    />

                    {provider !== 'Ollama' && (
                      <input
                        className="text-input"
                        placeholder="API Key（可选）"
                        value={apiKey}
                        onChange={(event) => {
                          setApiKey(event.target.value)
                          setDraftDirty(true)
                        }}
                      />
                    )}

                    <textarea
                      className="text-input config-textarea"
                      placeholder="系统提示（可选）"
                      value={systemPrompt}
                      onChange={(event) => {
                        setSystemPrompt(event.target.value)
                        setDraftDirty(true)
                      }}
                    />
                  </div>

                  <div className="button-row manual-config-actions">
                    <button type="button" className="primary-button" onClick={() => void handleSaveCurrentProfile()} disabled={busy}>
                      {busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                      保存并切换
                    </button>
                    <button type="button" className="ghost-button" onClick={() => void handleCreateNewProfile()} disabled={busy}>
                      <Plus size={14} />
                      另存为新配置
                    </button>
                    <button
                      type="button"
                      className="ghost-button danger-outline"
                      onClick={() => void handleDeleteProfile()}
                      disabled={busy || !editableActiveProfile}
                    >
                      <Trash2 size={14} />
                      删除当前配置
                    </button>
                  </div>
                  {status && <p className="manual-config-status">{status}</p>}
                </div>

                <h3>已有配置</h3>
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
                        <span className="profile-badge">已启用</span>
                      ) : null}
                    </button>
                  ))}
                  {editableProfiles.length === 0 && (
                    <p className="manual-config-status">暂无手动配置，可先保存一个本地或云端模型配置。</p>
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
