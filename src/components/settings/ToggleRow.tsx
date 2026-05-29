export function ToggleRow({
  title,
  hint,
  enabled,
  onToggle,
}: {
  title: string
  hint: string
  enabled: boolean
  onToggle: () => Promise<void> | void
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-copy">
        <span>{title}</span>
        <p className="hint">{hint}</p>
      </div>
      <button
        type="button"
        className={`toggle ${enabled ? 'on' : ''}`}
        onClick={() => void onToggle()}
      />
    </div>
  )
}
