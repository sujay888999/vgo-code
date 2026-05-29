import { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useI18n } from '../../i18n'
import { ToggleRow } from './ToggleRow'

export function AppearanceTab() {
  const { t } = useI18n()
  const { theme, setTheme, compactMode, toggleCompactMode, hydrate } = useAppStore()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

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
      if (result) hydrate(result)
    })
  }

  return (
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
      {status && <p className="manual-config-status">{status}</p>}
    </div>
  )
}
