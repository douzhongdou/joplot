/**
 * 曲线拟合：Levenberg–Marquardt 非线性最小二乘 + 数值雅可比。
 *
 * 模型统一用表达式描述（复用 src/lib/expression.ts），因此内置模型和
 * 用户自定义模型走同一条路径：变量含 `x`，其余变量即待拟合参数。
 */

import { parseExpression } from '../../lib/expression.ts'
import { invertMatrix, solveLinearSystem } from './linalg.ts'
import { computeSpectrumFor } from './spectrum.ts'

export interface FitParameterEstimate {
  name: string
  value: number
  stderr: number
}

export interface FitOutcome {
  params: FitParameterEstimate[]
  fitted: Float64Array
  residual: Float64Array
  rSquared: number
  rmse: number
  iterations: number
  converged: boolean
}

export interface FitModelDef {
  id: string
  expr: string
  guess: (x: Float64Array, y: Float64Array) => Record<string, number>
}

function finiteRange(values: Float64Array): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}

function mean(values: Float64Array): number {
  let sum = 0
  let count = 0
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    sum += value
    count += 1
  }
  return count === 0 ? 0 : sum / count
}

function medianOf(values: Float64Array): number {
  const finite = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (finite.length === 0) {
    return 0
  }
  const middle = Math.floor(finite.length / 2)
  return finite.length % 2 === 0 ? (finite[middle - 1] + finite[middle]) / 2 : finite[middle]
}

function linearGuess(x: Float64Array, y: Float64Array): { a: number; b: number } {
  const n = Math.min(x.length, y.length)
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0

  for (let i = 0; i < n; i += 1) {
    sx += x[i]
    sy += y[i]
    sxx += x[i] * x[i]
    sxy += x[i] * y[i]
  }

  const denominator = n * sxx - sx * sx
  const a = denominator !== 0 ? (n * sxy - sx * sy) / denominator : 0
  return { a, b: (sy - a * sx) / n }
}

function argMax(x: Float64Array, y: Float64Array): number {
  let best = 0
  let bestValue = Number.NEGATIVE_INFINITY
  const n = Math.min(x.length, y.length)
  for (let i = 0; i < n; i += 1) {
    if (Number.isFinite(y[i]) && y[i] > bestValue) {
      bestValue = y[i]
      best = i
    }
  }
  return best
}

export const FIT_MODELS: FitModelDef[] = [
  {
    id: 'linear',
    expr: 'a*x + b',
    guess: (x, y) => linearGuess(x, y),
  },
  {
    id: 'quadratic',
    expr: 'a*x^2 + b*x + c',
    guess: (x, y) => {
      const linear = linearGuess(x, y)
      return { a: 0, b: linear.a, c: linear.b }
    },
  },
  {
    id: 'cubic',
    expr: 'a*x^3 + b*x^2 + c*x + d',
    guess: (x, y) => {
      const linear = linearGuess(x, y)
      return { a: 0, b: 0, c: linear.a, d: linear.b }
    },
  },
  {
    id: 'exponential',
    expr: 'a*exp(b*x) + c',
    guess: (x, y) => {
      const { min, max } = finiteRange(y)
      const { min: xmin, max: xmax } = finiteRange(x)
      const span = xmax - xmin || 1
      return { a: max - min || 1, b: -1 / span, c: min }
    },
  },
  {
    id: 'power',
    expr: 'a*x^b + c',
    guess: (_x, y) => {
      const { min, max } = finiteRange(y)
      return { a: max - min || 1, b: 1, c: min }
    },
  },
  {
    id: 'log',
    expr: 'a*ln(x) + b',
    guess: (_x, y) => {
      const { min, max } = finiteRange(y)
      return { a: max - min || 1, b: mean(y) }
    },
  },
  {
    id: 'logistic',
    expr: 'a/(1+exp(-b*(x-c))) + d',
    guess: (x, y) => {
      const { min, max } = finiteRange(y)
      return { a: max - min || 1, b: 1, c: medianOf(x), d: min }
    },
  },
  {
    id: 'gaussian',
    expr: 'a*exp(-((x-mu)^2)/(2*sigma^2)) + c',
    guess: (x, y) => {
      const { min, max } = finiteRange(y)
      const { min: xmin, max: xmax } = finiteRange(x)
      const span = xmax - xmin || 1
      const index = argMax(x, y)
      return { a: max - min || 1, c: min, mu: x[index] ?? 0, sigma: span / 6 || 1 }
    },
  },
  {
    id: 'lorentzian',
    expr: 'a/(1+((x-mu)/w)^2) + c',
    guess: (x, y) => {
      const { min, max } = finiteRange(y)
      const { min: xmin, max: xmax } = finiteRange(x)
      const span = xmax - xmin || 1
      const index = argMax(x, y)
      return { a: max - min || 1, c: min, mu: x[index] ?? 0, w: span / 10 || 1 }
    },
  },
  {
    id: 'damped',
    expr: 'a*exp(-b*x)*sin(c*x + d) + o',
    guess: (x, y) => {
      const { min, max } = finiteRange(y)
      const center = mean(y)
      const count = y.length

      // 用 FFT 估主频作为角频率初值，比零穿越更稳。
      const centered = new Float64Array(count)
      for (let i = 0; i < count; i += 1) {
        centered[i] = y[i] - center
      }
      const sampleRate = count > 1 ? 1 / ((x[1] - x[0]) || 1) : 1
      let dominant = 1
      try {
        const spectrum = computeSpectrumFor(centered, sampleRate, {
          window: 'hann',
          detrend: 'mean',
          segments: 1,
        })
        let bestIndex = 1
        let bestMagnitude = 0
        for (let k = 1; k < spectrum.magnitude.length; k += 1) {
          if (spectrum.magnitude[k] > bestMagnitude) {
            bestMagnitude = spectrum.magnitude[k]
            bestIndex = k
          }
        }
        dominant = spectrum.frequency[bestIndex] || 1
      } catch {
        dominant = 1
      }

      return { a: (max - min) / 2 || 1, b: 0.1, c: 2 * Math.PI * dominant, d: 0, o: center }
    },
  },
]

