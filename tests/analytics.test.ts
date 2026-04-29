import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildParseSuccessPayload,
  buildRenderChartPayload,
  buildUploadCsvPayload,
  mapChartKindToTrackingType,
  mapParseErrorToReason,
  normalizeTrackingLanguage,
} from '../src/lib/analytics.ts'
import { buildDataset } from '../src/lib/workbench.ts'

test('normalizeTrackingLanguage maps route and locale values to analytics values', () => {
  assert.equal(normalizeTrackingLanguage('zh-CN'), 'zh')
  assert.equal(normalizeTrackingLanguage('en'), 'en')
  assert.equal(normalizeTrackingLanguage('ja-JP'), 'ja')
  assert.equal(normalizeTrackingLanguage('fr'), 'unknown')
  assert.equal(normalizeTrackingLanguage(undefined), 'unknown')
})

test('mapChartKindToTrackingType keeps supported chart kinds and falls back to unknown', () => {
  assert.equal(mapChartKindToTrackingType('line'), 'line')
  assert.equal(mapChartKindToTrackingType('radar'), 'radar')
  assert.equal(mapChartKindToTrackingType('heatmap'), 'heatmap')
  assert.equal(mapChartKindToTrackingType('stats'), 'stats')
  assert.equal(mapChartKindToTrackingType('pie'), 'unknown')
})

test('mapParseErrorToReason classifies known parser failures conservatively', () => {
  assert.equal(mapParseErrorToReason(new Error('empty file provided')), 'empty_file')
  assert.equal(mapParseErrorToReason(new Error('encoding issue detected')), 'encoding_error')
  assert.equal(mapParseErrorToReason(new Error('unsupported format')), 'invalid_format')
  assert.equal(mapParseErrorToReason(new Error('boom')), 'parse_error')
})

test('analytics payload builders derive rows, columns, file size and chart type', () => {
  const dataset = buildDataset(
    ['month', 'value'],
    [
      { month: 'Jan', value: '12' },
      { month: 'Feb', value: '18' },
    ],
    'demo.csv',
    'demo',
  )

  assert.deepEqual(
    buildUploadCsvPayload(dataset, { size: 1536 }, 'file_picker'),
    {
      rows: 2,
      columns: 2,
      file_size_kb: 2,
      input_method: 'file_picker',
    },
  )

  assert.deepEqual(buildParseSuccessPayload(dataset), {
    rows: 2,
    columns: 2,
  })

  assert.deepEqual(buildRenderChartPayload('heatmap', dataset), {
    chart_type: 'heatmap',
    rows: 2,
    columns: 2,
  })
})
