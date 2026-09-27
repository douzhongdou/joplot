'use client'

import type { ScienceValue } from '../types.ts'
import type { ScienceCopy } from '../lib/i18n.ts'

export function valueMeta(value: ScienceValue): string {
  if (value.kind === 'series') {
    return `${value.pointCount ?? value.y.shape[0]} pts`
  }
  if (value.kind === 'spectrum') {
    return `${value.pointCount ?? value.frequency.shape[0]} bins`
  }
  if (value.kind === 'fit') {
    return `R²=${Number.isFinite(value.rSquared) ? value.rSquared.toFixed(4) : '—'}`
  }
  return `n=${value.rows[0]?.value ?? 0}`
}

export function WorkspacePanel({
  values,
  selectedId,
  copy,
  onSelect,
  onReload,
}: {
  values: ScienceValue[]
  selectedId: string
  copy: ScienceCopy
  onSelect: (id: string) => void
  onReload: () => void
}) {
  return (
    <aside className="flex min-h-0 flex-col gap-3 border-b border-base-300 bg-base-100 p-4 lg:h-full lg:overflow-y-auto lg:border-b-0 lg:border-r">
      <header className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{copy.brand}</span>
        <h1 className="text-base font-semibold text-base-content">{copy.title}</h1>
        <p className="text-xs text-base-content/50">{copy.subtitle}</p>
      </header>

      <button
        type="button"
        onClick={onReload}
        className="h-8 rounded-[var(--radius-field)] border border-base-300 bg-base-200 text-xs font-semibold text-base-content/80 transition hover:border-primary/40 hover:text-base-content"
      >
        {copy.loadSample}
      </button>

      <div className="flex flex-col gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45">{copy.variables}</h2>
        <ul className="flex flex-col gap-1">
          {values.map((value) => {
            const active = value.id === selectedId
            return (
              <li key={value.id}>
                <button
                  type="button"
                  onClick={() => onSelect(value.id)}
                  className={`flex w-full items-center gap-2 rounded-[calc(var(--radius-field)-2px)] border px-2 py-1.5 text-left transition ${
                    active
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-transparent hover:border-base-300 hover:bg-base-200'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-base-content">{value.name}</span>
                  <span className="rounded-full bg-base-200 px-1.5 py-0.5 text-[10px] text-base-content/60">
                    {copy.kinds[value.kind]}
                  </span>
                  <span className="font-mono text-[10px] text-base-content/45">{valueMeta(value)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </aside>
  )
}
