/**
 * 算子注册表。
 *
 * 每个算子声明：分类、输入/输出类型、参数规格、以及纯函数实现。
 * UI 依据 `params` 自动渲染参数面板，引擎依据 `run` 执行，新增算子只需在此登记。
 */

import type { FitValue, ScienceValue, Series, SpectrumValue, StatsValue } from '../types.ts'
import { createDense, values1d } from './dense.ts'
import { describe } from './stats.ts'
import { movingAverage, savitzkyGolay } from './smooth.ts'
import { computeSpectrumFor } from './spectrum.ts'
import { FIT_MODELS, collectFitParameters, fitModel } from './fit.ts'
import { parseExpression } from '../../lib/expression.ts'
import {
  applyWindow,
  clipValues,
  detrendValues,
  differentiate,
  gaussianSmooth,
  integrate,
  linearTransform,
  mapValues,
  movingStat,
  normalizeValues,
  type MapFunction,
  type MovingStat,
  type NormalizeMode,
} from './transforms.ts'
import type { DetrendMode, WindowKind } from '../../superplot/types.ts'

export type OperatorCategory = 'math' | 'signal' | 'spectral' | 'stats' | 'fit'
export type OperatorOutput = 'series' | 'spectrum' | 'fit' | 'stats'
export type OperatorParams = Record<string, string | number>

export interface OperatorContext {
  id: string
  name: string
}

export interface SelectOptionSpec {
  value: string
  labelKey?: string
  label?: string
}

export type ParamSpec =
  | {
      key: string
      type: 'number'
      labelKey: string
      default: number
      min?: number
      max?: number
      step?: number
      visibleWhen?: (params: OperatorParams) => boolean
    }
  | {
      key: string
      type: 'select'
      labelKey: string
      default: string
      options: SelectOptionSpec[]
      visibleWhen?: (params: OperatorParams) => boolean
    }
  | {
      key: string
      type: 'text'
      labelKey: string
      default: string
      visibleWhen?: (params: OperatorParams) => boolean
    }
  | {
      key: string
      type: 'expression'
      labelKey: string
      default: string
      /** 保留变量（不生成参数输入框），默认 x 与 y。 */
      reserved?: string[]
      visibleWhen?: (params: OperatorParams) => boolean
    }

export interface OperatorDef {
  kind: string
  category: OperatorCategory
  labelKey: string
  inputKind: 'series'
  secondInput?: 'series'
  output: OperatorOutput
  params: ParamSpec[]
  run: (input: Series, input2: Series | undefined, params: OperatorParams, ctx: OperatorContext) => ScienceValue
}

