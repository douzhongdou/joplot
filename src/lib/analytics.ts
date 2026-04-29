import type { SupportedLanguage } from '../i18n/config'
import type { ChartKind, CsvData } from '../types'

export const TRACKING_LANGUAGES = ['en', 'zh', 'ja', 'unknown'] as const
export type TrackingLanguage = (typeof TRACKING_LANGUAGES)[number]

export const TRACKING_INPUT_METHODS = ['drag_drop', 'file_picker', 'paste', 'demo', 'unknown'] as const
export type TrackingInputMethod = (typeof TRACKING_INPUT_METHODS)[number]

export const TRACKING_CHART_TYPES = ['line', 'scatter', 'bar', 'stats', 'area', 'radar', 'heatmap', 'unknown'] as const
export type TrackingChartType = (typeof TRACKING_CHART_TYPES)[number]

export const PARSE_FAIL_REASONS = ['invalid_format', 'empty_file', 'too_large', 'encoding_error', 'parse_error', 'unknown'] as const
export type ParseFailReason = (typeof PARSE_FAIL_REASONS)[number]

interface DatasetLike {
  headers: string[]
  rowCount: number
}

interface FileLike {
  size?: number | null
}

function isTrackingChartType(value: string): value is TrackingChartType {
  return TRACKING_CHART_TYPES.includes(value as TrackingChartType)
}

function roundKilobytes(size: number | null | undefined) {
  if (!Number.isFinite(size) || size === undefined || size === null || size < 0) {
    return 0
  }

  return Math.round(size / 1024)
}

export function normalizeTrackingLanguage(language?: SupportedLanguage | string | null): TrackingLanguage {
  const normalized = language?.trim().toLowerCase()

  if (!normalized) {
    return 'unknown'
  }

  if (normalized.startsWith('zh')) {
    return 'zh'
  }

  if (normalized.startsWith('ja')) {
    return 'ja'
  }

  if (normalized.startsWith('en')) {
    return 'en'
  }

  return 'unknown'
}

export function mapChartKindToTrackingType(kind?: ChartKind | string | null): TrackingChartType {
  const normalized = kind?.trim().toLowerCase()

  if (!normalized) {
    return 'unknown'
  }

  return isTrackingChartType(normalized) ? normalized : 'unknown'
}

export function mapParseErrorToReason(error: unknown): ParseFailReason {
  if (
    error
    && typeof error === 'object'
    && 'reason' in error
    && typeof error.reason === 'string'
    && PARSE_FAIL_REASONS.includes(error.reason as ParseFailReason)
  ) {
    return error.reason as ParseFailReason
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase()

  if (message.includes('empty')) {
    return 'empty_file'
  }

  if (message.includes('encoding')) {
    return 'encoding_error'
  }

  if (message.includes('format') || message.includes('unsupported')) {
    return 'invalid_format'
  }

  if (message.includes('size') || message.includes('large')) {
    return 'too_large'
  }

  if (message) {
    return 'parse_error'
  }

  return 'unknown'
}

export function buildUploadCsvPayload(
  dataset: DatasetLike,
  file: FileLike,
  inputMethod: TrackingInputMethod,
) {
  return {
    rows: dataset.rowCount,
    columns: dataset.headers.length,
    file_size_kb: roundKilobytes(file.size),
    input_method: inputMethod,
  }
}

export function buildParseSuccessPayload(dataset: DatasetLike) {
  return {
    rows: dataset.rowCount,
    columns: dataset.headers.length,
  }
}

export function buildRenderChartPayload(kind: ChartKind | string, dataset: DatasetLike) {
  return {
    chart_type: mapChartKindToTrackingType(kind),
    rows: dataset.rowCount,
    columns: dataset.headers.length,
  }
}

export function buildChartTypePayload(kind: ChartKind | string) {
  return {
    chart_type: mapChartKindToTrackingType(kind),
  }
}

export function buildLanguagePayload(language: SupportedLanguage | string | null | undefined) {
  return {
    language: normalizeTrackingLanguage(language),
  }
}

export function resolvePrimaryDataset(datasetsById: Record<string, CsvData>, datasetIds: string[]) {
  for (const datasetId of datasetIds) {
    const dataset = datasetsById[datasetId]

    if (dataset) {
      return dataset
    }
  }

  return null
}
