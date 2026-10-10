import { Switch as SwitchPrimitive } from '@joplot/ui/switch'
import { cn } from '@/lib/utils'

interface SwitchProps {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}

export function Switch({ checked, label, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-12 items-center justify-between rounded-[var(--radius-box)] px-4 text-sm font-medium transition',
        checked
          ? 'bg-accent text-accent-foreground'
          : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
      onClick={() => onChange(!checked)}
    >
      <span>{label}</span>
      <SwitchPrimitive
        checked={checked}
        onCheckedChange={onChange}
        onClick={(event) => event.stopPropagation()}
        aria-label={label}
      />
    </button>
  )
}
