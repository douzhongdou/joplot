import type { ChartKind } from '../types'

export const CHART_EXPORT_BACKGROUND_COLOR = '#ffffff'

function slugifySegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function formatDatePart(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function buildChartExportFilename(title: string, kind: ChartKind, now: Date = new Date()) {
  const slug = slugifySegment(title) || slugifySegment(kind) || 'chart'
  return `joplot-${slug}-${formatDatePart(now)}`
}

export function buildChartExportOptions({
  kind,
  title,
  width,
  height,
  now = new Date(),
}: {
  kind: ChartKind
  title: string
  width?: number
  height?: number
  now?: Date
}) {
  return {
    backgroundColor: CHART_EXPORT_BACKGROUND_COLOR,
    image: {
      format: 'png',
      width,
      height,
      scale: 2,
    },
    download: {
      format: 'png',
      filename: buildChartExportFilename(title, kind, now),
      scale: 2,
    },
  }
}
