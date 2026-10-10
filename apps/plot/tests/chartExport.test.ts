import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CHART_EXPORT_BACKGROUND_COLOR,
  buildChartExportFilename,
  buildChartExportOptions,
} from '../src/lib/chartExport.ts'

test('chart export options default to white png output', () => {
  const options = buildChartExportOptions({
    kind: 'line',
    title: 'Revenue Trend',
    width: 960,
    height: 540,
    now: new Date('2026-04-25T09:00:00Z'),
  })

  assert.equal(CHART_EXPORT_BACKGROUND_COLOR, '#ffffff')
  assert.equal(options.backgroundColor, '#ffffff')
  assert.deepEqual(options.image, {
    format: 'png',
    width: 960,
    height: 540,
    scale: 2,
  })
  assert.deepEqual(options.download, {
    format: 'png',
    filename: 'joplot-revenue-trend-2026-04-25',
    scale: 2,
  })
})

test('buildChartExportFilename sanitizes chart titles and falls back to chart kind', () => {
  assert.equal(
    buildChartExportFilename('Sales / Trend', 'line', new Date('2026-04-25T09:00:00Z')),
    'joplot-sales-trend-2026-04-25',
  )

  assert.equal(
    buildChartExportFilename('', 'heatmap', new Date('2026-04-25T09:00:00Z')),
    'joplot-heatmap-2026-04-25',
  )
})
