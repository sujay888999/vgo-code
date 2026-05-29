import { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useI18n, setI18nLocale } from '../../i18n'

export function LanguageTab() {
  const { t } = useI18n()
  const { locale, setLocale, hydrate } = useAppStore()
  const [status, setStatus] = useState('')

  const applyLocalization = async (payload: Record<string, unknown>) => {
    setStatus(t('settings.savingLanguage'))
    try {
      const result = await window.vgoDesktop?.updateLocalization?.(payload)
      if (result) hydrate(result)
      window.setTimeout(() => setStatus(''), 1400)
    } catch (error: any) {
      setStatus(error?.message || t('settings.operationFailed'))
    }
  }

  return (
    <div className="settings-section">
      <h3>{t('settings.locale')}</h3>
      <div className="language-grid">
        {[
          ['zh-CN', t('settings.zhCN')],
          ['en-US', t('settings.enUS')],
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
      {status && <p className="manual-config-status">{status}</p>}
    </div>
  )
}
