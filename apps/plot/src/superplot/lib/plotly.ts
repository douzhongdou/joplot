export interface SuperPlotlyRuntime {
  react: (
    element: HTMLDivElement,
    data: unknown[],
    layout?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<void>
  restyle: (
    element: HTMLDivElement,
    update: Record<string, unknown>,
    traces?: number[],
  ) => Promise<void>
  relayout: (element: HTMLDivElement, update: Record<string, unknown>) => Promise<void>
  purge: (element: HTMLDivElement) => void
  toImage: (element: HTMLDivElement, options?: Record<string, unknown>) => Promise<string>
  Plots: {
    resize: (element: HTMLDivElement) => void
  }
}

type PlotlyModule = { default: SuperPlotlyRuntime }

let runtimePromise: Promise<SuperPlotlyRuntime> | null = null

export function loadPlotly(): Promise<SuperPlotlyRuntime> {
  if (!runtimePromise) {
    runtimePromise = import('plotly.js/dist/plotly.min.js').then(
      (module) => (module as unknown as PlotlyModule).default,
    )
  }

  return runtimePromise
}
