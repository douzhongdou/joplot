'use client'

import { useMemo } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { Button } from '@joplot/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@joplot/ui/dropdown-menu'
import type { ImagejCopy } from '../lib/i18n'
import type {
  NumberParamSpec,
  OperatorRegistry,
  OperatorSpec,
  ParticleRow,
  RecipeStep,
  StepParamValue,
  StepResult,
} from '../lib/engineTypes'

interface Props {
  copy: ImagejCopy
  registry: OperatorRegistry
  sourceName: string
  sourceLabel: string
  steps: RecipeStep[]
  results: Record<string, StepResult>
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAdd: (operator: OperatorSpec, index: number) => void
  onRemove: (id: string) => void
  onParam: (id: string, key: string, value: StepParamValue) => void
  onExportParticles: (rows: ParticleRow[]) => void
}

function NumberParam({
  copy,
  spec,
  value,
  onChange,
}: {
  copy: ImagejCopy
  spec: NumberParamSpec
  value: number
  onChange: (value: number) => void
}) {
  const label = copy.steps.params[spec.labelKey] ?? spec.key
  return (
    <label className="grid gap-1">
      <span className="flex items-center justify-between text-[11px] text-base-content/60">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{value}</span>
      </span>
      <span className="flex items-center gap-2">
        {spec.min !== undefined && spec.max !== undefined ? (
          <input
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 1}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="min-w-0 flex-1 accent-primary"
          />
        ) : null}
        <input
          type="number"
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-7 w-20 shrink-0 rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs tabular-nums"
        />
      </span>
    </label>
  )
}

