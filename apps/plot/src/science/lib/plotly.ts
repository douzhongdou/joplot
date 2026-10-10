export interface SciencePlotlyRuntime {
  react: (
    element: HTMLDivElement,
    data: unknown[],
    layout?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<void>
  purge: (element: HTMLDivElement) => void
  restyle: (
    element: HTMLDivElement,
    update: Record<string, unknown>,
    traceIndices?: number[],
  ) => Promise<void>
  relayout: (element: HTMLDivElement, update: Record<string, unknown>) => Promise<void>
  toImage: (element: HTMLDivElement, options?: Record<string, unknown>) => Promise<string>
  downloadImage: (element: HTMLDivElement, options?: Record<string, unknown>) => Promise<void>
}

type PlotlyModule = { default: SciencePlotlyRuntime }

let runtimePromise: Promise<SciencePlotlyRuntime> | null = null

export function loadPlotly(): Promise<SciencePlotlyRuntime> {
  if (!runtimePromise) {
    runtimePromise = import('plotly.js/dist/plotly.min.js').then(
      (module) => (module as unknown as PlotlyModule).default,
    )
  }

  return runtimePromise
}
