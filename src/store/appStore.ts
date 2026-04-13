import { create } from 'zustand'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  status?: 'done' | 'error' | 'loading'
  timestamp: number
  kind?: 'default' | 'progress' | 'final'
  collapsed?: boolean
  title?: string
}

const LIVE_TRANSIENT_PREFIX = 'live-assistant-'
const FINAL_TRANSIENT_PREFIX = 'final-assistant-'
const TRANSIENT_MESSAGE_PREFIXES = [LIVE_TRANSIENT_PREFIX, FINAL_TRANSIENT_PREFIX]

function isTransientMessage(message?: Partial<Message> | null) {
  const id = String(message?.id || '')
  return TRANSIENT_MESSAGE_PREFIXES.some((prefix) => id.startsWith(prefix))
}

function isFinalTransientMessage(message?: Partial<Message> | null) {
  const id = String(message?.id || '')
  return id.startsWith(FINAL_TRANSIENT_PREFIX)
}

function normalizeMessageText(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

export interface Session {
  id: string
  title: string
  preview: string
  pinned: boolean
  createdAt: string
  updatedAt: string
  actualModel?: string
  actualChannel?: string
  compressionCount?: number
}

export interface TaskStep {
  id: string
  title: string
  detail: string
  state: 'idle' | 'planning' | 'working' | 'completed' | 'error' | 'permission_requested' | 'permission_granted' | 'permission_denied'
  timestamp: number
  requestId?: string
  tool?: string
}

export interface RemoteProfile {
  id: string
  name: string
  provider: string
  baseUrl: string
  model: string
  apiKey: string
  systemPrompt: string
}

export interface ModelItem {
  id: string
  label: string
  description?: string
  contextWindow?: number
}

export interface SkillItem {
  id: string
  name: string
  description: string
  path: string
  source: string
  enabled: boolean
}

export interface AttachmentItem {
  name: string
  path: string
  size: number
  isText: boolean
  content?: string
  mediaType?: 'image' | 'audio' | 'video' | 'file'
  imageBase64?: string
}

export interface DesktopState {
  settings?: {
    vgoAI?: {
      loggedIn: boolean
      email: string
      displayName: string
      preferredModel: string
      hasAccessToken: boolean
      modelCatalog: ModelItem[]
    }
    appearance?: {
      theme: string
      uiMode: string
      compactMode: boolean
      messageDensity: string
    }
    localization?: { locale: string }
    behavior?: {
      enterToSend: boolean
      autoScroll: boolean
      showTaskPanel: boolean
      confirmDangerousOps: boolean
    }
    agent?: {
      autoSummarizeContext: boolean
      contextCompressionThreshold: number
      showRuntimeMeta: boolean
      showExecutionPlan: boolean
    }
    remote?: object
    remoteProfiles?: RemoteProfile[]
    activeRemoteProfileId?: string
  }
  runtime?: {
    engineId: string
    engineLabel: string
    providerLabel: string
  }
  skills?: SkillItem[]
}

export interface AppState {
  // UI State
  settingsOverlayOpen: boolean
  renameOverlayOpen: boolean
  activeSettingsTab: 'appearance' | 'language' | 'behavior' | 'agent' | 'runtime'
  
  // Auth State
  authFlowState: 'idle' | 'working' | 'done'
  authPollTimer: ReturnType<typeof setInterval> | null
  
  // Runtime State
  promptRunning: boolean
  activeSessionId: string | null
  
  // Data State
  sessions: Session[]
  messages: Message[]
  taskSteps: TaskStep[]
  attachments: AttachmentItem[]
  
  // Settings State
  workspace: string
  theme: 'aurora' | 'paper-light' | 'graphite' | 'solar'
  locale: 'zh-CN' | 'en-US'
  uiMode: 'standard' | 'pro' | 'ux-pro-max'
  messageDensity: 'comfortable' | 'balanced' | 'compact'
  compactMode: boolean
  enterToSend: boolean
  autoScroll: boolean
  showTaskPanel: boolean
  taskPanelCollapsed: boolean
  confirmDangerousOps: boolean
  autoSummarizeContext: boolean
  showRuntimeMeta: boolean
  showExecutionPlan: boolean
  compressionThreshold: number
  
  // VGO AI State
  vgoAILoggedIn: boolean
  vgoAIEmail: string
  vgoAIDisplayName: string
  vgoAIPreferredModel: string
  vgoAIAccessToken: string
  modelCatalog: ModelItem[]
  remoteProfiles: RemoteProfile[]
  activeRemoteProfileId: string | null
  
  // Runtime Info
  runtimeEngineId: string
  runtimeEngineLabel: string
  runtimeProviderLabel: string
  engines: Array<{ id: string; label: string; provider: string }>
  contextStats: {
    estimatedTokens: number
    thresholdTokens: number
    contextWindow: number
    usageSource: 'provider' | 'estimated'
    thresholdRatio?: number
    usagePercent?: number
    remainingTokens?: number
    compressionCount?: number
    lastCompressionAt?: string
  }
  
  // Mock Server
  mockServer: {
    baseUrl: string
    status: string
  } | null
  skills: SkillItem[]

  // Permission & Access State
  permissionMode: 'full' | 'workload-only'
  accessScope: 'workspace-only' | 'workspace-and-desktop' | 'full-system'

  // UI Actions
  setSettingsOverlayOpen: (open: boolean) => void
  setRenameOverlayOpen: (open: boolean) => void
  setActiveSettingsTab: (tab: 'appearance' | 'language' | 'behavior' | 'agent' | 'runtime') => void
  setPromptRunning: (running: boolean) => void
  setPermissionMode: (mode: 'full' | 'workload-only') => void
  setAccessScope: (scope: 'workspace-only' | 'workspace-and-desktop' | 'full-system') => void
  
  // Session Actions
  setSessions: (sessions: Session[]) => void
  setActiveSessionId: (id: string | null) => void
  addMessage: (message: Message) => void
  updateMessage: (id: string, updates: Partial<Message>) => void
  clearMessages: () => void
  addAttachments: (files: AttachmentItem[]) => void
  removeAttachmentAt: (index: number) => void
  clearAttachments: () => void
  togglePin: (sessionId: string) => void
  deleteSession: (sessionId: string) => void
  
  // Task Actions
  setTaskSteps: (steps: TaskStep[]) => void
  addTaskStep: (step: TaskStep) => void
  updateTaskStep: (id: string, updates: Partial<TaskStep>) => void
  settleTaskSteps: (finalState: 'completed' | 'error') => void
  clearTaskSteps: () => void
  
  // Settings Actions
  setTheme: (theme: 'aurora' | 'paper-light' | 'graphite' | 'solar') => void
  setLocale: (locale: 'zh-CN' | 'en-US') => void
  setUiMode: (mode: 'standard' | 'pro' | 'ux-pro-max') => void
  toggleCompactMode: () => void
  toggleEnterToSend: () => void
  toggleAutoScroll: () => void
  toggleShowTaskPanel: () => void
  toggleTaskPanelCollapsed: () => void
  toggleConfirmDangerousOps: () => void
  toggleAutoSummarize: () => void
  toggleShowRuntimeMeta: () => void
  toggleShowExecutionPlan: () => void
  setCompressionThreshold: (threshold: number) => void
  
  // VGO AI Actions
  setVGOAILoggedIn: (loggedIn: boolean) => void
  setVGOAIProfile: (email: string, displayName: string, preferredModel: string, accessToken: string) => void
  setModelCatalog: (catalog: ModelItem[]) => void
  setRemoteProfiles: (profiles: RemoteProfile[]) => void
  setSkills: (skills: SkillItem[]) => void
  
  // Workspace Actions
  setWorkspace: (workspace: string) => void
  setRuntimeInfo: (engineId: string, engineLabel: string, providerLabel: string) => void
  setContextStats: (stats: AppState['contextStats']) => void
  switchEngine: (engineId: string) => Promise<void>
  
  // Hydrate from desktop
  hydrate: (state: Partial<AppState>) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial UI State
  settingsOverlayOpen: false,
  renameOverlayOpen: false,
  activeSettingsTab: 'appearance',
  authFlowState: 'idle',
  authPollTimer: null,
  promptRunning: false,
  activeSessionId: null,
  
  // Initial Data State
  sessions: [],
  messages: [],
  taskSteps: [],
  attachments: [],
  
  // Initial Settings
  workspace: '',
  theme: 'aurora',
  locale: 'zh-CN',
  uiMode: 'standard',
  messageDensity: 'comfortable',
  compactMode: false,
  enterToSend: true,
  autoScroll: true,
  showTaskPanel: false,
  taskPanelCollapsed: false,
  confirmDangerousOps: true,
  autoSummarizeContext: true,
  showRuntimeMeta: true,
  showExecutionPlan: true,
  compressionThreshold: 0.9,
  
  // Initial VGO AI
  vgoAILoggedIn: false,
  vgoAIEmail: '',
  vgoAIDisplayName: '',
  vgoAIPreferredModel: '',
  vgoAIAccessToken: '',
  modelCatalog: [],
  remoteProfiles: [],
  activeRemoteProfileId: null,
  
  // Initial Runtime
  runtimeEngineId: '',
  runtimeEngineLabel: '',
  runtimeProviderLabel: '',
  engines: [],
  contextStats: {
    estimatedTokens: 0,
    thresholdTokens: 0,
    contextWindow: 0,
    usageSource: 'estimated',
    thresholdRatio: 0.9,
    usagePercent: 0,
    remainingTokens: 0,
    compressionCount: 0,
    lastCompressionAt: ''
  },
  mockServer: null,
  skills: [],
  
  // Initial Permission & Access
  permissionMode: 'full',
  accessScope: 'full-system',
  
  // UI Actions
  setSettingsOverlayOpen: (open) => set({ settingsOverlayOpen: open }),
  setRenameOverlayOpen: (open) => set({ renameOverlayOpen: open }),
  setActiveSettingsTab: (tab) => set({ activeSettingsTab: tab }),
  setPromptRunning: (running) => set({ promptRunning: running }),
  setPermissionMode: (mode) => set({ permissionMode: mode }),
  setAccessScope: (scope) => set({ accessScope: scope }),
  
  // Session Actions
  setSessions: (sessions) => set({ sessions }),
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  addMessage: (message) => set((state) => ({ 
    messages: [...state.messages, message] 
  })),
  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map((m) => m.id === id ? { ...m, ...updates } : m)
  })),
  clearMessages: () => set({ messages: [] }),
  addAttachments: (files) =>
    set((state) => ({
      attachments: [
        ...state.attachments,
        ...files.filter(
          (file) =>
            file &&
            typeof file.path === 'string' &&
            !state.attachments.some((existing) => existing.path === file.path),
        ),
      ],
    })),
  removeAttachmentAt: (index) =>
    set((state) => ({
      attachments: state.attachments.filter((_, currentIndex) => currentIndex !== index),
    })),
  clearAttachments: () => set({ attachments: [] }),
  togglePin: (sessionId) => set((state) => ({
    sessions: state.sessions.map(s => 
      s.id === sessionId ? { ...s, pinned: !s.pinned } : s
    )
  })),
  deleteSession: (sessionId) => set((state) => ({
    sessions: state.sessions.filter(s => s.id !== sessionId),
    activeSessionId: state.activeSessionId === sessionId 
      ? (state.sessions.find(s => s.id !== sessionId)?.id || null)
      : state.activeSessionId
  })),
  
  // Task Actions
  setTaskSteps: (steps) => set({ taskSteps: steps }),
  addTaskStep: (step) => set((state) => ({ 
    taskSteps: [...state.taskSteps.slice(-12), step] 
  })),
  updateTaskStep: (id, updates) => set((state) => ({
    taskSteps: state.taskSteps.map((s) => s.id === id ? { ...s, ...updates } : s)
  })),
  settleTaskSteps: (finalState) => set((state) => {
    const pendingStates: TaskStep['state'][] = ['idle', 'planning', 'working', 'permission_requested']
    return {
      taskSteps: state.taskSteps.map((step) =>
        pendingStates.includes(step.state)
          ? { ...step, state: finalState }
          : step
      )
    }
  }),
  clearTaskSteps: () => set({ taskSteps: [] }),
  
  // Settings Actions
  setTheme: (theme) => set({ theme }),
  setLocale: (locale) => set({ locale }),
  setUiMode: (mode) => set({ uiMode: mode }),
  toggleCompactMode: () => set((state) => ({ compactMode: !state.compactMode })),
  toggleEnterToSend: () => set((state) => ({ enterToSend: !state.enterToSend })),
  toggleAutoScroll: () => set((state) => ({ autoScroll: !state.autoScroll })),
  toggleShowTaskPanel: () => set((state) => ({ showTaskPanel: !state.showTaskPanel })),
  toggleTaskPanelCollapsed: () =>
    set((state) => ({ taskPanelCollapsed: !state.taskPanelCollapsed })),
  toggleConfirmDangerousOps: () => set((state) => ({ confirmDangerousOps: !state.confirmDangerousOps })),
  toggleAutoSummarize: () => set((state) => ({ autoSummarizeContext: !state.autoSummarizeContext })),
  toggleShowRuntimeMeta: () => set((state) => ({ showRuntimeMeta: !state.showRuntimeMeta })),
  toggleShowExecutionPlan: () => set((state) => ({ showExecutionPlan: !state.showExecutionPlan })),
  setCompressionThreshold: (threshold) => set({ compressionThreshold: threshold }),
  
  // VGO AI Actions
  setVGOAILoggedIn: (loggedIn) => set({ vgoAILoggedIn: loggedIn }),
  setVGOAIProfile: (email, displayName, preferredModel, accessToken) => set({
    vgoAIEmail: email,
    vgoAIDisplayName: displayName,
    vgoAIPreferredModel: preferredModel,
    vgoAIAccessToken: accessToken
  }),
  setModelCatalog: (catalog) => set({ modelCatalog: catalog }),
  setRemoteProfiles: (profiles) => set({ remoteProfiles: profiles }),
  setSkills: (skills) => set({ skills }),
  
  // Workspace Actions
  setWorkspace: (workspace) => set({ workspace }),
  setRuntimeInfo: (engineId, engineLabel, providerLabel) => set({
    runtimeEngineId: engineId,
    runtimeEngineLabel: engineLabel,
    runtimeProviderLabel: providerLabel
  }),
  setContextStats: (stats) => set({ contextStats: stats }),
  switchEngine: async (engineId: string) => {
    try {
      const result = await window.vgoDesktop?.setEngine?.(engineId)
      if (result) {
        set({
          runtimeEngineId: result.runtime?.engineId ?? engineId,
          runtimeEngineLabel: result.runtime?.engineLabel ?? '',
          runtimeProviderLabel: result.runtime?.providerLabel ?? '',
          ...(result.settings ? {
            remoteProfiles: result.settings.remoteProfiles || [],
            activeRemoteProfileId: result.settings.activeRemoteProfileId || null
          } : {})
        })
      }
    } catch (e) {
      console.error('Failed to switch engine:', e)
    }
  },
  
  // Hydrate from desktop
  hydrate: (state: any) => set((current) => {
    // Extract nested settings from Electron state structure
    const settings = state.settings || state
    const vgoAI = settings.vgoAI || {}
    const appearance = settings.appearance || {}
    const localization = settings.localization || {}
    const behavior = settings.behavior || {}
    const agent = settings.agent || {}
    const remote = settings.remote || {}
    const remoteProfiles = settings.remoteProfiles || []
    
    // Convert history entries to messages format
    // Backend sends history as array of {id, role, text, status, createdAt}
    const history = state.history || []
    const historyMessages = history.map((entry: any, index: number) => ({
      id: entry.id || `msg-${index}`,
      role: entry.role || 'assistant',
      text: entry.text || '',
      status: entry.status || 'done',
      timestamp: entry.createdAt ? new Date(entry.createdAt).getTime() : Date.now()
    }))
    const transientMessages = current.messages.filter((message) => isTransientMessage(message))
    const persistedAssistantTexts = new Set(
      historyMessages
        .filter((message) => message.role === 'assistant')
        .map((message) => normalizeMessageText(message.text))
        .filter(Boolean),
    )
    const dedupedTransientMessages = transientMessages.filter((message) => {
      if (!isFinalTransientMessage(message)) {
        return true
      }
      return !persistedAssistantTexts.has(normalizeMessageText(message.text))
    })
    const messages =
      state.activeSessionId !== current.activeSessionId
        ? []
        : historyMessages.length > 0
          ? [...historyMessages, ...dedupedTransientMessages]
          : current.messages
    
    return {
      sessions: state.sessions ?? current.sessions,
      activeSessionId: state.activeSessionId !== undefined && state.activeSessionId !== null ? state.activeSessionId : current.activeSessionId,
      messages,
      workspace: state.workspace ?? current.workspace,
      theme: appearance.theme ?? current.theme,
      locale: localization.locale ?? current.locale,
      uiMode: appearance.uiMode ?? current.uiMode,
      messageDensity: appearance.messageDensity ?? current.messageDensity,
      compactMode:
        typeof appearance.compactMode === 'boolean' ? appearance.compactMode : current.compactMode,
      enterToSend:
        typeof behavior.enterToSend === 'boolean' ? behavior.enterToSend : current.enterToSend,
      autoScroll:
        typeof behavior.autoScroll === 'boolean' ? behavior.autoScroll : current.autoScroll,
      showTaskPanel:
        typeof behavior.showTaskPanel === 'boolean' ? behavior.showTaskPanel : current.showTaskPanel,
      confirmDangerousOps:
        typeof behavior.confirmDangerousOps === 'boolean'
          ? behavior.confirmDangerousOps
          : current.confirmDangerousOps,
      autoSummarizeContext:
        typeof agent.autoSummarizeContext === 'boolean'
          ? agent.autoSummarizeContext
          : current.autoSummarizeContext,
      showRuntimeMeta:
        typeof agent.showRuntimeMeta === 'boolean' ? agent.showRuntimeMeta : current.showRuntimeMeta,
      showExecutionPlan:
        typeof agent.showExecutionPlan === 'boolean'
          ? agent.showExecutionPlan
          : current.showExecutionPlan,
      compressionThreshold:
        typeof agent.contextCompressionThreshold === 'number'
          ? Math.max(
              0.5,
              Math.min(
                0.98,
                agent.contextCompressionThreshold > 1
                  ? agent.contextCompressionThreshold / 100
                  : agent.contextCompressionThreshold,
              ),
            )
          : current.compressionThreshold,
      permissionMode:
        settings.permissions?.mode === 'default' ? 'workload-only' : 'full',
      accessScope:
        settings.access?.scope === 'workspace-only' ||
        settings.access?.scope === 'workspace-and-desktop' ||
        settings.access?.scope === 'full-system'
          ? settings.access.scope
          : current.accessScope,
      // VGO AI - nested under settings.vgoAI
      vgoAILoggedIn: vgoAI.loggedIn ?? current.vgoAILoggedIn,
      vgoAIEmail: vgoAI.email ?? current.vgoAIEmail,
      vgoAIDisplayName: vgoAI.displayName ?? current.vgoAIDisplayName,
      vgoAIPreferredModel: vgoAI.preferredModel ?? current.vgoAIPreferredModel,
      vgoAIAccessToken: vgoAI.hasAccessToken ? '***' : current.vgoAIAccessToken,
      modelCatalog: vgoAI.modelCatalog ?? current.modelCatalog,
      // Remote profiles - nested under settings
      remoteProfiles: remoteProfiles.length ? remoteProfiles : current.remoteProfiles,
      activeRemoteProfileId: settings.activeRemoteProfileId ?? current.activeRemoteProfileId,
      // Runtime info
      runtimeEngineId: state.runtime?.engineId ?? current.runtimeEngineId,
      runtimeEngineLabel: state.runtime?.engineLabel ?? current.runtimeEngineLabel,
      runtimeProviderLabel: state.runtime?.providerLabel ?? current.runtimeProviderLabel,
      engines: state.engines ?? current.engines,
      contextStats: state.contextStats ?? current.contextStats,
      mockServer: state.mockServer ?? current.mockServer,
      skills: state.skills ?? current.skills
    }
  })
}))
