'use client'

import { useState } from 'react'
import type { ScienceValue } from '../types.ts'
import type { ScienceCopy } from '../lib/i18n.ts'
import type { AnalysisStep, OpKind } from '../lib/pipeline.ts'
import { getOperator, OPERATORS, OPERATOR_CATEGORIES, type OperatorParams, type ParamSpec } from '../lib/operators.ts'
import { parseExpression } from '../../lib/expression.ts'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Field, NumberInput, SelectInput, TextInput } from './Controls.tsx'

function label(copy: ScienceCopy, key: string, fallback?: string): string {
  return copy.labels[key] ?? fallback ?? key
}

function formatNumber(value: number, digits = 4): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  if (value !== 0 && (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3)) {
    return value.toExponential(3)
  }
  return value.toFixed(digits)
}

interface Option {
  value: string
  label: string
}

function ParamControl({
  spec,
  copy,
  params,
  onChange,
}: {
  spec: ParamSpec
  copy: ScienceCopy
  params: OperatorParams
  onChange: (key: string, value: string | number) => void
}) {
  const raw = params[spec.key]

  if (spec.type === 'number') {
    const value = typeof raw === 'number' ? raw : Number(raw)
    return (
      <Field label={label(copy, spec.labelKey)}>
        <NumberInput
          value={Number.isFinite(value) ? value : spec.default}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onChange={(next) => onChange(spec.key, next)}
        />
      </Field>
    )
  }

  if (spec.type === 'select') {
    const value = typeof raw === 'string' ? raw : spec.default
    return (
      <Field label={label(copy, spec.labelKey)}>
        <SelectInput
          value={value}
          options={spec.options.map((option) => ({
            value: option.value,
            label: label(copy, option.labelKey ?? option.value, option.label),
          }))}
          onChange={(next) => onChange(spec.key, next)}
        />
      </Field>
    )
  }

  if (spec.type === 'text') {
    const value = typeof raw === 'string' ? raw : spec.default
    return (
      <Field label={label(copy, spec.labelKey)}>
        <TextInput value={value} onChange={(next) => onChange(spec.key, next)} />
      </Field>
    )
  }

  // expression：解析公式，除保留变量外的字母自动成为参数输入框。
  const value = typeof raw === 'string' ? raw : spec.default
  const reserved = spec.reserved ?? ['x', 'y']
  let variables: string[] = []
  let parseError = ''

  try {
    variables = parseExpression(value).variables.filter((name) => !reserved.includes(name))
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error)
  }

  return (
    <div className="flex flex-col gap-2">
      <Field label={label(copy, spec.labelKey)}>
        <TextInput value={value} onChange={(next) => onChange(spec.key, next)} />
      </Field>
      {parseError ? <p className="text-[10px] text-error">{parseError}</p> : null}
      {variables.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {variables.map((name) => {
            const key = `${spec.key}:${name}`
            const extra = params[key]
            const number = typeof extra === 'number' ? extra : Number(extra)
            return (
              <Field key={name} label={name}>
                <NumberInput
                  value={Number.isFinite(number) ? number : 1}
                  step={0.1}
                  onChange={(next) => onChange(key, next)}
                />
              </Field>
            )
          })}
        </div>
      ) : (
        <p className="text-[10px] text-base-content/45">{copy.labels.exprHint}</p>
      )}
    </div>
  )
}

export type StepStatus = 'clean' | 'dirty' | 'running' | 'error'

function statusDot(status: StepStatus): string {
  if (status === 'running') return 'bg-warning'
  if (status === 'error') return 'bg-error'
  if (status === 'dirty') return 'bg-base-content/30'
  return 'bg-success'
}