function numberParam(params: OperatorParams, key: string, fallback: number): number {
  const raw = params[key]
  const value = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function stringParam(params: OperatorParams, key: string, fallback: string): string {
  const raw = params[key]
  return typeof raw === 'string' ? raw : fallback
}

function seriesResult(
  ctx: OperatorContext,
  input: Series,
  y: Float64Array,
  provenance: string,
): Series {
  return {
    id: ctx.id,
    name: ctx.name,
    kind: 'series',
    x: input.x,
    y: createDense(y),
    sampleRate: input.sampleRate,
    xUnit: input.xUnit,
    provenance,
  }
}

const WINDOW_OPTIONS: SelectOptionSpec[] = [
  { value: 'hann', labelKey: 'hann' },
  { value: 'hamming', labelKey: 'hamming' },
  { value: 'blackman', labelKey: 'blackman' },
  { value: 'flattop', labelKey: 'flattop' },
  { value: 'rectangular', labelKey: 'rectangular' },
]

const DETREND_OPTIONS: SelectOptionSpec[] = [
  { value: 'linear', labelKey: 'linear' },
  { value: 'mean', labelKey: 'mean' },
  { value: 'none', labelKey: 'none' },
]

export const OPERATORS: OperatorDef[] = [
  // ---------- 平滑 / 去趋势（signal） ----------
  {
    kind: 'smooth',
    category: 'signal',
    labelKey: 'smooth',
    inputKind: 'series',
    output: 'series',
    params: [
      {
        key: 'method',
        type: 'select',
        labelKey: 'method',
        default: 'savgol',
        options: [{ value: 'savgol', labelKey: 'savgol' }, { value: 'moving', labelKey: 'moving' }],
      },
      { key: 'window', type: 'number', labelKey: 'window', default: 11, min: 3, step: 2 },
      { key: 'order', type: 'number', labelKey: 'order', default: 3, min: 0, max: 4 },
    ],
    run(input, _input2, params, ctx) {
      const method = stringParam(params, 'method', 'savgol')
      const window = Math.max(3, Math.round(numberParam(params, 'window', 11)))
      const order = Math.max(0, Math.round(numberParam(params, 'order', 3)))
      const source = values1d(input.y)
      const next = method === 'moving' ? movingAverage(source, window) : savitzkyGolay(source, window, order)
      return seriesResult(
        ctx,
        input,
        next,
        `smooth(${method}, window=${window}${method === 'savgol' ? `, order=${order}` : ''}) on ${input.name}`,
      )
    },
  },
  {
    kind: 'gaussian',
    category: 'signal',
    labelKey: 'gaussianSmooth',
    inputKind: 'series',
    output: 'series',
    params: [{ key: 'sigma', type: 'number', labelKey: 'sigma', default: 2, min: 0.1, step: 0.5 }],
    run(input, _input2, params, ctx) {
      const sigma = numberParam(params, 'sigma', 2)
      return seriesResult(ctx, input, gaussianSmooth(values1d(input.y), sigma), `gaussian(σ=${sigma}) on ${input.name}`)
    },
  },
  {
    kind: 'detrend',
    category: 'signal',
    labelKey: 'detrend',
    inputKind: 'series',
    output: 'series',
    params: [{ key: 'mode', type: 'select', labelKey: 'mode', default: 'linear', options: DETREND_OPTIONS }],
    run(input, _input2, params, ctx) {
      const mode = stringParam(params, 'mode', 'linear') as DetrendMode
      return seriesResult(ctx, input, detrendValues(values1d(input.y), mode), `detrend(${mode}) on ${input.name}`)
    },
  },
  {
    kind: 'window',
    category: 'signal',
    labelKey: 'applyWindow',
    inputKind: 'series',
    output: 'series',
    params: [{ key: 'kind', type: 'select', labelKey: 'windowFn', default: 'hann', options: WINDOW_OPTIONS }],
    run(input, _input2, params, ctx) {
      const kind = stringParam(params, 'kind', 'hann') as WindowKind
      return seriesResult(ctx, input, applyWindow(values1d(input.y), kind), `window(${kind}) on ${input.name}`)
    },
  },
  {
    kind: 'movingStat',
    category: 'signal',
    labelKey: 'movingStat',
    inputKind: 'series',
    output: 'series',
    params: [
      {
        key: 'stat',
        type: 'select',
        labelKey: 'stat',
        default: 'std',
        options: [
          { value: 'std', labelKey: 'std' },
          { value: 'rms', labelKey: 'rms' },
          { value: 'min', labelKey: 'min' },
          { value: 'max', labelKey: 'max' },
          { value: 'median', labelKey: 'median' },
          { value: 'mean', labelKey: 'mean' },
        ],
      },
      { key: 'window', type: 'number', labelKey: 'window', default: 11, min: 3, step: 2 },
    ],
    run(input, _input2, params, ctx) {
      const stat = stringParam(params, 'stat', 'std') as MovingStat
      const window = Math.max(3, Math.round(numberParam(params, 'window', 11)))
      return seriesResult(
        ctx,
        input,
        movingStat(values1d(input.y), window, stat),
        `movingStat(${stat}, window=${window}) on ${input.name}`,
      )
    },
  },

  // ---------- 微积分（signal） ----------
  {
    kind: 'differentiate',
    category: 'signal',
    labelKey: 'differentiate',
    inputKind: 'series',
    output: 'series',
    params: [],
    run(input, _input2, _params, ctx) {
      return seriesResult(
        ctx,
        input,
        differentiate(values1d(input.x), values1d(input.y)),
        `d/dt on ${input.name}`,
      )
    },
  },
  {
    kind: 'integrate',
    category: 'signal',
    labelKey: 'integrate',
    inputKind: 'series',
    output: 'series',
    params: [],
    run(input, _input2, _params, ctx) {
      return seriesResult(ctx, input, integrate(values1d(input.x), values1d(input.y)), `∫ on ${input.name}`)
    },
  },

  // ---------- 数学（math） ----------
  {
    kind: 'map',
    category: 'math',
    labelKey: 'map',
    inputKind: 'series',
    output: 'series',
    params: [
      {
        key: 'fn',
        type: 'select',
        labelKey: 'function',
        default: 'abs',
        options: [
          { value: 'abs', labelKey: 'abs' },
          { value: 'sqrt', labelKey: 'sqrt' },
          { value: 'square', labelKey: 'square' },
          { value: 'ln', labelKey: 'ln' },
          { value: 'log10', labelKey: 'log10' },
          { value: 'exp', labelKey: 'exp' },
          { value: 'negate', labelKey: 'negate' },
          { value: 'reciprocal', labelKey: 'reciprocal' },
        ],
      },
    ],
    run(input, _input2, params, ctx) {
      const fn = stringParam(params, 'fn', 'abs') as MapFunction
      return seriesResult(ctx, input, mapValues(values1d(input.y), fn), `${fn}(${input.name})`)
    },
  },
  {
    kind: 'linear',
    category: 'math',
    labelKey: 'linearTransform',
    inputKind: 'series',
    output: 'series',
    params: [
      { key: 'a', type: 'number', labelKey: 'a', default: 1, step: 0.1 },
      { key: 'b', type: 'number', labelKey: 'b', default: 0, step: 0.1 },
    ],
    run(input, _input2, params, ctx) {
      const a = numberParam(params, 'a', 1)
      const b = numberParam(params, 'b', 0)
      return seriesResult(ctx, input, linearTransform(values1d(input.y), a, b), `${a}·${input.name} + ${b}`)
    },
  },
  {
    kind: 'normalize',
    category: 'math',
    labelKey: 'normalize',
    inputKind: 'series',
    output: 'series',
    params: [
      {
        key: 'mode',
        type: 'select',
        labelKey: 'mode',
        default: 'zscore',
        options: [
          { value: 'zscore', labelKey: 'zscore' },
          { value: 'minmax', labelKey: 'minmax' },
          { value: 'peak', labelKey: 'peak' },
        ],
      },
    ],
    run(input, _input2, params, ctx) {
      const mode = stringParam(params, 'mode', 'zscore') as NormalizeMode
      return seriesResult(ctx, input, normalizeValues(values1d(input.y), mode), `normalize(${mode}) on ${input.name}`)
    },
  },
  {
    kind: 'clip',
    category: 'math',
    labelKey: 'clip',
    inputKind: 'series',
    output: 'series',
    params: [
      { key: 'min', type: 'number', labelKey: 'min', default: -1, step: 0.1 },
      { key: 'max', type: 'number', labelKey: 'max', default: 1, step: 0.1 },
    ],
    run(input, _input2, params, ctx) {
      const min = numberParam(params, 'min', -1)
      const max = numberParam(params, 'max', 1)
      return seriesResult(ctx, input, clipValues(values1d(input.y), min, max), `clip([${min}, ${max}]) on ${input.name}`)
    },
  },

  {
    kind: 'expr',
    category: 'math',
    labelKey: 'expression',
    inputKind: 'series',
    output: 'series',
    params: [
      { key: 'expr', type: 'expression', labelKey: 'formula', default: 'a*y + b', reserved: ['x', 'y'] },
    ],
    run(input, _input2, params, ctx) {
      const source = stringParam(params, 'expr', 'a*y + b')
      const parsed = parseExpression(source)
      const x = values1d(input.x)
      const y = values1d(input.y)
      const length = Math.min(x.length, y.length)
      const buffer = new Float64Array(parsed.parameterNames.length)

      for (let i = 0; i < parsed.parameterNames.length; i += 1) {
        const raw = params[`expr:${parsed.parameterNames[i]}`]
        const value = typeof raw === 'number' ? raw : Number(raw)
        buffer[i] = Number.isFinite(value) ? value : 1
      }

      const out = new Float64Array(y.length)
      parsed.evaluateInto(x, y, buffer, out, length)
      return seriesResult(ctx, input, out, `${source} on ${input.name}`)
    },
  },

  // ---------- 频谱（spectral） ----------
  {
    kind: 'fft',
    category: 'spectral',
    labelKey: 'fft',
    inputKind: 'series',
    output: 'spectrum',
    params: [
      { key: 'window', type: 'select', labelKey: 'windowFn', default: 'hann', options: WINDOW_OPTIONS },
      { key: 'detrend', type: 'select', labelKey: 'detrend', default: 'mean', options: DETREND_OPTIONS },
      { key: 'segments', type: 'number', labelKey: 'segments', default: 1, min: 1 },
    ],
    run(input, _input2, params, ctx): SpectrumValue {
      const sampleRate = input.sampleRate
      if (!sampleRate || !Number.isFinite(sampleRate) || sampleRate <= 0) {
        throw new Error('FFT requires uniformly spaced X values; select row index or a regular time column')
      }
      const computation = computeSpectrumFor(values1d(input.y), sampleRate, {
        window: stringParam(params, 'window', 'hann') as WindowKind,
        detrend: stringParam(params, 'detrend', 'mean') as DetrendMode,
        segments: numberParam(params, 'segments', 1),
      })
      return {
        id: ctx.id,
        name: ctx.name,
        kind: 'spectrum',
        frequency: createDense(computation.frequency),
        magnitude: createDense(computation.magnitude),
        phase: computation.phase ? createDense(computation.phase) : null,
        peaks: computation.peaks,
        sampleRate,
        frequencyUnit: input.xUnit === 's' ? 'Hz' : input.xUnit === 'sample'
          ? 'cycles/sample'
          : `1/${input.xUnit ?? 'x'}`,
        provenance: `fft on ${input.name}`,
      }
    },
  },

  // ---------- 拟合（fit） ----------
  {
    kind: 'fit',
    category: 'fit',
    labelKey: 'fit',
    inputKind: 'series',
    output: 'fit',
    params: [
      {
        key: 'model',
        type: 'select',
        labelKey: 'model',
        default: 'damped',
        options: [
          ...FIT_MODELS.map((model) => ({ value: model.id, labelKey: `model.${model.id}` })),
          { value: 'custom', labelKey: 'model.custom' },
        ],
      },
      { key: 'expr', type: 'text', labelKey: 'expr', default: 'a*x + b', visibleWhen: (params) => params.model === 'custom' },
      { key: 'initial', type: 'text', labelKey: 'initial', default: '' },
    ],
    run(input, _input2, params, ctx): FitValue {
      const x = values1d(input.x)
      const y = values1d(input.y)
      const modelId = stringParam(params, 'model', 'damped')
      const model = FIT_MODELS.find((candidate) => candidate.id === modelId)
      const expression = model ? model.expr : stringParam(params, 'expr', 'a*x + b')

      const parameterNames = collectFitParameters(expression)
      const initial: Record<string, number> = model ? { ...model.guess(x, y) } : {}
      const rawInitial = stringParam(params, 'initial', '')
      if (rawInitial.trim()) {
        rawInitial.split(',').forEach((part, index) => {
          const value = Number(part.trim())
          const name = parameterNames[index]
          if (name && Number.isFinite(value)) initial[name] = value
        })
      }

      const outcome = fitModel({ x, y, expr: expression, initial })

      return {
        id: ctx.id,
        name: ctx.name,
        kind: 'fit',
        x: input.x,
        y: input.y,
        fitted: createDense(outcome.fitted),
        residual: createDense(outcome.residual),
        modelId: model ? model.id : 'custom',
        modelName: model ? model.id : 'custom',
        modelExpr: expression,
        params: outcome.params,
        rSquared: outcome.rSquared,
        rmse: outcome.rmse,
        iterations: outcome.iterations,
        converged: outcome.converged,
        stopReason: outcome.stopReason,
        provenance: `fit(${expression}) on ${input.name}`,
      }
    },
  },

  // ---------- 统计（stats） ----------
  {
    kind: 'stats',
    category: 'stats',
    labelKey: 'stats',
    inputKind: 'series',
    output: 'stats',
    params: [],
    run(input, _input2, _params, ctx): StatsValue {
      const result = describe(values1d(input.y))
      const rows: Array<{ key: string; value: number }> = [
        { key: 'count', value: result.count },
        { key: 'mean', value: result.mean },
        { key: 'std', value: result.std },
        { key: 'min', value: result.min },
        { key: 'max', value: result.max },
        { key: 'median', value: result.median },
        { key: 'q1', value: result.q1 },
        { key: 'q3', value: result.q3 },
        { key: 'rms', value: result.rms },
        { key: 'skew', value: result.skew },
        { key: 'kurtosis', value: result.kurtosis },
      ]
      return {
        id: ctx.id,
        name: ctx.name,
        kind: 'stats',
        sourceId: input.id,
        rows,
        provenance: `describe(${input.name})`,
      } satisfies StatsValue
    },
  },
]

const OPERATOR_MAP = new Map(OPERATORS.map((operator) => [operator.kind, operator]))

export function getOperator(kind: string): OperatorDef | undefined {
  return OPERATOR_MAP.get(kind)
}

export const OPERATOR_CATEGORIES: OperatorCategory[] = ['signal', 'math', 'spectral', 'fit', 'stats']
