interface AttachmentItem {
  name: string
  path: string
  size: number
  isText: boolean
  content?: string
  mediaType?: 'image' | 'audio' | 'video' | 'file'
  imageBase64?: string
}

interface VGODesktopAPI {
  createSession?: () => void
  resetSession?: () => void
  switchSession?: (sessionId: string) => Promise<any>
  deleteSession?: (sessionId: string) => Promise<any>
  pickWorkspace?: () => void
  analyze?: () => void
  login?: () => void
  logout?: () => void
  renameSession?: (name: string) => void
  submitPrompt?: (payload: { text: string; attachments?: AttachmentItem[] } | string) => void
  stopPrompt?: () => void
  attachFile?: () => Promise<AttachmentItem[]>
  removeAttachment?: (index: number) => Promise<{ ok: boolean }>
  respondPermission?: (payload: { requestId: string; approved: boolean }) => Promise<any>
  
  on?: (channel: string, callback: (...args: any[]) => void) => void
  off?: (channel: string, callback: (...args: any[]) => void) => void
  
  getState?: () => any
  getSettings?: () => any
  setState?: (state: any) => void
  setEngine?: (engineId: string) => Promise<any>
  updateAppearance?: (payload: any) => Promise<any>
  updateLocalization?: (payload: any) => Promise<any>
  updateBehavior?: (payload: any) => Promise<any>
  updateAgentPreferences?: (payload: any) => Promise<any>
  updateVgoAiProfile?: (payload: any) => Promise<any>
  updatePermissions?: (payload: any) => Promise<any>
  updateAccess?: (payload: any) => Promise<any>
  updateRemote?: (payload: any) => Promise<any>
  createRemoteProfile?: (payload: any) => Promise<any>
  updateRemoteProfile?: (profileId: string, payload: any) => Promise<any>
  deleteRemoteProfile?: (profileId: string) => Promise<any>
  selectRemoteProfile?: (profileId: string) => Promise<any>
  refreshRemoteProfileModels?: (profileId?: string) => Promise<any>
  installSkill?: (payload: { sourcePath: string; name?: string }) => Promise<any>
  reportRendererError?: (payload: { source?: string; message?: string }) => void
  checkForUpdates?: (payload?: { force?: boolean; updateUrl?: string }) => Promise<any>
  installUpdate?: (payload?: { downloadUrl?: string; latestVersion?: string; releaseNotes?: string; releaseDate?: string }) => Promise<any>
  skipVersion?: (version: string) => Promise<any>
  resetSkipVersion?: () => Promise<any>
  setAutoCheck?: (enabled: boolean, intervalHours?: number) => Promise<any>
  getUpdateSettings?: () => Promise<any>
}

declare global {
  interface Window {
    vgoDesktop?: VGODesktopAPI
  }
}
