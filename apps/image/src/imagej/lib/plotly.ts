/**
 * 按需加载 Plotly。
 *
 * 与 apps/plot 同思路（apps 之间不共享代码，各留一份）：Plotly 体积很大，
 * 只在真的需要画图时才 `import()`，不进首屏 bundle；加载结果缓存在模块级 Promise 上，
 * 多次挂载只会请求一次。`react`/`restyle`/`relayout` 都是异步的。
 */
export interface PlotlyRuntime {
  react: (element: HTMLElement, data: unknown[], layout?: Record<string, unknown>, config?: Record<string, unknown>) => Promise<void>
  restyle: (element: HTMLElement, update: Record<string, unknown>, traces?: number[]) => Promise<void>
  relayout: (element: HTMLElement, update: Record<string, unknown>) => Promise<void>
  purge: (element: HTMLElement) => void
  Plots: { resize: (element: HTMLElement) => void }
}

type PlotlyModule = { default: PlotlyRuntime }

let runtimePromise: Promise<PlotlyRuntime> | null = null

export function loadPlotly(): Promise<PlotlyRuntime> {
  if (!runtimePromise) {
    runtimePromise = import('plotly.js/dist/plotly.min.js').then(
      (module) => (module as unknown as PlotlyModule).default,
    )
  }
  return runtimePromise
}
