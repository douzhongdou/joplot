import type { Series, ScienceValue } from '../types.ts'
import { createDense } from './dense.ts'
import { generateSampleSignal } from './signal.ts'
import type { AnalysisStep } from './pipeline.ts'

export interface ScienceWorkspaceSeed {
  base: ScienceValue[]
  steps: AnalysisStep[]
}

/** 初始工作区：一段合成信号 + 两条示例分析步骤（平滑、FFT）。 */
export function createSampleWorkspace(): ScienceWorkspaceSeed {
  const { t, y, sampleRate } = generateSampleSignal()

  const signal: Series = {
    id: 'signal',
    name: 'signal',
    kind: 'series',
    x: createDense(t),
    y: createDense(y),
    sampleRate,
    provenance: 'generated sample signal',
  }

  const steps: AnalysisStep[] = [
    {
      id: 'step-smooth',
      op: 'smooth',
      inputId: 'signal',
      params: { method: 'savgol', window: 11, order: 3 },
      outputId: 'smooth1',
    },
    {
      id: 'step-fft',
      op: 'fft',
      inputId: 'signal',
      params: { window: 'hann', detrend: 'mean', segments: 1 },
      outputId: 'fft1',
    },
    {
      id: 'step-fit',
      op: 'fit',
      inputId: 'signal',
      params: { model: 'damped', expr: 'a*exp(-b*x)*sin(c*x + d) + o', initial: '' },
      outputId: 'fit1',
    },
  ]

  return { base: [signal], steps }
}
