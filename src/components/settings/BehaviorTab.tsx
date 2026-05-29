import { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useI18n } from '../../i18n'
import { ToggleRow } from './ToggleRow'

export function BehaviorTab() {
  const { t } = useI18n()
  const {
    enterToSend, toggleEnterToSend,
    autoScroll, toggleAutoScroll,
    showTaskPanel, toggleShowTaskPanel,
    confirmDangerousOps, toggleConfirmDangerousOps,
    accessScope, setAccessScope,
    hydrate,
  } = useAppStore()
  const [status, setStatus] = useState('')

  const applyBehavior = async (payload: Record<string, unknown>) => {
    setStatus(t('settings.savingBehavior'))
    try {
      const result = await window.vgoDesktop?.updateBehavior?.(payload)
      if (result) hydrate(result)
      window.setTimeout(() => setStatus(''), 1400)
    } catch (error: any) {
      setStatus(error?.message || t('settings.operationFailed'))
    }
  }

  const applyAccess = async (payload: Record<string, unknown>) => {
    setStatus(t('settings.saving'))
    try {
      const result = await window.vgoDesktop?.updateAccess?.(payload)
      if (result) hydrate(result)
      window.setTimeout(() => setStatus(''), 1400)
    } catch (error: any) {
      setStatus(error?.message || t('settings.operationFailed'))
    }
  }

  return (
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
      {status && <p className="manual-config-status">{status}</p>}
    </div>
  )
}
