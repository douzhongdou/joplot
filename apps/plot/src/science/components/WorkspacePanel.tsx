'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Table2, X } from 'lucide-react'
import type { DatasetMapping, DatasetSummary, ScienceValue } from '../types.ts'
import type { ScienceCopy } from '../lib/i18n.ts'
import { SelectMenu } from '@/components/SelectMenu'
import { Button } from '@joplot/ui/button'
import { vectorData, vectorFields, vectorId } from '../lib/vectors.ts'

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
  datasets,
  mappings,
  importError,
  persistenceError,
  importing,
  onMappingChange,
  onRemoveDataset,
  onInspectDataset,
}: {
  values: ScienceValue[]
  selectedId: string
  copy: ScienceCopy
  onSelect: (id: string) => void
  datasets: DatasetSummary[]
  mappings: Record<string, DatasetMapping>
  importError: string
  persistenceError: boolean
  importing: boolean
  onMappingChange: (datasetId: string, xColumn: string, yColumns: string[], groupColumn: string) => void
  onRemoveDataset: (datasetId: string) => void
  onInspectDataset: (datasetId: string) => void
}) {
  // 数据集卡默认折叠；仅新导入的自动展开（恢复的旧数据集保持折叠）。
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set())
  const knownIdsRef = useRef<Set<string>>(new Set())
  const initializedRef = useRef(false)

  useEffect(() => {
    const current = new Set(datasets.map((dataset) => dataset.id))
    if (initializedRef.current) {
      const fresh = datasets.filter((dataset) => !knownIdsRef.current.has(dataset.id))
      if (fresh.length > 0) {
        setExpandedIds((previous) => new Set([...previous, ...fresh.map((dataset) => dataset.id)]))
      }
    } else {
      initializedRef.current = true
    }
    knownIdsRef.current = current
  }, [datasets])

  function toggleExpanded(datasetId: string) {
    setExpandedIds((previous) => {
      const next = new Set(previous)
      if (next.has(datasetId)) {
        next.delete(datasetId)
      } else {
        next.add(datasetId)
      }
      return next
    })
  }

  // 变量按来源分组：每个数据集一组 + 「派生」（步骤输出与示例信号）。
  const groups = useMemo(() => {
    const byDataset = datasets
      .map((dataset) => ({
        dataset,
        items: values.filter((value) => value.id.startsWith(`ds:${dataset.id}:`)),
      }))
      .filter((group) => group.items.length > 0)
    const derived = values.filter((value) => !value.id.startsWith('ds:'))
    return { byDataset, derived }
  }, [values, datasets])

  function renderValue(value: ScienceValue) {
    const active = value.id === selectedId
    const fields = vectorFields(value)
    return (
      <li key={value.id}>
        <button
          type="button"
          onClick={() => onSelect(value.id)}
          className={`flex w-full items-center gap-2 rounded-[calc(var(--radius-field)-2px)] px-2 py-1.5 text-left transition ${
            active
              ? 'bg-accent'
              : 'hover:bg-muted'
          }`}
        >
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-base-content">{value.name}</span>
          <span className="rounded-full bg-base-200 px-1.5 py-0.5 text-[10px] text-base-content/60">
            {copy.kinds[value.kind]}
          </span>
          <span className="font-mono text-[10px] text-base-content/45">{valueMeta(value)}</span>
        </button>
        {fields.length > 0 && (
          <ul className="ml-3 border-l border-base-300 pl-1.5">
            {fields.map((field) => {
              const id = vectorId(value.id, field)
              const length = (value.kind === 'stats' ? undefined : value.pointCount) ?? vectorData(value, field)?.shape[0] ?? 0
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onSelect(id)}
                    aria-current={selectedId === id ? 'true' : undefined}
                    className={`flex w-full items-center gap-2 rounded-[calc(var(--radius-field)-2px)] px-2 py-1 text-left transition ${selectedId === id ? 'bg-accent' : 'hover:bg-muted'}`}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-base-content/80" title={`${value.name}.${field}`}>{field}</span>
                    <span className="font-mono text-[10px] text-base-content/45">{length.toLocaleString()}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </li>
    )
  }

  return (
    <aside className="flex min-h-0 flex-col gap-3 border-b border-base-300 bg-base-100 p-3 lg:h-full lg:overflow-hidden lg:border-b-0 lg:border-r">
      {importError ? <p role="alert" className="shrink-0 text-xs text-error">{importError}</p> : null}
      {persistenceError ? <p role="alert" className="shrink-0 text-[10px] text-warning">{copy.storageError}</p> : null}

      {/* 数据集（默认折叠） */}
      {datasets.map((dataset) => {
        const mapping = mappings[dataset.id]
        if (!mapping) return null
        const expanded = expandedIds.has(dataset.id)
        return (
          <div key={dataset.id} className={`shrink-0 rounded-[var(--radius-field)] bg-muted/50 ${importing ? 'pointer-events-none opacity-60' : ''}`}>
            <div className="flex items-center gap-1 py-1 pl-1 pr-1.5">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggleExpanded(dataset.id)}
                className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left"
              >
                <ChevronDown size={12} strokeWidth={2.2} className={`shrink-0 text-base-content/45 transition ${expanded ? '' : '-rotate-90'}`} />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-base-content" title={dataset.fileName}>
                  {dataset.fileName}
                </span>
                <span className="shrink-0 text-[10px] text-base-content/50">
                  {dataset.rowCount.toLocaleString()} × {dataset.headers.length} · X: {mapping.xColumn || copy.rowIndex}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6 shrink-0"
                onClick={() => onInspectDataset(dataset.id)}
                aria-label={`${copy.rawData}: ${dataset.fileName}`}
                title={copy.rawData}
              >
                <Table2 size={14} aria-hidden="true" />
              </Button>
              <button
                type="button"
                onClick={() => onRemoveDataset(dataset.id)}
                aria-label={copy.removeDataset}
                title={copy.removeDataset}
                className="grid size-5 shrink-0 place-items-center rounded-full text-base-content/45 transition hover:bg-destructive/10 hover:text-destructive"
              >
                <X size={12} />
              </button>
            </div>
            {expanded && (
              <div className="flex flex-col gap-2 px-2.5 pb-2.5">
                <label className="flex flex-col gap-1 text-[11px] text-base-content/65">
                  {copy.xColumn}
                  <SelectMenu
                    value={mapping.xColumn}
                    options={[
                      { value: '', label: copy.rowIndex },
                      ...dataset.numericColumns.map((name) => ({ value: name, label: name })),
                    ]}
                    onChange={(value) => onMappingChange(dataset.id, value, mapping.yColumns, mapping.groupColumn ?? '')}
                    triggerSize="sm"
                    buttonClassName="h-8 text-xs"
                  />
                </label>
                <fieldset className="flex flex-col gap-1 text-[11px] text-base-content/65">
                  <legend>{copy.yColumns}</legend>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {dataset.numericColumns.filter((name) => name !== mapping.xColumn).map((name) => (
                      <label key={name} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-base-100">
                        <input
                          type="checkbox"
                          checked={mapping.yColumns.includes(name)}
                          disabled={mapping.yColumns.length === 1 && mapping.yColumns[0] === name}
                          onChange={(event) => onMappingChange(dataset.id, mapping.xColumn, event.target.checked
                            ? [...mapping.yColumns, name]
                            : mapping.yColumns.filter((candidate) => candidate !== name), mapping.groupColumn ?? '')}
                          className="size-3.5 accent-[var(--color-primary)]"
                        />
                        <span className="truncate" title={name}>{name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="flex flex-col gap-1 text-[11px] text-base-content/65">
                  {copy.groupColumn}
                  <SelectMenu
                    value={mapping.groupColumn ?? ''}
                    options={[
                      { value: '', label: copy.groupNone },
                      ...dataset.headers
                        .filter((name) => name !== mapping.xColumn)
                        .map((name) => ({ value: name, label: name })),
                    ]}
                    onChange={(value) => onMappingChange(dataset.id, mapping.xColumn, mapping.yColumns, value)}
                    triggerSize="sm"
                    buttonClassName="h-8 text-xs"
                  />
                </label>
              </div>
            )}
          </div>
        )
      })}

      {/* 变量（主区域，独立滚动） */}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <h2 className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45">{copy.variables}</h2>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.byDataset.map((group) => (
            <div key={group.dataset.id}>
              <div className="truncate px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-base-content/40" title={group.dataset.fileName}>
                {group.dataset.fileName}
              </div>
              <ul className="flex flex-col gap-1">{group.items.map(renderValue)}</ul>
            </div>
          ))}
          {groups.derived.length > 0 && (
            <div>
              {groups.byDataset.length > 0 && (
                <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-base-content/40">
                  {copy.derived}
                </div>
              )}
              <ul className="flex flex-col gap-1">{groups.derived.map(renderValue)}</ul>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
