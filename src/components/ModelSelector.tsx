import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useI18n } from '../i18n'
import {
  Bot, ChevronDown, ChevronUp, Loader2, Search, Star,
} from 'lucide-react'

type ModelPrefs = {
  favorites: string[]
  recent: string[]
  collapsedFamilies: string[]
  collapsedFamiliesInitialized: boolean
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

type ProtocolType = 'ollama' | 'openai' | 'legacy' | 'cloud'

const MODEL_PREFS_STORAGE_KEY = 'vgo.code.model.prefs.v1'

function readModelPrefs(): ModelPrefs {
  try {
    const raw = window.localStorage.getItem(MODEL_PREFS_STORAGE_KEY)
    if (!raw) return { favorites: [], recent: [], collapsedFamilies: [], collapsedFamiliesInitialized: false }
    const parsed = JSON.parse(raw)
    return {
      favorites: Array.isArray(parsed?.favorites) ? parsed.favorites.filter((item: unknown) => typeof item === 'string') : [],
      recent: Array.isArray(parsed?.recent) ? parsed.recent.filter((item: unknown) => typeof item === 'string') : [],
      collapsedFamilies: Array.isArray(parsed?.collapsedFamilies)
        ? parsed.collapsedFamilies.filter((item: unknown) => typeof item === 'string')
        : [],
      collapsedFamiliesInitialized: Boolean(parsed?.collapsedFamiliesInitialized),
    }
  } catch {
    return { favorites: [], recent: [], collapsedFamilies: [], collapsedFamiliesInitialized: false }
  }
}

function writeModelPrefs(prefs: ModelPrefs) {
  try {
    window.localStorage.setItem(MODEL_PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch { /* noop */ }
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
  if (text.includes('nvidia') || text.includes('nemotron')) return 'NVIDIA'
  if (text.includes('llama')) return 'Llama'
  if (text.includes('mistral')) return 'Mistral'
  const prefix = String(modelId || '').split(/[-_:/.]/).filter(Boolean)[0]
  return prefix ? prefix.toUpperCase() : 'Other'
}

function detectEndpointType(baseUrl: string): ProtocolType {
  const lower = String(baseUrl || '').trim().toLowerCase()
  if (/localhost:11434|127\.0\.0\.1:11434/.test(lower)) return 'ollama'
  if (/\/chat\/completions$/.test(lower) || /\/v1$/.test(lower) || /\/openai\/v1$/.test(lower) || /\/api\/paas\/v4$/.test(lower)) return 'openai'
  return 'legacy'
}

function endpointBadgeLabel(type: ProtocolType, t: (k: string) => string) {
  if (type === 'ollama') return t('runtime.endpointBadge.ollama')
  if (type === 'openai') return t('runtime.endpointBadge.openai')
  return t('runtime.endpointBadge.legacy')
}

export function ModelSelector() {
  const { t } = useI18n()
  const {
    vgoAILoggedIn, vgoAIPreferredModel, modelCatalog, remoteProfiles,
    activeRemoteProfileId, runtimeEngineId, hydrate,
  } = useAppStore()

  const [modelsExpanded, setModelsExpanded] = useState(true)
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

  const markModelUsed = useCallback((entryKey: string) => {
    if (!entryKey) return
    updateModelPrefs((prev) => ({
      ...prev,
      recent: [entryKey, ...prev.recent.filter((item) => item !== entryKey)].slice(0, 30),
    }))
  }, [updateModelPrefs])

  const toggleFavoriteModel = useCallback((entryKey: string) => {
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
  }, [updateModelPrefs])

  const toggleFamilyCollapsed = useCallback((family: string) => {
    updateModelPrefs((prev) => ({
      ...prev,
      collapsedFamilies: prev.collapsedFamilies.includes(family)
        ? prev.collapsedFamilies.filter((item) => item !== family)
        : [...prev.collapsedFamilies, family],
    }))
  }, [updateModelPrefs])

  const refreshState = useCallback(async () => {
    const result = await window.vgoDesktop?.getState?.()
    if (result) hydrate(result)
  }, [hydrate])

  const handleModelSelect = useCallback(async (modelId: string, entryKey = '') => {
    try {
      setSwitchingKey(`cloud-${modelId}`)
      await window.vgoDesktop?.selectRemoteProfile?.('default')
      await window.vgoDesktop?.setEngine?.('vgo-remote')
      await window.vgoDesktop?.updateVgoAiProfile?.({ preferredModel: modelId, useDefaultCloudProfile: true })
      await refreshState()
      markModelUsed(entryKey || `default:${modelId}`)
    } catch (e) {
      console.error('Failed to switch cloud model:', e)
    } finally {
      setSwitchingKey(null)
    }
  }, [refreshState, markModelUsed])

  const handleProfileSelect = useCallback(async (profileId: string) => {
    try {
      const profile = remoteProfiles.find((p) => p.id === profileId)
      if (!profile) return
      setSwitchingKey(`profile-${profileId}`)
      const endpointType = detectEndpointType(profile.baseUrl)
      await window.vgoDesktop?.setEngine?.(endpointType === 'ollama' ? 'ollama' : 'vgo-remote')
      await window.vgoDesktop?.selectRemoteProfile?.(profileId)
      await refreshState()
    } catch (e) {
      console.error('Failed to switch profile:', e)
    } finally {
      setSwitchingKey(null)
    }
  }, [refreshState, remoteProfiles])

  const handleCustomCloudModelSelect = useCallback(async (profileId: string, modelId: string, entryKey = '') => {
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
  }, [refreshState, markModelUsed])

  const activeProfile = remoteProfiles.find((p) => p.id === activeRemoteProfileId) || null
  const localCustomProfiles = remoteProfiles.filter((p) => p.id !== 'default')
  const defaultCloudProfile = remoteProfiles.find((p) => p.id === 'default') || null
  const isNonDefaultActive = activeProfile && activeProfile.id !== 'default'
  const cloudEngineSelected = runtimeEngineId === 'vgo-remote' && (!activeProfile || activeProfile.id === 'default' || detectEndpointType(activeProfile.baseUrl) !== 'ollama')
  const cloudSelectedModelId = modelCatalog.some((model) => model.id === vgoAIPreferredModel) ? vgoAIPreferredModel : defaultCloudProfile?.model || vgoAIPreferredModel
  const activeCustomCloudProfile = isNonDefaultActive && detectEndpointType(activeProfile.baseUrl) !== 'ollama' ? activeProfile : null

  const currentModelDisplay = useMemo(() => {
    const activeProfile = remoteProfiles.find((p) => p.id === activeRemoteProfileId)
    if (activeProfile && activeProfile.id !== 'default') {
      return { name: activeProfile.name, model: activeProfile.model, isLocal: detectEndpointType(activeProfile.baseUrl) === 'ollama' }
    }
    const cloudModel = modelCatalog.find((m) => m.id === vgoAIPreferredModel)
    return {
      name: cloudModel?.label || vgoAIPreferredModel || t('sidebar.noModelSelected'),
      model: vgoAIPreferredModel || '',
      isLocal: false,
    }
  }, [remoteProfiles, activeRemoteProfileId, modelCatalog, vgoAIPreferredModel, t])

  const cloudModelEntries = useMemo<CloudModelEntry[]>(() => {
    const fromDefault = modelCatalog
      .filter((m) => !/^nvidia\//i.test(m.id))
      .map((model) => ({
      key: `default:${model.id}`,
      source: 'default-cloud' as const,
      profileId: 'default',
      profileName: defaultCloudProfile?.name || t('modelSelector.defaultCloud'),
      modelId: model.id,
      modelLabel: model.label || model.id,
      family: detectModelFamily(model.id, model.label || model.id),
    }))
    const fromCustom = (activeCustomCloudProfile ? [activeCustomCloudProfile] : []).flatMap((profile) => {
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
    return [...fromDefault, ...fromCustom]
  }, [activeCustomCloudProfile, modelCatalog, defaultCloudProfile?.name, t])

  const filteredCloudEntries = useMemo(() => {
    const keyword = modelSearch.trim().toLowerCase()
    if (!keyword) return cloudModelEntries
    return cloudModelEntries.filter((entry) =>
      `${entry.modelId} ${entry.modelLabel} ${entry.profileName} ${entry.family}`.toLowerCase().includes(keyword),
    )
  }, [cloudModelEntries, modelSearch])

  const favoriteCloudEntries = useMemo(() => {
    const order = new Map(modelPrefs.favorites.map((key, index) => [key, index]))
    return filteredCloudEntries.filter((entry) => order.has(entry.key))
      .sort((a, b) => (order.get(a.key) ?? 9999) - (order.get(b.key) ?? 9999))
  }, [filteredCloudEntries, modelPrefs.favorites])

  const recentCloudEntries = useMemo(() => {
    const favoriteSet = new Set(modelPrefs.favorites)
    const order = new Map(modelPrefs.recent.map((key, index) => [key, index]))
    return filteredCloudEntries.filter((entry) => !favoriteSet.has(entry.key) && order.has(entry.key))
      .sort((a, b) => (order.get(a.key) ?? 9999) - (order.get(b.key) ?? 9999))
      .slice(0, 10)
  }, [filteredCloudEntries, modelPrefs.favorites, modelPrefs.recent])

  const familyGroups = useMemo(() => {
    const pinned = new Set([...favoriteCloudEntries.map((e) => e.key), ...recentCloudEntries.map((e) => e.key)])
    const grouped = new Map<string, CloudModelEntry[]>()
    for (const entry of filteredCloudEntries) {
      if (pinned.has(entry.key)) continue
      const list = grouped.get(entry.family) || []
      list.push(entry)
      grouped.set(entry.family, list)
    }
    return [...grouped.entries()]
      .map(([family, entries]) => ({ family, entries: [...entries].sort((a, b) => a.modelLabel.localeCompare(b.modelLabel)) }))
      .sort((a, b) => a.family.localeCompare(b.family))
  }, [filteredCloudEntries, favoriteCloudEntries, recentCloudEntries])

  const initRef = useRef(false)
  useEffect(() => {
    if (initRef.current || modelPrefs.collapsedFamiliesInitialized || familyGroups.length === 0) return
    initRef.current = true
    updateModelPrefs((prev) => ({
      ...prev,
      collapsedFamilies: familyGroups.map((g) => g.family),
      collapsedFamiliesInitialized: true,
    }))
  }, [familyGroups, modelPrefs.collapsedFamiliesInitialized, updateModelPrefs])

  const activeProfileModel = activeProfile?.model ?? null
  const isCloudEntryActive = useCallback((entry: CloudModelEntry) => {
    if (entry.source === 'default-cloud') return cloudEngineSelected && cloudSelectedModelId === entry.modelId
    return activeRemoteProfileId === entry.profileId && activeProfileModel === entry.modelId && runtimeEngineId === 'vgo-remote'
  }, [activeRemoteProfileId, activeProfileModel, cloudEngineSelected, cloudSelectedModelId, runtimeEngineId])

  const renderCloudEntry = (entry: CloudModelEntry) => {
    const isActive = isCloudEntryActive(entry)
    const isFavorite = modelPrefs.favorites.includes(entry.key)
    const isSwitching = entry.source === 'default-cloud'
      ? switchingKey === `cloud-${entry.modelId}`
      : switchingKey === `custom-cloud-${entry.profileId}-${entry.modelId}`
    return (
      <div key={entry.key} className="model-option-row">
        <button
          className={`model-option ${isActive ? 'active' : ''}`}
          onClick={() => void (entry.source === 'default-cloud'
            ? handleModelSelect(entry.modelId, entry.key)
            : handleCustomCloudModelSelect(entry.profileId, entry.modelId, entry.key))}
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
          onClick={(event) => { event.stopPropagation(); toggleFavoriteModel(entry.key) }}
          title={isFavorite ? t('modelSelector.removeFavorite') : t('modelSelector.addFavorite')}
        >
          <Star size={12} />
        </button>
      </div>
    )
  }

  return (
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

      {(vgoAILoggedIn || remoteProfiles.length > 0) && (
        <div className="model-selector">
          <button className="model-selector-header" onClick={() => setModelsExpanded(!modelsExpanded)}>
            <div className="model-selector-label">
              <Bot size={14} />
              <span>{t('sidebar.currentModel')}</span>
            </div>
            <div className="model-selector-current">
              <span className="current-model-name">
                {currentModelDisplay.name}
                {currentModelDisplay.isLocal && <span className="local-badge">{t('modelSelector.localBadge')}</span>}
              </span>
              {modelsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>

          {modelsExpanded && (
            <div className="model-list model-list-expanded" onClick={(e) => e.stopPropagation()}>
              {localCustomProfiles.length > 0 && (
                <>
                  <div className="model-list-section-title">
                    <span>{t('modelSelector.localCustomTitle')}</span>
                    {isNonDefaultActive && <span className="active-indicator">{t('modelSelector.inUse')}</span>}
                  </div>
                  {localCustomProfiles.map((profile) => {
                    const isActive = activeRemoteProfileId === profile.id
                    const isSwitching = switchingKey === `profile-${profile.id}`
                    const endpointType = detectEndpointType(profile.baseUrl)
                    return (
                      <button key={profile.id} className={`model-option ${isActive ? 'active' : ''}`}
                        onClick={() => void handleProfileSelect(profile.id)} disabled={Boolean(switchingKey)}>
                        <div className="model-option-info">
                          <span className="model-option-name">{profile.name}</span>
                          <span className="model-option-meta">
                            <span className={`endpoint-badge ${endpointType}`}>{endpointBadgeLabel(endpointType, t)}</span>
                            {profile.model}
                          </span>
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
                    <span>{t('modelSelector.cloudModels')}</span>
                    <span className="active-indicator">{filteredCloudEntries.length}</span>
                  </div>
                  <div className="model-search-row">
                    <Search size={13} className="model-search-icon" />
                    <input type="text" className="model-search-input" placeholder={t('modelSelector.searchPlaceholder')}
                      value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} />
                  </div>

                  {favoriteCloudEntries.length > 0 && (
                    <><div className="model-list-section-title"><span>{t('modelSelector.favorites')}</span><span className="active-indicator">{favoriteCloudEntries.length}</span></div>
                      {favoriteCloudEntries.map((entry) => renderCloudEntry(entry))}</>
                  )}
                  {recentCloudEntries.length > 0 && (
                    <><div className="model-list-section-title"><span>{t('modelSelector.recent')}</span><span className="active-indicator">{recentCloudEntries.length}</span></div>
                      {recentCloudEntries.map((entry) => renderCloudEntry(entry))}</>
                  )}
                  {familyGroups.map((group) => {
                    const collapsed = modelPrefs.collapsedFamilies.includes(group.family)
                    return (
                      <div key={group.family}>
                        <button className="model-family-toggle" onClick={() => toggleFamilyCollapsed(group.family)}>
                          <span>{group.family}</span>
                          <span className="model-family-meta">{group.entries.length}{collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}</span>
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
      )}
    </section>
  )
}
