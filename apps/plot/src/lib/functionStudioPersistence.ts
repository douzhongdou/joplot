import { MAX_SAMPLES, MIN_SAMPLES } from './functionPlot.ts'
import { getChartColor, isHexChartColor } from './theme.ts'

export const FUNCTION_STUDIO_STORAGE_KEY = 'function-studio-state'
export const MAX_CURVES = 12
export const DEFAULT_SAMPLES = 800

export interface FunctionParamState {
  name: string
  value: number
  min: number
  max: number
  step: number
}

export interface FunctionCurveState {
  id: string
  expression: string
  color: string
  visible: boolean
}

export interface FunctionStudioState {
  curves: FunctionCurveState[]
  xMin: number
  xMax: number
  yMin: string
  yMax: string
  samples: number
  params: FunctionParamState[]
}

export const DEFAULT_FUNCTION_STUDIO_STATE: FunctionStudioState = {
  curves: [
    { id: 'curve-sin', expression: 'sin(x)', color: getChartColor(0), visible: true },
  ],
  xMin: -10,
  xMax: 10,
  yMin: '',
  yMax: '',
  samples: DEFAULT_SAMPLES,
  params: [],
}

export function makeCurveId() {
  return `curve-${Math.random().toString(36).slice(2, 10)}`
}

function toFiniteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function sanitizeParam(raw: unknown): FunctionParamState | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as Partial<FunctionParamState>

  if (typeof candidate.name !== 'string' || !candidate.name.trim()) {
    return null
  }

  const min = toFiniteNumber(candidate.min, -5)
  let max = toFiniteNumber(candidate.max, 5)

  if (max <= min) {
    max = min + 10
  }

  const value = Math.min(Math.max(toFiniteNumber(candidate.value, 1), min), max)
  const rawStep = toFiniteNumber(candidate.step, 0.1)

  return {
    name: candidate.name,
    value,
    min,
    max,
    step: rawStep > 0 ? rawStep : 0.1,
  }
}

function sanitizeCurve(raw: unknown, index: number): FunctionCurveState | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as Partial<FunctionCurveState>

  if (typeof candidate.expression !== 'string' || !candidate.expression.trim()) {
    return null
  }

  return {
    id: typeof candidate.id === 'string' && candidate.id.trim()
      ? candidate.id
      : makeCurveId(),
    expression: candidate.expression,
    color: typeof candidate.color === 'string' && isHexChartColor(candidate.color)
      ? candidate.color.trim()
      : getChartColor(index),
    visible: candidate.visible !== false,
  }
}

export function sanitizeFunctionStudioState(raw: unknown): FunctionStudioState {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_FUNCTION_STUDIO_STATE
  }

  const candidate = raw as Partial<FunctionStudioState>
  const curves = Array.isArray(candidate.curves)
    ? candidate.curves
      .slice(0, MAX_CURVES)
      .map((curve, index) => sanitizeCurve(curve, index))
      .filter((curve): curve is FunctionCurveState => curve !== null)
    : []

  let xMin = toFiniteNumber(candidate.xMin, DEFAULT_FUNCTION_STUDIO_STATE.xMin)
  let xMax = toFiniteNumber(candidate.xMax, DEFAULT_FUNCTION_STUDIO_STATE.xMax)

  if (xMin >= xMax) {
    [xMin, xMax] = [Math.min(xMin, xMax), Math.max(xMin, xMax)]

    if (xMin === xMax) {
      xMin = DEFAULT_FUNCTION_STUDIO_STATE.xMin
      xMax = DEFAULT_FUNCTION_STUDIO_STATE.xMax
    }
  }

  const samples = Math.min(
    MAX_SAMPLES,
    Math.max(MIN_SAMPLES, Math.round(toFiniteNumber(candidate.samples, DEFAULT_SAMPLES))),
  )

  const params = Array.isArray(candidate.params)
    ? candidate.params
      .slice(0, 12)
      .map((param) => sanitizeParam(param))
      .filter((param): param is FunctionParamState => param !== null)
    : []

  return {
    curves: curves.length > 0 ? curves : DEFAULT_FUNCTION_STUDIO_STATE.curves,
    xMin,
    xMax,
    yMin: typeof candidate.yMin === 'string' ? candidate.yMin : '',
    yMax: typeof candidate.yMax === 'string' ? candidate.yMax : '',
    samples,
    params,
  }
}

export function serializeFunctionStudioState(state: FunctionStudioState) {
  return JSON.stringify({
    curves: state.curves.slice(0, MAX_CURVES).map((curve) => ({
      id: curve.id,
      expression: curve.expression,
      color: curve.color,
      visible: curve.visible,
    })),
    xMin: state.xMin,
    xMax: state.xMax,
    yMin: state.yMin,
    yMax: state.yMax,
    samples: state.samples,
    params: state.params,
  })
}

export function deserializeFunctionStudioState(serialized: string | null | undefined): FunctionStudioState {
  if (!serialized) {
    return DEFAULT_FUNCTION_STUDIO_STATE
  }

  try {
    return sanitizeFunctionStudioState(JSON.parse(serialized))
  } catch {
    return DEFAULT_FUNCTION_STUDIO_STATE
  }
}
