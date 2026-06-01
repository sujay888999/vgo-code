interface AttachmentItem {
  name: string
  path: string
  size: number
  isText: boolean
  content?: string
  mediaType?: 'image' | 'audio' | 'video' | 'file'
  imageBase64?: string
}

interface DesktopState {
  sessions?: Array<Record<string, unknown>>
  activeSessionId?: string
  workspace?: string
  settings?: Record<string, unknown>
  history?: Array<Record<string, unknown>>
  runtime?: {
    engineId: string
    engineLabel: string
    providerLabel: string
  }
  engines?: Array<Record<string, string>>
  contextStats?: Record<string, unknown>
  mockServer?: Record<string, string> | null
  skills?: Array<Record<string, unknown>>
}

interface DesktopResult {
  ok: boolean
  runtime?: {
    engineId: string
    engineLabel: string
    providerLabel: string
  }
  settings?: Record<string, unknown>
}

interface UpdateInfo {
  ok?: boolean
  error?: string
  updateAvailable?: boolean
  currentVersion?: string
  latestVersion?: string
  downloadUrl?: string
  releaseNotes?: string
  releaseDate?: string
}

interface UpdateSettings {
  autoCheck: boolean
  intervalHours?: number
  skippedVersion?: string
}

interface VGODesktopAPI {
  createSession?: () => Promise<DesktopResult>
  resetSession?: () => Promise<DesktopResult>
  switchSession?: (sessionId: string) => Promise<DesktopResult>
  deleteSession?: (sessionId: string) => Promise<DesktopResult>
  pickWorkspace?: () => Promise<string | null>
  analyze?: () => void
  login?: () => void
  loginWithCredentials?: (payload: { email: string; password: string }) => void
  logout?: () => void
  renameSession?: (name: string) => Promise<DesktopResult>
  submitPrompt?: (payload: { text: string; attachments?: AttachmentItem[] } | string) => void
  stopPrompt?: () => void
  attachFile?: () => Promise<AttachmentItem[]>
  removeAttachment?: (index: number) => Promise<{ ok: boolean }>
  respondPermission?: (payload: { requestId: string; approved: boolean }) => Promise<DesktopResult>
  
  on?: (channel: string, callback: (...args: unknown[]) => void) => void
  off?: (channel: string, callback: (...args: unknown[]) => void) => void
  
  getState?: () => Promise<DesktopState>
  getSettings?: () => Promise<Record<string, unknown>>
  setState?: (state: Record<string, unknown>) => void
  setEngine?: (engineId: string) => Promise<DesktopResult>
  updateAppearance?: (payload: Record<string, unknown>) => Promise<DesktopResult>
  updateLocalization?: (payload: Record<string, unknown>) => Promise<DesktopResult>
  updateBehavior?: (payload: Record<string, unknown>) => Promise<DesktopResult>
  updateAgentPreferences?: (payload: Record<string, unknown>) => Promise<DesktopResult>
  updateVgoAiProfile?: (payload: Record<string, unknown>) => Promise<DesktopResult>
  updatePermissions?: (payload: Record<string, unknown>) => Promise<DesktopResult>
  updateAccess?: (payload: Record<string, unknown>) => Promise<DesktopResult>
  updateRemote?: (payload: Record<string, unknown>) => Promise<DesktopResult>
  createRemoteProfile?: (payload: Record<string, unknown>) => Promise<DesktopResult>
  updateRemoteProfile?: (profileId: string, payload: Record<string, unknown>) => Promise<DesktopResult>
  deleteRemoteProfile?: (profileId: string) => Promise<DesktopResult>
  selectRemoteProfile?: (profileId: string) => Promise<DesktopResult>
  refreshRemoteProfileModels?: (profileId?: string) => Promise<DesktopResult>
  installSkill?: (payload: { sourcePath: string; name?: string }) => Promise<DesktopResult>
  installWhisper?: () => Promise<DesktopResult>
  normalizeEngineLog?: () => Promise<void>
  updateSkillState?: (payload: { id: string; enabled: boolean }) => Promise<DesktopResult>
  togglePinSession?: (sessionId: string) => Promise<DesktopResult>
  reportRendererError?: (payload: { source?: string; message?: string }) => void
  checkForUpdates?: (payload?: { force?: boolean; updateUrl?: string }) => Promise<UpdateInfo>
  installUpdate?: (payload?: { downloadUrl?: string; latestVersion?: string; releaseNotes?: string; releaseDate?: string }) => Promise<DesktopResult>
  skipVersion?: (version: string) => Promise<DesktopResult>
  resetSkipVersion?: () => Promise<DesktopResult>
  setAutoCheck?: (enabled: boolean, intervalHours?: number) => Promise<void>
  getUpdateSettings?: () => Promise<UpdateSettings>
}

declare global {
  interface Window {
    vgoDesktop?: VGODesktopAPI
  }
}
