'use client'

import type { ReactNode } from 'react'

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
  return (
    <select
      className={`min-w-0 rounded-[var(--radius-field)] border border-base-300 bg-base-100 text-base-content outline-none transition focus:border-primary/50 ${compact ? 'h-8 px-2 text-xs' : 'h-9 px-3 text-sm'}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
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
      className="h-9 min-w-0 rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-3 text-sm text-base-content outline-none transition focus:border-primary/50"
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
      <input
        type="checkbox"
        className="size-4 accent-[var(--color-primary)]"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
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
    <div className="inline-flex rounded-[var(--radius-field)] border border-base-300 bg-base-200 p-0.5">
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
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'ghost'
  disabled?: boolean
}) {
  const styles = variant === 'primary'
    ? 'bg-primary text-primary-content hover:opacity-90'
    : variant === 'ghost'
      ? 'bg-transparent text-base-content/70 hover:bg-base-200'
      : 'border border-base-300 bg-base-100 text-base-content hover:border-primary/40'

  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-field)] px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
