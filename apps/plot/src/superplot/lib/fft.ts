import type {
  DetrendMode,
  SpectrumOptions,
  SpectrumPeak,
  SpectrumResult,
  WindowKind,
} from '../types.ts'

export const DEFAULT_SPECTRUM_OPTIONS: SpectrumOptions = {
  sampleRate: 1,
  window: 'hann',
  detrend: 'mean',
  fftSize: 0,
  segments: 1,
  overlap: 0.5,
  normalize: true,
}

export const WINDOW_KINDS: WindowKind[] = ['hann', 'hamming', 'blackman', 'flattop', 'rectangular']
export const DETREND_MODES: DetrendMode[] = ['none', 'mean', 'linear']

export function nextPowerOfTwo(value: number): number {
  if (!Number.isFinite(value) || value <= 1) {
    return 1
  }

  return 2 ** Math.ceil(Math.log2(value))
}

export function previousPowerOfTwo(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1
  }

  return 2 ** Math.floor(Math.log2(value))
}

/**
 * 就地迭代式基 2 Cooley-Tukey FFT。`re` 与 `im` 长度必须相等且为 2 的幂。
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length

  if (n !== im.length || n === 0) {
    throw new Error('fft: re/im must share the same non-zero length')
  }

  if ((n & (n - 1)) !== 0) {
    throw new Error('fft: length must be a power of two')
  }

  // 位反序置换
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) {
      j ^= bit
    }
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }

  // 蝶形运算
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)

    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0

      for (let k = 0; k < len / 2; k += 1) {
        const evenIndex = i + k
        const oddIndex = evenIndex + len / 2
        const oddRe = re[oddIndex] * curRe - im[oddIndex] * curIm
        const oddIm = re[oddIndex] * curIm + im[oddIndex] * curRe

        re[oddIndex] = re[evenIndex] - oddRe
        im[oddIndex] = im[evenIndex] - oddIm
        re[evenIndex] += oddRe
        im[evenIndex] += oddIm

        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

/**
 * 生成窗函数系数。返回长度为 n 的数组，中心对称。
 */
export function buildWindow(kind: WindowKind, n: number): Float64Array {
  const coefficients = new Float64Array(n)

  if (n <= 1) {
    if (n === 1) {
      coefficients[0] = 1
    }
    return coefficients
  }

  const denom = n - 1
  const twoPi = 2 * Math.PI

  for (let i = 0; i < n; i += 1) {
    const ratio = i / denom

    switch (kind) {
      case 'hann':
        coefficients[i] = 0.5 - 0.5 * Math.cos(twoPi * ratio)
        break
      case 'hamming':
        coefficients[i] = 0.54 - 0.46 * Math.cos(twoPi * ratio)
        break
      case 'blackman':
        coefficients[i] = 0.42
          - 0.5 * Math.cos(twoPi * ratio)
          + 0.08 * Math.cos(2 * twoPi * ratio)
        break
      case 'flattop':
        coefficients[i] = 0.21557895
          - 0.41663158 * Math.cos(twoPi * ratio)
          + 0.277263158 * Math.cos(2 * twoPi * ratio)
          - 0.083578947 * Math.cos(3 * twoPi * ratio)
          + 0.006947368 * Math.cos(4 * twoPi * ratio)
        break
      case 'rectangular':
      default:
        coefficients[i] = 1
        break
    }
  }

  return coefficients
}

export function coherentGain(window: Float64Array): number {
  if (window.length === 0) {
    return 0
  }

  let sum = 0
  for (let i = 0; i < window.length; i += 1) {
    sum += window[i]
  }

  return sum / window.length
}

interface DetrendResult {
  mean: number
  slope: number
}

