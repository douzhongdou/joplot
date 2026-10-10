declare module 'plotly.js/dist/plotly-basic.min.js' {
  const Plotly: {
    react: (element: HTMLDivElement, data: unknown[], layout?: unknown, config?: unknown) => Promise<void>
    purge: (element: HTMLDivElement) => void
  }

  export interface Data {
    [key: string]: unknown
  }

  export interface Layout {
    [key: string]: unknown
  }

  export interface Config {
    [key: string]: unknown
  }

  export default Plotly
}

declare module 'plotly.js/dist/plotly.min.js' {
  const Plotly: {
    react: (element: HTMLDivElement, data: unknown[], layout?: unknown, config?: unknown) => Promise<void>
    purge: (element: HTMLDivElement) => void
  }

  export interface Data {
    [key: string]: unknown
  }

  export interface Layout {
    [key: string]: unknown
  }

  export interface Config {
    [key: string]: unknown
  }

  export default Plotly
}
