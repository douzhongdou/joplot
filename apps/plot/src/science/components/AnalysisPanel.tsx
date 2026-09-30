'use client'

import { Ellipsis, Play, Plus } from 'lucide-react'
import type { ScienceValue } from '../types.ts'
import type { ScienceCopy } from '../lib/i18n.ts'
import type { AnalysisStep, OpKind, StepInsertPosition } from '../lib/pipeline.ts'
import { getOperator, OPERATORS, OPERATOR_CATEGORIES, type OperatorParams, type ParamSpec } from '../lib/operators.ts'
import { parseExpression } from '../../lib/expression.ts'
import { Button } from '@joplot/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@joplot/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@joplot/ui/tooltip'
import { Field, NumberInput, SelectInput, TextInput } from './Controls.tsx'
import { vectorFields, vectorId } from '../lib/vectors.ts'

function label(copy: ScienceCopy, key: string, fallback?: string): string {
  return copy.labels[key] ?? fallback ?? key
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

function OperatorMenuItems({ copy, onChoose }: { copy: ScienceCopy; onChoose: (op: OpKind) => void }) {
  return OPERATOR_CATEGORIES.map((category) => (
    <DropdownMenuGroup key={category}>
      <DropdownMenuLabel className="text-xs text-muted-foreground">{copy.categories[category]}</DropdownMenuLabel>
      {OPERATORS.filter((operator) => operator.category === category).map((operator) => (
        <DropdownMenuItem key={operator.kind} onSelect={() => onChoose(operator.kind)}>
          {copy.operators[operator.kind] ?? operator.kind}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  ))
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
  onAdd: (op: OpKind, position: StepInsertPosition) => void
  onUpdate: (step: AnalysisStep) => void
  onRemove: (id: string) => void
  onRunStep: (index: number) => void
}) {
  const producedIds = new Set(steps.map((step) => step.outputId))
  const baseSeries = values.filter((value) => value.kind === 'series' && !producedIds.has(value.id))

  const optionLabel = (value: ScienceValue): string => {
    const source = sourceNames[value.id]
    return source ? `${source} · ${value.name}` : value.name
  }

  const seriesOptionsFor = (index: number): Option[] => {
    const priorOutputIds = new Set(steps.slice(0, index).map((candidate) => candidate.outputId))
    const available = values.filter((value) => !producedIds.has(value.id) || priorOutputIds.has(value.id))

    return [
      ...baseSeries.map((value) => ({ value: value.id, label: optionLabel(value) })),
      ...available.filter((value) => value.kind === 'series' && priorOutputIds.has(value.id))
        .map((value) => ({ value: value.id, label: value.name })),
      ...available.flatMap((value) => vectorFields(value).map((field) => ({
        value: vectorId(value.id, field),
        label: `${optionLabel(value)}.${field}`,
      }))),
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
    <section className="flex flex-col gap-3 p-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45">{copy.analysis}</h2>

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
                <div className="ml-auto flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button
                          type="button"
                          size="icon-sm"
                          className="size-7 rounded-[var(--radius-field)] shadow-none"
                          disabled={running}
                          onClick={() => onRunStep(index)}
                          aria-label={copy.runToHere}
                        >
                          <Play size={14} strokeWidth={2.5} />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{copy.runToHere}</TooltipContent>
                  </Tooltip>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 rounded-[var(--radius-field)] text-base-content/45 hover:bg-base-content/10 hover:text-base-content dark:hover:bg-base-content/10 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-base-content/10 data-[state=open]:text-base-content"
                        aria-label={copy.stepMenu}
                      >
                        <Ellipsis size={16} strokeWidth={2.2} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>{copy.insertBefore}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-80 w-52 overflow-y-auto">
                          <OperatorMenuItems copy={copy} onChoose={(op) => onAdd(op, { type: 'before', stepId: step.id })} />
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>{copy.insertAfter}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-80 w-52 overflow-y-auto">
                          <OperatorMenuItems copy={copy} onChoose={(op) => onAdd(op, { type: 'after', stepId: step.id })} />
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuItem variant="destructive" onSelect={() => onRemove(step.id)}>
                        {copy.remove}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
      <div className="flex items-center gap-3 pt-1">
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon-sm" className="size-8 rounded-full" aria-label={copy.addStep}>
              <Plus size={16} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="max-h-80 w-52 overflow-y-auto">
            <OperatorMenuItems copy={copy} onChoose={(op) => onAdd(op, { type: 'end' })} />
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>
    </section>
  )
}
