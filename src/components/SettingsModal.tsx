import { useMemo } from 'react'
import {
  Bot,
  Cpu,
  Globe,
  Palette,
  Settings2,
  X,
} from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useI18n } from '../i18n'
import { AppearanceTab } from './settings/AppearanceTab'
import { LanguageTab } from './settings/LanguageTab'
import { BehaviorTab } from './settings/BehaviorTab'
import { AgentTab } from './settings/AgentTab'
import { RuntimeTab } from './settings/RuntimeTab'

type SettingsTab = 'appearance' | 'language' | 'behavior' | 'agent' | 'runtime'

function TabsComponent({ t }: { t: (key: string) => string }) {
  return [
    { id: 'appearance' as SettingsTab, label: t('settings.appearance'), icon: <Palette size={16} /> },
    { id: 'language' as SettingsTab, label: t('settings.language'), icon: <Globe size={16} /> },
    { id: 'behavior' as SettingsTab, label: t('settings.behavior'), icon: <Settings2 size={16} /> },
    { id: 'agent' as SettingsTab, label: t('settings.agent'), icon: <Bot size={16} /> },
    { id: 'runtime' as SettingsTab, label: t('settings.runtime'), icon: <Cpu size={16} /> },
  ]
}

export function SettingsModal() {
  const { t } = useI18n()
  const { setSettingsOverlayOpen, activeSettingsTab, setActiveSettingsTab } = useAppStore()

  const TABS = useMemo(() => TabsComponent({ t }), [t])

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
            {activeSettingsTab === 'appearance' && <AppearanceTab />}
            {activeSettingsTab === 'language' && <LanguageTab />}
            {activeSettingsTab === 'behavior' && <BehaviorTab />}
            {activeSettingsTab === 'agent' && <AgentTab />}
            {activeSettingsTab === 'runtime' && <RuntimeTab />}
          </div>
        </div>
      </div>
    </div>
  )
}