export interface FitOptions {
  x: Float64Array
  y: Float64Array
  expr: string
  initial?: Record<string, number>
  maxIterations?: number
  /** 拟合抽样上限：超过则先抽样拟合，再在全量上报告。 */
  maxFitPoints?: number
}

export function collectFitParameters(expr: string): string[] {
  const parsed = parseExpression(expr)
  if (!parsed.variables.includes('x')) {
    throw new Error('fit: model must use variable x')
  }
  return parsed.parameterNames
}

export function fitModel(options: FitOptions): FitOutcome {
  const { x, y } = options
  const parsed = parseExpression(options.expr)
  const parameterNames = parsed.parameterNames

  if (!parsed.variables.includes('x')) {
    throw new Error('fit: model must use variable x')
  }
  if (parameterNames.length === 0) {
    throw new Error('fit: model has no parameters')
  }

  const count = Math.min(x.length, y.length)
  const dimension = parameterNames.length

  // 大 N 时先抽样拟合，再在全量上出残差（拟合用抽样、报告用全量）。
  const maxFitPoints = options.maxFitPoints ?? 20000
  const fitCount = Math.max(dimension + 1, Math.min(count, maxFitPoints))
  let fitX = x
  let fitY = y
  if (fitCount < count) {
    fitX = new Float64Array(fitCount)
    fitY = new Float64Array(fitCount)
    const stride = (count - 1) / (fitCount - 1)
    for (let i = 0; i < fitCount; i += 1) {
      const index = Math.round(i * stride)
      fitX[i] = x[index]
      fitY[i] = y[index]
    }
  }

  const parameterBuffer = new Float64Array(dimension)
  const predictions = new Float64Array(fitCount)
  const highBuffer = new Float64Array(fitCount)
  const lowBuffer = new Float64Array(fitCount)

  const fillParameters = (values: number[]): void => {
    for (let i = 0; i < dimension; i += 1) parameterBuffer[i] = values[i]
  }

  // 批量求值：一次算完整段预测，再据此求残差 —— 全程零每点分配。
  const residuals = (values: number[]): Float64Array => {
    fillParameters(values)
    parsed.evaluateInto(fitX, null, parameterBuffer, predictions, fitCount)
    const result = new Float64Array(fitCount)
    for (let i = 0; i < fitCount; i += 1) {
      result[i] = Number.isFinite(predictions[i]) ? fitY[i] - predictions[i] : Number.NaN
    }
    return result
  }

  let parameters = parameterNames.map((name) => {
    const initial = options.initial?.[name]
    return Number.isFinite(initial) ? (initial as number) : 1
  })

  const sumSquares = (residual: Float64Array): number => {
    let sum = 0
    for (let i = 0; i < residual.length; i += 1) {
      if (!Number.isFinite(residual[i])) return Number.POSITIVE_INFINITY
      sum += residual[i] * residual[i]
    }
    return sum
  }

  const jacobian = (values: number[]): number[][] => {
    const jac: number[][] = Array.from({ length: fitCount }, () => new Array<number>(dimension).fill(0))
    for (let j = 0; j < dimension; j += 1) {
      const step = 1e-6 * Math.max(1, Math.abs(values[j]))
      const forward = values.slice()
      const backward = values.slice()
      forward[j] += step
      backward[j] -= step
      fillParameters(forward)
      parsed.evaluateInto(fitX, null, parameterBuffer, highBuffer, fitCount)
      fillParameters(backward)
      parsed.evaluateInto(fitX, null, parameterBuffer, lowBuffer, fitCount)
      for (let i = 0; i < fitCount; i += 1) {
        jac[i][j] = (highBuffer[i] - lowBuffer[i]) / (2 * step)
      }
    }
    return jac
  }

  const maxIterations = options.maxIterations ?? 200
  let lambda = 1e-3
  let sse = sumSquares(residuals(parameters))
  let iterations = 0
  let converged = false

  for (; iterations < maxIterations; iterations += 1) {
    const residual = residuals(parameters)
    const jac = jacobian(parameters)
    const normal: number[][] = Array.from({ length: dimension }, () =>
      new Array<number>(dimension).fill(0),
    )
    const gradient = new Array<number>(dimension).fill(0)

    for (let i = 0; i < fitCount; i += 1) {
      for (let a = 0; a < dimension; a += 1) {
        gradient[a] += jac[i][a] * residual[i]
        for (let b = 0; b < dimension; b += 1) {
          normal[a][b] += jac[i][a] * jac[i][b]
        }
      }
    }

    let stepAccepted = false
    let lastStep: number[] = new Array<number>(dimension).fill(0)

    for (let trial = 0; trial < 10; trial += 1) {
      const damped = normal.map((row, i) =>
        row.map((value, j) => (i === j ? value * (1 + lambda) + 1e-12 : value)),
      )
      const step = solveLinearSystem(damped, gradient)
      const candidate = parameters.map((value, i) => value + step[i])
      const candidateSse = sumSquares(residuals(candidate))

      if (Number.isFinite(candidateSse) && candidateSse < sse) {
        parameters = candidate
        sse = candidateSse
        lambda = Math.max(1e-12, lambda / 3)
        lastStep = step
        stepAccepted = true
        break
      }

      lambda *= 3
    }

    if (!stepAccepted) {
      break
    }

    const stepNorm = Math.sqrt(lastStep.reduce((sum, value) => sum + value * value, 0))
    if (stepNorm < 1e-9) {
      converged = true
      break
    }
  }

  // 报告用全量：在最终参数上对完整数据求预测、残差、R²、RMSE。
  const fullPredictions = new Float64Array(count)
  fillParameters(parameters)
  parsed.evaluateInto(x, null, parameterBuffer, fullPredictions, count)

  const residual = new Float64Array(count)
  const fitted = new Float64Array(count)
  let fullSse = 0
  for (let i = 0; i < count; i += 1) {
    if (Number.isFinite(fullPredictions[i])) {
      residual[i] = y[i] - fullPredictions[i]
      fullSse += residual[i] * residual[i]
    } else {
      residual[i] = Number.NaN
      fullSse = Number.POSITIVE_INFINITY
    }
    fitted[i] = y[i] - residual[i]
  }

  const yMean = mean(y)
  let totalSumSquares = 0
  for (let i = 0; i < count; i += 1) {
    const delta = y[i] - yMean
    totalSumSquares += delta * delta
  }
  const rSquared = totalSumSquares > 0 ? 1 - fullSse / totalSumSquares : Number.NaN

  // 参数协方差 ≈ σ² (JᵀJ)⁻¹（用抽样数据，σ² = fitSSE / (fitCount - p)）
  const standardErrors = new Array<number>(dimension).fill(Number.NaN)
  const finalJacobian = jacobian(parameters)
  const finalNormal: number[][] = Array.from({ length: dimension }, () =>
    new Array<number>(dimension).fill(0),
  )
  for (let i = 0; i < fitCount; i += 1) {
    for (let a = 0; a < dimension; a += 1) {
      for (let b = 0; b < dimension; b += 1) {
        finalNormal[a][b] += finalJacobian[i][a] * finalJacobian[i][b]
      }
    }
  }
  if (fitCount > dimension && Number.isFinite(sse)) {
    try {
      const covariance = invertMatrix(finalNormal)
      const sigmaSquared = sse / (fitCount - dimension)
      for (let i = 0; i < dimension; i += 1) {
        standardErrors[i] = Math.sqrt(Math.max(0, covariance[i][i] * sigmaSquared))
      }
    } catch {
      // 奇异：保留 NaN 标准误
    }
  }

  return {
    params: parameterNames.map((name, i) => ({
      name,
      value: parameters[i],
      stderr: standardErrors[i],
    })),
    fitted,
    residual,
    rSquared,
    rmse: Math.sqrt(fullSse / count),
    iterations,
    converged,
  }
}
