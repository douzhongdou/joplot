interface SwitchProps {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}

export function Switch({ checked, label, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`flex h-12 items-center justify-between rounded-[var(--radius-box)] border px-4 text-sm font-medium transition ${
        checked
          ? 'border-primary/15 bg-primary/10 text-primary'
          : 'border-base-300 bg-base-100 text-base-content/70 hover:border-primary/20 hover:text-base-content'
      }`}
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <span
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
          checked ? 'bg-primary' : 'bg-base-300'
        }`}
      >
        <span
          className={`size-5 rounded-full bg-base-100 transition ${
            checked ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </span>
    </button>
  )
}
