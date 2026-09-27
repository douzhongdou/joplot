/**
 * 描述统计。均值用 Kahan 补偿求和，方差/偏度/峰度用二遍法，
 * 保证数值稳定（对应 Contract R4）。
 */

export interface DescribeResult {
  count: number
  min: number
  max: number
  mean: number
  std: number
  median: number
  q1: number
  q3: number
  rms: number
  skew: number
  kurtosis: number
}

function kahanSum(values: readonly number[]): number {
  let sum = 0
  let compensation = 0

  for (const value of values) {
    const adjusted = value - compensation
    const next = sum + adjusted
    compensation = (next - sum) - adjusted
    sum = next
  }

  return sum
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) {
    return Number.NaN
  }

  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)

  if (lower === upper) {
    return sorted[lower]
  }

  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

export function describe(values: Float64Array): DescribeResult {
  const finite: number[] = []
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sumSquares = 0

  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue
    }
    finite.push(value)
    if (value < min) min = value
    if (value > max) max = value
    sumSquares += value * value
  }

  const count = finite.length
  if (count === 0) {
    return {
      count: 0,
      min: Number.NaN,
      max: Number.NaN,
      mean: Number.NaN,
      std: Number.NaN,
      median: Number.NaN,
      q1: Number.NaN,
      q3: Number.NaN,
      rms: Number.NaN,
      skew: Number.NaN,
      kurtosis: Number.NaN,
    }
  }

  const mean = kahanSum(finite) / count
  let m2 = 0
  let m3 = 0
  let m4 = 0

  for (const value of finite) {
    const delta = value - mean
    const delta2 = delta * delta
    m2 += delta2
    m3 += delta2 * delta
    m4 += delta2 * delta2
  }

  m2 /= count
  m3 /= count
  m4 /= count

  const std = Math.sqrt(m2)
  const sorted = [...finite].sort((left, right) => left - right)

  return {
    count,
    min,
    max,
    mean,
    std,
    median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    rms: Math.sqrt(sumSquares / count),
    skew: std > 0 ? m3 / std ** 3 : Number.NaN,
    kurtosis: std > 0 ? m4 / (m2 * m2) - 3 : Number.NaN,
  }
}
