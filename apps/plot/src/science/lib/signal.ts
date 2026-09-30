/** 生成一段合成的示例信号：阻尼振荡 + 干扰正弦 + 线性漂移 + 噪声。 */

export interface SampleSignal {
  t: Float64Array
  y: Float64Array
  sampleRate: number
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function generateSampleSignal(): SampleSignal {
  const sampleRate = 128
  const duration = 10
  const count = sampleRate * duration + 1
  const t = new Float64Array(count)
  const y = new Float64Array(count)
  const random = mulberry32(20260927)

  for (let i = 0; i < count; i += 1) {
    const time = i / sampleRate
    const damped = 2.4 * Math.exp(-0.5 * time) * Math.sin(2 * Math.PI * 3.2 * time)
    const tone = 0.22 * Math.sin(2 * Math.PI * 15 * time)
    const ripple = 0.12 * Math.sin(2 * Math.PI * 41 * time)
    const drift = 0.05 * time
    const noise = (random() - 0.5) * 0.16
    t[i] = time
    y[i] = damped + tone + ripple + drift + noise
  }

  return { t, y, sampleRate }
}
