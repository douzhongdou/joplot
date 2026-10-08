/**
 * Plotly 的 dist 包不带类型声明，这里按我们实际用到的 API 精确声明。
 *
 * apps 之间不共享代码，所以与 apps/plot/src/plotly.d.ts 各自保留一份；
 * 这份多声明了 restyle/relayout/Plots.resize，因为直方图做增量更新和跟随容器尺寸要用。
 */
declare module 'plotly.js/dist/plotly.min.js' {
  const Plotly: {
    react: (
      element: HTMLElement,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ) => Promise<void>
    restyle: (element: HTMLElement, update: Record<string, unknown>, traces?: number[]) => Promise<void>
    relayout: (element: HTMLElement, update: Record<string, unknown>) => Promise<void>
    purge: (element: HTMLElement) => void
    Plots: { resize: (element: HTMLElement) => void }
  }

  export default Plotly
}
