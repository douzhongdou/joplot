/**
 * 频谱计算：复用 superplot 已有的手写 FFT（窗函数 / 去趋势 / Welch）。
 *
 * 注：MVP 阶段直接复用 superplot 的 FFT 内核。待 Contract v1 抽 core 后，
 * 该内核应迁移为共享 backend，而不是让 science 依赖 superplot 的 UI 层。
 */

import { computeSpectrum, DEFAULT_SPECTRUM_OPTIONS } from '../../superplot/lib/fft.ts'
import type { DetrendMode, WindowKind } from '../../superplot/types.ts'
import type { ScienceValue, SpectrumValue } from '../types.ts'
import { vectorField, vectorParentId, type VectorField } from './vectors.ts'

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

/** 频谱区要画哪个频谱、以及是否只画它的某一个字段。 */
export interface SpectrumTarget {
  spectrum: SpectrumValue
  /** null 表示选中的是频谱本身（幅度挂主轴、相位挂副轴）；否则只画该字段。 */
  field: VectorField | null
}

/**
 * 变量树里的 `fft1::phase` 是投影出来的 series，直接当普通 series 处理会把频域数据
 * 画到时域图上。这里把它还原成所属频谱 + 字段，交给频谱图去响应。
 */
export function resolveSpectrumTarget(
  values: ScienceValue[],
  selected: ScienceValue | undefined,
): SpectrumTarget | null {
  if (!selected) {
    return null
  }

  if (selected.kind === 'spectrum') {
    return { spectrum: selected, field: null }
  }

  const parentId = vectorParentId(selected.id)
  if (parentId === selected.id) {
    return null
  }

  const parent = values.find((value) => value.id === parentId)
  return parent && parent.kind === 'spectrum'
    ? { spectrum: parent, field: vectorField(selected.id) }
    : null
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
