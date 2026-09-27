export interface SciencePlotlyRuntime {
  react: (
    element: HTMLDivElement,
    data: unknown[],
    layout?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<void>
  purge: (element: HTMLDivElement) => void
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