/** 就地去除均值与线性趋势。 */
export function detrend(values: Float64Array, mode: DetrendMode): DetrendResult {
  const n = values.length

  if (n === 0 || mode === 'none') {
    return { mean: 0, slope: 0 }
  }

  let sum = 0
  for (let i = 0; i < n; i += 1) {
    sum += values[i]
  }
  const mean = sum / n

  if (mode === 'mean') {
    for (let i = 0; i < n; i += 1) {
      values[i] -= mean
    }
    return { mean, slope: 0 }
  }

  // 最小二乘线性拟合，x 取 [0, n-1]
  let sumX = 0
  let sumXY = 0
  for (let i = 0; i < n; i += 1) {
    sumX += i
    sumXY += i * values[i]
  }

  const meanX = sumX / n
  const meanY = mean
  let numerator = 0
  let denominator = 0
  for (let i = 0; i < n; i += 1) {
    const dx = i - meanX
    numerator += dx * (values[i] - meanY)
    denominator += dx * dx
  }

  const slope = denominator === 0 ? 0 : numerator / denominator
  const intercept = meanY - slope * meanX

  for (let i = 0; i < n; i += 1) {
    values[i] -= intercept + slope * i
  }

  return { mean, slope }
}

function resolveSegmentPlan(sampleCount: number, options: SpectrumOptions) {
  const segments = Math.max(1, Math.floor(options.segments || 1))
  const overlap = Math.min(0.9, Math.max(0, options.overlap))
  const requestedFftSize = options.fftSize > 0 ? nextPowerOfTwo(Math.max(2, options.fftSize)) : 0

  if (segments === 1) {
    const segmentLength = requestedFftSize > 0
      ? Math.min(sampleCount, requestedFftSize)
      : sampleCount
    const fftSize = requestedFftSize > 0 ? requestedFftSize : nextPowerOfTwo(Math.max(2, segmentLength))
    return { segmentLength, fftSize, segmentCount: 1, stride: segmentLength }
  }

  let segmentLength: number
  if (requestedFftSize > 0) {
    segmentLength = Math.min(sampleCount, requestedFftSize)
  } else {
    // 让 L·(1+(k-1)(1-overlap)) <= N，向下取 2 的幂，保证段数真正生效。
    const target = sampleCount / (1 + (segments - 1) * (1 - overlap))
    segmentLength = Math.min(sampleCount, Math.max(2, previousPowerOfTwo(Math.floor(target))))
  }

  const stride = Math.max(1, Math.floor(segmentLength * (1 - overlap)))
  const fitted = segmentLength >= sampleCount
    ? 1
    : Math.floor((sampleCount - segmentLength) / stride) + 1
  const segmentCount = Math.min(segments, Math.max(1, fitted))

  return {
    segmentLength,
    fftSize: nextPowerOfTwo(segmentLength),
    segmentCount,
    stride,
  }
}

/**
 * 计算单边幅度谱。默认单次 FFT；`segments > 1` 时按 Welch 法对功率谱做平均。
 */
export function computeSpectrum(signal: Float64Array, options: SpectrumOptions): SpectrumResult {
  const merged: SpectrumOptions = { ...DEFAULT_SPECTRUM_OPTIONS, ...options }
  const sampleCount = signal.length

  if (sampleCount === 0) {
    return {
      freq: new Float64Array(0),
      magnitude: new Float64Array(0),
      phase: new Float64Array(0),
      fftSize: 0,
      segmentLength: 0,
      segmentCount: 0,
      binWidth: 0,
      coherentGain: 0,
      removedMean: 0,
      removedSlope: 0,
    }
  }

  const { segmentLength, fftSize, segmentCount, stride } = resolveSegmentPlan(sampleCount, merged)
  const half = fftSize / 2
  const binCount = half + 1
  const window = buildWindow(merged.window, segmentLength)
  const windowGain = coherentGain(window)
  // 单边幅度归一化：A = 2·|X| / Σw（Σw = 相干增益 × 段长）。
  const amplitudeScale = merged.normalize && windowGain > 0 ? 1 / (windowGain * segmentLength) : 1

  const power = new Float64Array(binCount)
  const phase = segmentCount === 1 ? new Float64Array(binCount) : null
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  let removedMean = 0
  let removedSlope = 0

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const offset = Math.min(segment * stride, Math.max(0, sampleCount - segmentLength))

    for (let i = 0; i < segmentLength; i += 1) {
      re[i] = signal[offset + i]
      im[i] = 0
    }
    for (let i = segmentLength; i < fftSize; i += 1) {
      re[i] = 0
      im[i] = 0
    }

    const trend = detrend(re.subarray(0, segmentLength), merged.detrend)
    if (segment === 0) {
      removedMean = trend.mean
      removedSlope = trend.slope
    }

    for (let i = 0; i < segmentLength; i += 1) {
      re[i] *= window[i]
    }

    fft(re, im)

    for (let k = 0; k <= half; k += 1) {
      const magnitude = Math.hypot(re[k], im[k])
      if (phase) phase[k] = magnitude === 0 ? Number.NaN : Math.atan2(im[k], re[k])
      const isEdge = k === 0 || k === half
      const folded = isEdge ? magnitude : magnitude * 2
      const amplitude = folded * amplitudeScale
      power[k] += amplitude * amplitude
    }
  }

  const binWidth = merged.sampleRate > 0 ? merged.sampleRate / fftSize : 0
  const magnitude = new Float64Array(binCount)
  const freq = new Float64Array(binCount)
  const inverseSegments = 1 / segmentCount

  for (let k = 0; k < binCount; k += 1) {
    magnitude[k] = Math.sqrt(power[k] * inverseSegments)
    freq[k] = k * binWidth
  }

  return {
    freq,
    magnitude,
    phase,
    fftSize,
    segmentLength,
    segmentCount,
    binWidth,
    coherentGain: windowGain,
    removedMean,
    removedSlope,
  }
}

