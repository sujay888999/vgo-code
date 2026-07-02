import { useI18n } from '../i18n'

function formatRelativeTime(startedAt: string): string {
  if (!startedAt) return ''
  const started = new Date(startedAt).getTime()
  if (Number.isNaN(started)) return ''
  const diff = Math.max(0, Date.now() - started)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return new Date(started).toLocaleString()
}

export function ResumeDialog({
  session,
  onResume,
  onDismiss,
}: {
  session: ResumableSession
  onResume: () => Promise<void>
  onDismiss: () => Promise<void>
}) {
  const { t } = useI18n()
  const startedAt = session.lastTask?.startedAt || ''
  const step = Number(session.lastTask?.step) || 0
  const lastStep = Number(session.lastCompletedStepIndex) || 0
  const title = session.title?.trim() || '未命名会话'

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card resume-dialog">
        <header className="resume-dialog-header">
          <h3>检测到上次未完成的任务</h3>
          <p className="hint">
            会话“{title}”在 {formatRelativeTime(startedAt)} 还停留在第 {Math.max(step, lastStep) + 1} 步。
          </p>
        </header>
        <section className="resume-dialog-body">
          <div className="resume-context">
            <div className="resume-context-row">
              <span className="label">已执行步骤</span>
              <span className="value">{Math.max(step, lastStep)}</span>
            </div>
            <div className="resume-context-row">
              <span className="label">发起时间</span>
              <span className="value">{startedAt ? new Date(startedAt).toLocaleString() : '—'}</span>
            </div>
            {session.lastTask?.model ? (
              <div className="resume-context-row">
                <span className="label">模型</span>
                <span className="value">{session.lastTask.model}</span>
              </div>
            ) : null}
          </div>
          <details className="resume-prompt-preview">
            <summary>查看原始提示词</summary>
            <pre>{session.lastTask?.prompt || ''}</pre>
          </details>
        </section>
        <footer className="resume-dialog-footer">
          <button
            type="button"
            className="ghost-button"
            onClick={() => void onDismiss()}
          >
            放弃恢复
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void onResume()}
            autoFocus
          >
            从上次中断处继续
          </button>
        </footer>
      </div>
    </div>
  )
}
