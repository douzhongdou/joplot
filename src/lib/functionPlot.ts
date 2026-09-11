import type { RawCsvRow } from '../types'
import type { ParsedExpression } from './expression.ts'

export const PLOT_VARIABLE = 'x'
export const MIN_SAMPLES = 100
export const MAX_SAMPLES = 4000
const Y_MAGNITUDE_LIMIT = 1e6
const ASYMPTOTE_JUMP_FACTOR = 8

export interface SampledCurve {
  id: string
  expression: string
  color: string
  xs: number[]
  ys: (number | null)[]
}

export interface SampleOptions {
  xMin: number
  xMax: number
  samples: number
  params: Record<string, number>
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function isPlotOutlier(value: number) {
  return !Number.isFinite(value) || Math.abs(value) > Y_MAGNITUDE_LIMIT
}

/**
 * Breaks the polyline around vertical asymptotes: when two neighbouring points
 * swing across signs with a jump far beyond the curve's typical scale, a null
 * is inserted between them so Plotly does not draw a fake vertical line.
 * Values on both sides must also stand out from the typical scale — otherwise
 * a plain zero crossing sampled near the axis (e.g. sin at pi) would be
 * mistaken for an asymptote.
 */
function insertAsymptoteBreaks(xs: number[], ys: (number | null)[]) {
  const finiteValues = ys.filter((value): value is number => value !== null)
  const finiteScale = median(finiteValues.map(Math.abs))

  if (!Number.isFinite(finiteScale) || finiteScale <= 0) {
    return { xs, ys }
  }

  const jumpLimit = finiteScale * ASYMPTOTE_JUMP_FACTOR
  const outXs: number[] = []
  const outYs: (number | null)[] = []

  for (let index = 0; index < xs.length; index += 1) {
    outXs.push(xs[index])
    outYs.push(ys[index])

    const current = ys[index]
    const next = ys[index + 1]

    if (current === null || next === null || current === undefined || next === undefined) {
      continue
    }

    const swingsAcrossZero = current * next < 0
    const bothStandOut = Math.abs(current) > finiteScale && Math.abs(next) > finiteScale
    const jumpsWildly = Math.abs(next - current) > jumpLimit

    if (swingsAcrossZero && bothStandOut && jumpsWildly) {
      outXs.push((xs[index] + xs[index + 1]) / 2)
      outYs.push(null)
    }
  }

  return { xs: outXs, ys: outYs }
}

export function sampleCurve(
  id: string,
  expression: string,
  color: string,
  parsed: ParsedExpression,
  options: SampleOptions,
): SampledCurve {
  const { xMin, xMax, samples, params } = options
  const step = samples > 1 ? (xMax - xMin) / (samples - 1) : 0
  const xs: number[] = []
  const ys: (number | null)[] = []

  for (let index = 0; index < samples; index += 1) {
    const x = xMin + step * index
    const scope = { ...params, [PLOT_VARIABLE]: x }
    const value = parsed.evaluate(scope)

    xs.push(x)
    ys.push(isPlotOutlier(value) ? null : value)
  }

  const broken = insertAsymptoteBreaks(xs, ys)

  return { id, expression, color, xs: broken.xs, ys: broken.ys }
}

export function listFreeParameters(parsed: ParsedExpression) {
  return parsed.variables.filter((name) => name !== PLOT_VARIABLE)
}

const ADAPTIVE_CLIP_FACTOR = 10
const ADAPTIVE_OUTLIER_MAX_FRACTION = 0.035
const ADAPTIVE_PAD_RATIO = 0.05

function collectFiniteValues(curves: SampledCurve[]) {
  const values: number[] = []

  curves.forEach((curve) => {
    curve.ys.forEach((value) => {
      if (value !== null) {
        values.push(value)
      }
    })
  })

  return values
}

function percentile(sortedValues: number[], ratio: number) {
  if (sortedValues.length === 0) {
    return 0
  }

  if (sortedValues.length === 1) {
    return sortedValues[0]
  }

  const rank = ratio * (sortedValues.length - 1)
  const lowIndex = Math.floor(rank)
  const highIndex = Math.ceil(rank)

  if (lowIndex === highIndex) {
    return sortedValues[lowIndex]
  }

  return sortedValues[lowIndex] + (sortedValues[highIndex] - sortedValues[lowIndex]) * (rank - lowIndex)
}

/**
 * Derives a default y range for the sampled curves. Vertical asymptotes make
 * the raw extremes meaningless (the whole curve collapses into a flat line),
 * so when only a tiny fraction of samples sit far beyond the bulk of the data,
 * the range is clipped around that bulk. Curves that genuinely grow (exp) or
 * spend real domain at their extremes keep the honest full range.
 */
export function computeAdaptiveYRange(curves: SampledCurve[]): [number, number] | null {
  const values = collectFiniteValues(curves)

  if (values.length === 0) {
    return null
  }

  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  values.forEach((value) => {
    if (value < minY) {
      minY = value
    }

    if (value > maxY) {
      maxY = value
    }
  })

  if (minY === maxY) {
    return [minY - 1, maxY + 1]
  }

  const center = percentile([...values].sort((left, right) => left - right), 0.5)
  const deviations = values.map((value) => Math.abs(value - center)).sort((left, right) => left - right)
  const scale = percentile(deviations, 0.75)
  const clipLow = center - ADAPTIVE_CLIP_FACTOR * scale
  const clipHigh = center + ADAPTIVE_CLIP_FACTOR * scale
  const outlierCount = values.reduce((count, value) => (
    value < clipLow || value > clipHigh ? count + 1 : count
  ), 0)
  const outlierFraction = outlierCount / values.length
  const shouldClip = outlierFraction > 0 && outlierFraction <= ADAPTIVE_OUTLIER_MAX_FRACTION

  let low = shouldClip ? Math.max(minY, clipLow) : minY
  let high = shouldClip ? Math.min(maxY, clipHigh) : maxY

  if (high <= low) {
    low -= 1
    high += 1
  }

  const pad = (high - low) * ADAPTIVE_PAD_RATIO
  low -= pad
  high += pad

  if (minY >= 0) {
    low = Math.max(low, 0)
  }

  if (maxY <= 0) {
    high = Math.min(high, 0)
  }

  return high > low ? [low, high] : [low, low + 1]
}

export function formatPlotNumber(value: number) {
  if (Number.isInteger(value)) {
    return String(value)
  }

  return String(Number(value.toPrecision(10)))
}

export function sampledCurveToCsvRows(curve: SampledCurve): RawCsvRow[] {
  return curve.xs.map((x, index) => {
    const y = curve.ys[index]

    return {
      x: formatPlotNumber(x),
      y: y === null ? '' : formatPlotNumber(y),
    }
  })
}