export function StepPanel({
  copy,
  registry,
  sourceName,
  sourceLabel,
  steps,
  results,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  onParam,
  onExportParticles,
}: Props) {
  const grouped = useMemo(
    () => registry.categories.map((category) => ({
      category,
      operators: registry.operators.filter((operator) => operator.category === category),
    })).filter((group) => group.operators.length > 0),
    [registry],
  )

  const operatorByKind = useMemo(
    () => new Map(registry.operators.map((operator) => [operator.kind, operator])),
    [registry],
  )

  const addMenu = (index: number, align: 'start' | 'end' = 'start') => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
          <Plus size={13} />
          {copy.steps.add}
          <ChevronDown size={12} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-48">
        {grouped.map(({ category, operators }, groupIndex) => (
          <div key={category}>
            {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-base-content/50">
              {copy.steps.categories[category] ?? category}
            </DropdownMenuLabel>
            {operators.map((operator) => (
              <DropdownMenuItem key={operator.kind} onSelect={() => onAdd(operator, index)}>
                {copy.steps.ops[operator.labelKey] ?? operator.kind}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">{copy.steps.heading}</h2>
        {addMenu(steps.length, 'end')}
      </div>

      <p className="rounded-[var(--radius-field)] bg-muted/60 px-2 py-1 text-[11px] text-base-content/55">
        {copy.steps.pendingHint}
      </p>

      <ol className="grid gap-2">
        <li className="rounded-[var(--radius-box)] border border-base-300 bg-base-100 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-base-content">{copy.steps.source}</span>
            <span className="truncate font-mono text-[11px] text-base-content/55">{sourceLabel}</span>
          </div>
          {sourceName ? <p className="mt-1 truncate text-[11px] text-base-content/60">{sourceName}</p> : null}
        </li>

        {steps.length === 0 ? (
          <li className="rounded-[var(--radius-box)] border border-dashed border-base-300 p-3 text-xs text-base-content/50">
            {copy.steps.empty}
          </li>
        ) : null}

        {steps.map((step, index) => {
          const operator = operatorByKind.get(step.op)
          const result = results[step.id]
          const selected = selectedId === step.id
          const numberParams = (operator?.params ?? []).filter((spec): spec is NumberParamSpec => spec.type === 'number')

          return (
            <li key={step.id} className="rounded-[var(--radius-box)] border border-base-300 bg-base-100">
              <div className="flex items-center gap-2 p-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => onSelect(selected ? null : step.id)}
                  aria-expanded={selected}
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold text-base-content/70">
                    {index + 1}
                  </span>
                  <span className="truncate text-xs font-medium text-base-content">
                    {operator ? (copy.steps.ops[operator.labelKey] ?? operator.kind) : step.op}
                  </span>
                  {result?.status === 'error' ? (
                    <span className="shrink-0 rounded-full bg-destructive/15 px-1.5 text-[10px] font-semibold text-destructive">
                      !
                    </span>
                  ) : null}
                  <ChevronDown size={13} className={`ml-auto shrink-0 transition-transform ${selected ? 'rotate-180' : ''}`} />
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={copy.steps.remove}
                  onClick={() => onRemove(step.id)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>

              {result?.status === 'error' && result.error ? (
                <p className="mx-2 mb-2 rounded-[var(--radius-field)] bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                  {result.error}
                </p>
              ) : null}

              {selected ? (
                <div className="grid gap-2 border-t border-base-200 p-3">
                  {numberParams.map((spec) => (
                    <NumberParam
                      key={spec.key}
                      copy={copy}
                      spec={spec}
                      value={Number(step.params[spec.key] ?? spec.default)}
                      onChange={(value) => onParam(step.id, spec.key, value)}
                    />
                  ))}

                  {addMenu(index, 'start')}

                  {result?.stats?.length ? (
                    <div className="grid gap-2">
                      {result.stats.map((channel) => (
                        <div key={channel.channel} className="rounded-[var(--radius-field)] bg-muted/50 p-2">
                          <div className="mb-1 flex items-center justify-between text-[11px] text-base-content/60">
                            <span>{copy.steps.channel} {channel.channel}</span>
                            <span className="font-mono tabular-nums">n={channel.count.toLocaleString()}</span>
                          </div>
                          <dl className="grid grid-cols-2 gap-1 text-[11px]">
                            <div><dt className="text-base-content/50">{copy.stats.mean}</dt><dd className="font-mono">{channel.mean.toFixed(2)}</dd></div>
                            <div><dt className="text-base-content/50">{copy.stats.stdDev}</dt><dd className="font-mono">{channel.stdDev.toFixed(2)}</dd></div>
                            <div><dt className="text-base-content/50">{copy.stats.min}</dt><dd className="font-mono">{channel.min}</dd></div>
                            <div><dt className="text-base-content/50">{copy.stats.max}</dt><dd className="font-mono">{channel.max}</dd></div>
                          </dl>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {result?.table ? (
                    <div className="grid gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-base-content/60">
                          {copy.binary.particles}: {result.table.length}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7"
                          onClick={() => onExportParticles(result.table ?? [])}
                        >
                          {copy.binary.exportCsv}
                        </Button>
                      </div>
                      <div className="max-h-56 overflow-auto">
                        <table className="w-full min-w-[260px] text-left text-[11px] tabular-nums">
                          <thead>
                            <tr className="border-b border-base-300">
                              <th className="p-1">{copy.steps.channel}</th>
                              <th className="p-1">#</th>
                              <th className="p-1">{copy.stats.area}</th>
                              <th className="p-1">{copy.binary.perimeter}</th>
                              <th className="p-1">{copy.binary.circularity}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.table.slice(0, 200).map((row) => (
                              <tr key={`${row.channel}-${row.id}`} className="border-b border-base-200">
                                <td className="p-1">{row.channel}</td>
                                <td className="p-1">{row.id}</td>
                                <td className="p-1">{row.area}</td>
                                <td className="p-1">{row.perimeter}</td>
                                <td className="p-1">{row.circularity.toFixed(3)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}

                  {result?.ms !== undefined ? (
                    <p className="text-right font-mono text-[10px] text-base-content/40">{result.ms.toFixed(1)} ms</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
