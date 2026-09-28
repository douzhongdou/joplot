'use client'

import type { ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const INPUT_CLASS =
  'h-8 min-w-0 rounded-[var(--radius-field)] border-0 bg-muted px-2 text-xs text-base-content outline-none transition focus-visible:ring-2 focus-visible:ring-ring/30'

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-base-content/50">{label}</span>
      {children}
    </label>
  )
}

// Radix Select forbids empty-string item values; map them to a sentinel.
const EMPTY_VALUE = '__selectinput_empty__'

export function SelectInput({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  const hasEmptyOption = options.some((option) => option.value === '')
  // An external '' with no matching empty option means "nothing selected".
  const radixValue = value === '' ? (hasEmptyOption ? EMPTY_VALUE : undefined) : value

  return (
    <Select
      value={radixValue}
      onValueChange={(nextValue) => onChange(nextValue === EMPTY_VALUE ? '' : nextValue)}
    >
      <SelectTrigger size="sm" className="h-8 w-full min-w-0 text-xs">
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value === '' ? EMPTY_VALUE : option.value} className="text-xs">
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
