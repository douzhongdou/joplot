'use client'

import type { ReactNode } from 'react'
import { Button as UIButton } from '@joplot/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@joplot/ui/select'
import { Switch } from '@joplot/ui/switch'

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/55">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-base-content/45">{hint}</span>}
    </label>
  )
}

export interface SelectOption {
  value: string
  label: string
}

// Radix Select forbids empty-string item values; map them to a sentinel.
const EMPTY_VALUE = '__selectinput_empty__'

export function SelectInput({
  value,
  options,
  onChange,
  compact = false,
}: {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  compact?: boolean
}) {
  const hasEmptyOption = options.some((option) => option.value === '')
  // An external '' with no matching empty option means "nothing selected".
  const radixValue = value === '' ? (hasEmptyOption ? EMPTY_VALUE : undefined) : value

  return (
    <Select
      value={radixValue}
      onValueChange={(nextValue) => onChange(nextValue === EMPTY_VALUE ? '' : nextValue)}
    >
      <SelectTrigger size={compact ? 'sm' : 'default'} className={`w-full min-w-0 ${compact ? 'text-xs' : ''}`}>
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value === '' ? EMPTY_VALUE : option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <input
      type="number"
      className="h-9 min-w-0 rounded-[var(--radius-field)] border-0 bg-muted px-3 text-sm text-base-content outline-none transition focus-visible:ring-2 focus-visible:ring-ring/30"
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      onChange={(event) => {
        const next = Number(event.target.value)
        if (Number.isFinite(next)) {
          onChange(next)
        }
      }}
    />
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-base-content/75">
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="inline-flex rounded-[var(--radius-field)] bg-muted p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`rounded-[calc(var(--radius-field)-2px)] px-3 py-1.5 text-xs font-semibold transition ${
            option.value === value
              ? 'bg-base-100 text-primary shadow-sm'
              : 'text-base-content/60 hover:text-base-content'
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled = false,
  expanded,
  label,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'ghost'
  disabled?: boolean
  expanded?: boolean
  label?: string
}) {
  const uiVariant = variant === 'primary' ? 'default' : variant === 'ghost' ? 'ghost' : 'outline'

  return (
    <UIButton
      type="button"
      variant={uiVariant}
      disabled={disabled}
      aria-expanded={expanded}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </UIButton>
  )
}
