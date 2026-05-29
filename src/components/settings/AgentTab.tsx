import { useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useI18n } from '../../i18n'
import { ToggleRow } from './ToggleRow'

export function AgentTab() {
  const { t } = useI18n()
  const {
    autoSummarizeContext, toggleAutoSummarize,
    compressionThreshold, setCompressionThreshold,
    showRuntimeMeta, toggleShowRuntimeMeta,
    showExecutionPlan, toggleShowExecutionPlan,
    skills,
    hydrate,
  } = useAppStore()
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

  const applyAgentPrefs = async (payload: Record<string, unknown>) => {
    await withStatus(t('settings.savingAgent'), async () => {
      const result = await window.vgoDesktop?.updateAgentPreferences?.(payload)
      if (result) hydrate(result)
    })
  }

  const handleToggleSkill = async (skillId: string, enabled: boolean) => {
    await withStatus(
      `${enabled ? t('settings.enabling') : t('settings.disabling')} Skill...`,
      async () => {
        await window.vgoDesktop?.updateSkillState?.({ id: skillId, enabled })
      },
    )
  }

  return (
    <div className="settings-section">
      <ToggleRow
        title={t('settings.autoCompress')}
        hint={t('settings.autoCompressHint')}
        enabled={autoSummarizeContext}
        onToggle={async () => {
          toggleAutoSummarize()
          await applyAgentPrefs({ autoSummarizeContext: !autoSummarizeContext })
        }}
      />
      <div className="slider-row">
        <div>
          <span>{t('settings.compressionThreshold')}</span>
          <p className="hint">{t('settings.compressionThresholdHint')}</p>
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
        title={t('settings.showRuntimeMeta')}
        hint={t('settings.showRuntimeMetaHint')}
        enabled={showRuntimeMeta}
        onToggle={async () => {
          toggleShowRuntimeMeta()
          await applyAgentPrefs({ showRuntimeMeta: !showRuntimeMeta })
        }}
      />
      <ToggleRow
        title={t('settings.showExecutionPlan')}
        hint={t('settings.showExecutionPlanHint')}
        enabled={showExecutionPlan}
        onToggle={async () => {
          toggleShowExecutionPlan()
          await applyAgentPrefs({ showExecutionPlan: !showExecutionPlan })
        }}
      />

      <h3>{t('settings.installedSkills')}</h3>
      <div className="manual-config-card">
        <p className="hint">{t('settings.skillsHint')}</p>
        <div className="remote-profiles skill-list">
          {skills.map((skill) => (
            <div key={skill.id} className={`profile-item skill-item ${skill.enabled ? 'active' : ''}`}>
              <div className="profile-info">
                <span className="profile-name">{skill.name}</span>
                <span className="profile-model">
                  {skill.source} · {skill.path}
                </span>
                <span className="hint">{skill.description}</span>
              </div>
              <button
                type="button"
                className={`skill-toggle-button ${skill.enabled ? 'ghost-button' : 'primary-button'}`}
                onClick={() => void handleToggleSkill(skill.id, !skill.enabled)}
                disabled={busy}
              >
                {skill.enabled ? t('settings.disable') : t('settings.enable')}
              </button>
            </div>
          ))}
          {skills.length === 0 && (
            <p className="manual-config-status">{t('settings.noSkills')}</p>
          )}
        </div>
      </div>
      {status && <p className="manual-config-status">{status}</p>}
    </div>
  )
}
