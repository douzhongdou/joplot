import type { DownsampleMode, PointPair } from '../types.ts'

/**
 * 基于最小/最大包络的抽稀：每个像素柱保留该区间的最大值与最小值。
 * 相比等距抽样，它能完整保留尖峰/毛刺，是示波器类波形的首选抽稀方式。
 */
export function minMaxEnvelope(x: Float64Array, y: Float64Array, buckets: number): PointPair {
  const n = Math.min(x.length, y.length)

  if (n === 0) {
    return { x: new Float64Array(0), y: new Float64Array(0) }
  }

  const bucketCount = Math.max(1, Math.floor(buckets))

  if (n <= bucketCount * 2) {
    return { x: x.slice(0, n), y: y.slice(0, n) }
  }

  const outX: number[] = [x[0]]
  const outY: number[] = [y[0]]
  const size = n / bucketCount

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * size)
    const end = Math.min(n, Math.floor((bucket + 1) * size))

    if (end <= start) {
      continue
    }

    let minIndex = -1
    let maxIndex = -1
    let minValue = Number.POSITIVE_INFINITY
    let maxValue = Number.NEGATIVE_INFINITY

    for (let i = start; i < end; i += 1) {
      const value = y[i]
      if (!Number.isFinite(value)) {
        continue
      }
      if (value < minValue) {
        minValue = value
        minIndex = i
      }
      if (value > maxValue) {
        maxValue = value
        maxIndex = i
      }
    }

    if (minIndex === -1) {
      outX.push(x[start])
      outY.push(Number.NaN)
      continue
    }

    const firstIndex = Math.min(minIndex, maxIndex)
    const secondIndex = Math.max(minIndex, maxIndex)
    outX.push(x[firstIndex], x[secondIndex])
    outY.push(y[firstIndex], y[secondIndex])
  }

  outX.push(x[n - 1])
  outY.push(y[n - 1])

  const length = outX.length
  const resultX = new Float64Array(length)
  const resultY = new Float64Array(length)
  for (let i = 0; i < length; i += 1) {
    resultX[i] = outX[i]
    resultY[i] = outY[i]
  }

  return { x: resultX, y: resultY }
}

/**
 * Largest-Triangle-Three-Buckets 抽稀，适合强调趋势与形状而非极值。
 */
export function lttb(x: Float64Array, y: Float64Array, threshold: number): PointPair {
  const n = Math.min(x.length, y.length)

  if (threshold >= n || threshold < 3) {
    return { x: x.slice(0, n), y: y.slice(0, n) }
  }

  const sampledX = new Float64Array(threshold)
  const sampledY = new Float64Array(threshold)
  const every = (n - 2) / (threshold - 2)

  sampledX[0] = x[0]
  sampledY[0] = y[0]

  let a = 0

  for (let i = 0; i < threshold - 2; i += 1) {
    const rangeStart = Math.floor((i + 1) * every) + 1
    const rangeEnd = Math.min(Math.floor((i + 2) * every) + 1, n)

    let avgX = 0
    let avgY = 0
    let avgCount = rangeEnd - rangeStart

    for (let j = rangeStart; j < rangeEnd; j += 1) {
      avgX += x[j]
      avgY += y[j]
    }

    if (avgCount <= 0) {
      avgCount = 1
    }
    avgX /= avgCount
    avgY /= avgCount

    const pointAStart = Math.floor((a + 0) * every) + 1
    const pointAEnd = Math.floor((a + 1) * every) + 1
    let pointAX = 0
    let pointAY = 0
    let pointACount = pointAEnd - pointAStart

    for (let j = pointAStart; j < pointAEnd && j < n; j += 1) {
      pointAX += x[j]
      pointAY += y[j]
    }

    if (pointACount <= 0) {
      pointACount = 1
    }
    pointAX /= pointACount
    pointAY /= pointACount

    let maxArea = -1
    let nextA = rangeStart

    for (let j = rangeStart; j < rangeEnd; j += 1) {
      const area = Math.abs(
        (pointAX - avgX) * (y[j] - pointAY)
        - (pointAX - x[j]) * (avgY - pointAY),
      )

      if (area > maxArea) {
        maxArea = area
        nextA = j
      }
    }

    sampledX[i + 1] = x[nextA]
    sampledY[i + 1] = y[nextA]
    a = nextA
  }

  sampledX[threshold - 1] = x[n - 1]
  sampledY[threshold - 1] = y[n - 1]

  return { x: sampledX, y: sampledY }
}

export function sliceByRange(
  x: Float64Array,
  y: Float64Array,
  min: number,
  max: number,
): PointPair {
  const n = Math.min(x.length, y.length)

  if (n === 0 || !(max > min)) {
    return { x: x.slice(0, n), y: y.slice(0, n) }
  }

  let low = 0
  let high = n

  while (low < high) {
    const mid = (low + high) >> 1
    if (x[mid] < min) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  const start = low

  low = start
  high = n
  while (low < high) {
    const mid = (low + high) >> 1
    if (x[mid] <= max) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  const end = low

  return { x: x.slice(start, end), y: y.slice(start, end) }
}

export function downsamplePoints(
  x: Float64Array,
  y: Float64Array,
  mode: DownsampleMode,
  target: number,
  range?: { min: number; max: number },
): PointPair {
  const sliced = range ? sliceByRange(x, y, range.min, range.max) : { x, y }
  const n = Math.min(sliced.x.length, sliced.y.length)

  if (mode === 'none' || n <= target) {
    return { x: sliced.x.slice(0, n), y: sliced.y.slice(0, n) }
  }

  if (mode === 'lttb') {
    return lttb(sliced.x, sliced.y, target)
  }

  return minMaxEnvelope(sliced.x, sliced.y, Math.max(1, Math.ceil(target / 2)))
}