export function AnalysisPanel({
  steps,
  values,
  errors,
  timings,
  copy,
  running,
  stepStatus,
  sourceNames = {},
  onAdd,
  onUpdate,
  onRemove,
  onRunStep,
}: {
  steps: AnalysisStep[]
  values: ScienceValue[]
  errors: Record<string, string>
  timings: Record<string, number>
  copy: ScienceCopy
  running: boolean
  stepStatus: (index: number) => StepStatus
  /** valueId → 来源文件名，用于给数据集列的选项加 `文件名 · 列名` 前缀。 */
  sourceNames?: Record<string, string>
  onAdd: (op: OpKind) => void
  onUpdate: (step: AnalysisStep) => void
  onRemove: (id: string) => void
  onRunStep: (index: number) => void
}) {
  const [pendingOp, setPendingOp] = useState<OpKind>('fit')

  const producedIds = new Set(steps.map((step) => step.outputId))
  const baseSeries = values.filter((value) => value.kind === 'series' && !producedIds.has(value.id))

  const optionLabel = (value: ScienceValue): string => {
    const source = sourceNames[value.id]
    return source ? `${source} · ${value.name}` : value.name
  }

  const seriesOptionsFor = (index: number): Option[] => {
    const priorSeriesIds = steps
      .slice(0, index)
      .filter((candidate) => getOperator(candidate.op)?.output === 'series')
      .map((candidate) => candidate.outputId)

    return [
      ...baseSeries.map((value) => ({ value: value.id, label: optionLabel(value) })),
      ...values
        .filter((value) => value.kind === 'series' && priorSeriesIds.includes(value.id))
        .map((value) => ({ value: value.id, label: value.name })),
    ]
  }

  const withMissing = (options: Option[], currentId: string | undefined): Option[] => {
    if (!currentId || options.some((option) => option.value === currentId)) {
      return options
    }
    return [{ value: currentId, label: `${currentId} (missing)` }, ...options]
  }

  const setParam = (step: AnalysisStep, key: string, value: string | number) => {
    onUpdate({ ...step, params: { ...step.params, [key]: value } })
  }

  return (
    <section className="flex flex-col gap-3 border-b border-base-300 p-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45">{copy.analysis}</h2>

      <div className="flex items-center gap-2">
        <Select value={pendingOp} onValueChange={(value) => setPendingOp(value as OpKind)}>
          <SelectTrigger size="sm" className="h-8 min-w-0 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPERATOR_CATEGORIES.map((category) => (
              <SelectGroup key={category}>
                <SelectLabel>{copy.categories[category]}</SelectLabel>
                {OPERATORS.filter((operator) => operator.category === category).map((operator) => (
                  <SelectItem key={operator.kind} value={operator.kind} className="text-xs">
                    {copy.operators[operator.kind] ?? operator.kind}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          onClick={() => onAdd(pendingOp)}
          className="shrink-0 rounded-[var(--radius-field)] text-xs font-semibold"
        >
          {copy.addStep}
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {steps.map((step, index) => {
          const definition = getOperator(step.op)
          const options = seriesOptionsFor(index)

          return (
            <li
              key={step.id}
              className="flex flex-col gap-2 rounded-[calc(var(--radius-field)+0.1rem)] bg-muted/50 p-2.5"
            >
              <div className="flex items-center gap-2">
                <span className={`size-1.5 shrink-0 rounded-full ${statusDot(stepStatus(index))}`} />
                <span className="text-xs font-semibold text-base-content">
                  {copy.operators[step.op] ?? step.op}
                </span>
                <span className="rounded-full bg-base-100 px-1.5 py-0.5 font-mono text-[10px] text-base-content/60">
                  {step.outputId}
                </span>
                {timings[step.id] !== undefined && stepStatus(index) !== 'dirty' ? (
                  <span className="font-mono text-[10px] text-base-content/40">{`${timings[step.id].toFixed(1)}ms`}</span>
                ) : null}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    title={copy.runToHere}
                    disabled={running}
                    onClick={() => onRunStep(index)}
                    className="text-[11px] text-base-content/45 transition hover:text-primary disabled:opacity-40"
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(step.id)}
                    className="text-[10px] text-base-content/45 transition hover:text-error"
                  >
                    {copy.remove}
                  </button>
                </div>
              </div>

              <Field label={copy.input}>
                <SelectInput
                  value={step.inputId}
                  options={withMissing(options, step.inputId)}
                  onChange={(value) => onUpdate({ ...step, inputId: value })}
                />
              </Field>

              {definition?.secondInput ? (
                <Field label={copy.secondInput}>
                  <SelectInput
                    value={step.secondInputId ?? ''}
                    options={withMissing(options, step.secondInputId)}
                    onChange={(value) => onUpdate({ ...step, secondInputId: value })}
                  />
                </Field>
              ) : null}

              {definition?.params
                .filter((spec) => !spec.visibleWhen || spec.visibleWhen(step.params))
                .map((spec) => (
                  <ParamControl
                    key={spec.key}
                    spec={spec}
                    copy={copy}
                    params={step.params}
                    onChange={(key, value) => setParam(step, key, value)}
                  />
                ))}

              {errors[step.id] ? (
                <p className="text-[10px] text-error">{`${copy.error}: ${errors[step.id]}`}</p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function ResultsPanel({ value, copy }: { value: ScienceValue | undefined; copy: ScienceCopy }) {
  if (!value) {
    return <p className="p-4 text-xs text-base-content/45">{copy.noResult}</p>
  }

  return (
    <section className="flex flex-col gap-3 p-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45">
        {`${copy.results} · ${value.name}`}
      </h2>

      <p className="font-mono text-[10px] text-base-content/45">{value.provenance}</p>

      {value.kind === 'stats' ? (
        <table className="w-full text-xs">
          <tbody>
            {value.rows.map((row) => (
              <tr key={row.key} className="border-b border-base-200">
                <td className="py-1 text-base-content/60">{copy.stats[row.key] ?? row.key}</td>
                <td className="py-1 text-right font-mono text-base-content">{formatNumber(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {value.kind === 'fit' ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <span className="text-base-content/60">{copy.fit.rSquared}</span>
            <span className="text-right font-mono">{formatNumber(value.rSquared)}</span>
            <span className="text-base-content/60">{copy.fit.rmse}</span>
            <span className="text-right font-mono">{formatNumber(value.rmse)}</span>
            <span className="text-base-content/60">{copy.fit.converged}</span>
            <span className="text-right font-mono">{copy.fit.yes}</span>
          </div>
          <div>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-base-content/45">
              {copy.fit.params}
            </h3>
            <table className="w-full text-xs">
              <tbody>
                {value.params.map((parameter) => (
                  <tr key={parameter.name} className="border-b border-base-200">
                    <td className="py-1 font-mono text-base-content/70">{parameter.name}</td>
                    <td className="py-1 text-right font-mono text-base-content">{formatNumber(parameter.value)}</td>
                    <td className="py-1 text-right font-mono text-base-content/45">
                      {Number.isFinite(parameter.stderr) ? `± ${formatNumber(parameter.stderr, 3)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {value.kind === 'spectrum' ? (
        <div>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-base-content/45">
            {copy.plot.peak}
          </h3>
          <table className="w-full text-xs">
            <tbody>
              {value.peaks.map((peak) => (
                <tr key={peak.frequency} className="border-b border-base-200">
                  <td className="py-1 font-mono text-base-content/70">{`${formatNumber(peak.frequency, 3)} ${value.frequencyUnit ?? 'Hz'}`}</td>
                  <td className="py-1 text-right font-mono text-base-content">{formatNumber(peak.magnitude)}</td>
                  <td className="py-1 text-right font-mono text-base-content/45">{`${formatNumber(peak.relativeDb, 1)} dB`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {value.kind === 'series' ? (
        <p className="text-xs text-base-content/50">{`${value.y.shape[0]} ${copy.kinds.series}`}</p>
      ) : null}
    </section>
  )
}