/**
 * 找出谱线中若干个局部极大值。相对峰值以 dB 表示（0 dB = 最大峰）。
 */
export function findSpectrumPeaks(
  freq: Float64Array,
  magnitude: Float64Array,
  count = 5,
  options: {
    minFrequency?: number
    maxFrequency?: number
    minSeparationBins?: number
  } = {},
): SpectrumPeak[] {
  const bins = Math.min(freq.length, magnitude.length)

  if (bins < 3 || count <= 0) {
    return []
  }

  const minFrequency = options.minFrequency ?? 0
  const maxFrequency = options.maxFrequency ?? Number.POSITIVE_INFINITY
  const minSeparation = Math.max(1, options.minSeparationBins ?? 2)
  let globalMax = 0

  for (let k = 1; k < bins - 1; k += 1) {
    if (magnitude[k] > globalMax && freq[k] >= minFrequency && freq[k] <= maxFrequency) {
      globalMax = magnitude[k]
    }
  }

  if (globalMax <= 0) {
    return []
  }

  const candidates: SpectrumPeak[] = []
  for (let k = 1; k < bins - 1; k += 1) {
    if (freq[k] < minFrequency || freq[k] > maxFrequency) {
      continue
    }
    if (magnitude[k] >= magnitude[k - 1] && magnitude[k] > magnitude[k + 1]) {
      candidates.push({
        frequency: freq[k],
        magnitude: magnitude[k],
        relativeDb: 20 * Math.log10(Math.max(magnitude[k], Number.MIN_VALUE) / globalMax),
      })
    }
  }

  candidates.sort((left, right) => right.magnitude - left.magnitude)

  const selected: SpectrumPeak[] = []
  for (const candidate of candidates) {
    if (selected.length >= count) {
      break
    }
    const tooClose = selected.some((peak) => Math.abs(peak.frequency - candidate.frequency) < minSeparation * (freq[1] - freq[0] || 1))
    if (!tooClose) {
      selected.push(candidate)
    }
  }

  return selected.sort((left, right) => left.frequency - right.frequency)
}

export function magnitudeToDb(magnitude: Float64Array, floorDb = -180): Float64Array {
  const result = new Float64Array(magnitude.length)
  let peak = 0

  for (let i = 0; i < magnitude.length; i += 1) {
    if (magnitude[i] > peak) {
      peak = magnitude[i]
    }
  }

  const reference = peak > 0 ? peak : 1
  for (let i = 0; i < magnitude.length; i += 1) {
    const ratio = magnitude[i] <= 0 ? 0 : magnitude[i] / reference
    result[i] = ratio > 0 ? Math.max(floorDb, 20 * Math.log10(ratio)) : floorDb
  }

  return result
}
