/**
 * 频谱计算：复用 superplot 已有的手写 FFT（窗函数 / 去趋势 / Welch）。
 *
 * 注：MVP 阶段直接复用 superplot 的 FFT 内核。待 Contract v1 抽 core 后，
 * 该内核应迁移为共享 backend，而不是让 science 依赖 superplot 的 UI 层。
 */

import { computeSpectrum, DEFAULT_SPECTRUM_OPTIONS } from '../../superplot/lib/fft.ts'
import type { DetrendMode, WindowKind } from '../../superplot/types.ts'

export interface SpectrumSettings {
  window: WindowKind
  detrend: DetrendMode
  segments: number
}

export interface SpectrumComputation {
  frequency: Float64Array
  magnitude: Float64Array
  phase: Float64Array | null
  fftSize: number
}

export function computeSpectrumFor(
  signal: Float64Array,
  sampleRate: number,
  settings: SpectrumSettings,
): SpectrumComputation {
  const result = computeSpectrum(signal, {
    ...DEFAULT_SPECTRUM_OPTIONS,
    sampleRate,
    window: settings.window,
    detrend: settings.detrend,
    segments: Math.max(1, Math.round(settings.segments)),
  })

  return {
    frequency: result.freq,
    magnitude: result.magnitude,
    phase: result.phase,
    fftSize: result.fftSize,
  }
}
