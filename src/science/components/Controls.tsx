'use client'

import type { ReactNode } from 'react'

const INPUT_CLASS =
  'h-8 min-w-0 rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs text-base-content outline-none transition focus:border-primary/50'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-base-content/50">{label}</span>
      {children}
    </label>
  )
}

export function SelectInput({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <select className={INPUT_CLASS} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
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
      className={INPUT_CLASS}
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

export function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <input
      type="text"
      className={INPUT_CLASS}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
