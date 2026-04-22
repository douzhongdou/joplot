import test from 'node:test'
import assert from 'node:assert/strict'

import {
  appendCardSeries,
  appendCardWithLayout,
  applyFilters,
  buildDataset,
  buildFilteredRowsByDataset,
  createDefaultCard,
  moveCardToLayout,
  sampleRows,
  summarizeNumericColumn,
} from '../src/lib/workbench.ts'
import {
  buildAutorangeUpdate,
  buildPlotLayout,
} from '../src/lib/plotViewport.ts'
import { copyPngDataUrlToClipboard } from '../src/lib/clipboard.ts'
import type { ChartCard } from '../src/types.ts'

function createDataset() {
  return buildDataset(
    ['time', 'value', 'status', 'score'],
    [
      { time: '2026-01-01', value: '10', status: 'ok', score: '1' },
      { time: '2026-01-02', value: 'oops', status: 'warn', score: '3' },
      { time: '2026-01-03', value: '30', status: 'ok', score: '' },
      { time: '2026-01-04', value: '', status: 'error', score: '9' },
    ],
    'primary.csv',
  )
}

function createSecondaryDataset() {
  return buildDataset(
    ['time', 'temperature', 'status'],
    [
      { time: '2026-01-01', temperature: '21', status: 'ok' },
      { time: '2026-01-02', temperature: '24', status: 'ok' },
      { time: '2026-01-03', temperature: '20', status: 'hold' },
    ],
    'secondary.csv',
  )
}

function createIncompatibleDataset() {
  return buildDataset(
    ['batch', 'temperature'],
    [
      { batch: 'A', temperature: '18' },
      { batch: 'B', temperature: '22' },
    ],
    'batch.csv',
  )
}

test('buildDataset treats invalid numeric values as null and keeps numeric columns usable', () => {
  const dataset = createDataset()

  assert.deepEqual(dataset.numericColumns, ['value', 'score'])
  assert.equal(dataset.rows[1].numeric.value, null)
  assert.equal(dataset.rows[3].numeric.value, null)
  assert.equal(dataset.rows[2].numeric.score, null)
})

test('createDefaultCard uses first column as x and creates a default series from the first compatible numeric column', () => {
  const fallbackDataset = buildDataset(
    ['date', 'label', 'amount'],
    [
      { date: '2026-01-01', label: 'A', amount: '10' },
      { date: '2026-01-02', label: 'B', amount: '12' },
    ],
    'fallback.csv',
  )

  const defaultCard = createDefaultCard(fallbackDataset)

  assert.equal(defaultCard.kind, 'line')
  assert.equal(defaultCard.xColumn, 'date')
  assert.equal(defaultCard.series.length, 1)
  assert.equal(defaultCard.series[0].datasetId, fallbackDataset.id)
  assert.equal(defaultCard.series[0].yColumn, 'amount')
  assert.deepEqual(defaultCard.layout, { x: 0, y: 0, w: 12, h: 8 })
})

test('appendCardSeries adds a compatible dataset as a new series on the same chart', () => {
  const primary = createDataset()
  const secondary = createSecondaryDataset()
  const defaultCard = createDefaultCard(primary)

  const nextCard = appendCardSeries(defaultCard, secondary)

  assert.equal(nextCard.series.length, 2)
  assert.equal(nextCard.series[1].datasetId, secondary.id)
  assert.equal(nextCard.series[1].yColumn, 'temperature')
})

test('appendCardSeries ignores datasets that do not have the current x column', () => {
  const primary = createDataset()
  const incompatible = createIncompatibleDataset()
  const defaultCard = createDefaultCard(primary)

  const nextCard = appendCardSeries(defaultCard, incompatible)

  assert.equal(nextCard.series.length, 1)
  assert.deepEqual(nextCard, defaultCard)
})

test('buildFilteredRowsByDataset applies each dataset filter set independently', () => {
  const primary = createDataset()
  const secondary = createSecondaryDataset()

  const filtered = buildFilteredRowsByDataset([primary, secondary], {
    [primary.id]: [{ id: '1', column: 'status', operator: 'contains', value: 'ok' }],
    [secondary.id]: [{ id: '2', column: 'temperature', operator: 'gt', value: '21' }],
  })

  assert.equal(filtered[primary.id].length, 2)
  assert.equal(filtered[secondary.id].length, 1)
  assert.equal(filtered[secondary.id][0].raw.time, '2026-01-02')
})

test('applyFilters supports text contains and numeric greater-than together', () => {
  const dataset = createDataset()

  const filtered = applyFilters(dataset.rows, [
    { id: '1', column: 'status', operator: 'contains', value: 'ok' },
    { id: '2', column: 'score', operator: 'gt', value: '0' },
  ])

  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].raw.time, '2026-01-01')
})

test('summarizeNumericColumn ignores null values', () => {
  const dataset = createDataset()

  const summary = summarizeNumericColumn(dataset.rows, 'value')

  assert.equal(summary.count, 2)
  assert.equal(summary.missing, 2)
  assert.equal(summary.min, 10)
  assert.equal(summary.max, 30)
  assert.equal(summary.mean, 20)
  assert.equal(summary.median, 20)
})

test('sampleRows keeps first and last row when downsampling', () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    raw: { x: String(index), y: String(index) },
    numeric: { x: index, y: index },
  }))

  const sampled = sampleRows(rows, 4)

  assert.equal(sampled.length, 4)
  assert.equal(sampled[0].raw.x, '0')
  assert.equal(sampled[sampled.length - 1].raw.x, '9')
})

test('appendCardWithLayout assigns dashboard-friendly default placements', () => {
  const dataset = createDataset()

  const first = appendCardWithLayout([], createDefaultCard(dataset))
  const second = appendCardWithLayout(first, {
    ...createDefaultCard(dataset),
    id: 'card-2',
    kind: 'scatter',
  })
  const third = appendCardWithLayout(second, {
    ...createDefaultCard(dataset),
    id: 'card-3',
    kind: 'bar',
  })

  assert.deepEqual(first[0].layout, { x: 0, y: 0, w: 12, h: 8 })
  assert.deepEqual(third[1].layout, { x: 0, y: 8, w: 6, h: 7 })
  assert.deepEqual(third[2].layout, { x: 6, y: 8, w: 6, h: 7 })
})

test('moveCardToLayout keeps the moved card in place and pushes overlaps downward', () => {
  const dataset = createDataset()
  const cards = appendCardWithLayout(
    appendCardWithLayout(
      appendCardWithLayout([], createDefaultCard(dataset)),
      { ...createDefaultCard(dataset), id: 'card-2', kind: 'scatter' },
    ),
    { ...createDefaultCard(dataset), id: 'card-3', kind: 'bar' },
  )

  const moved = moveCardToLayout(cards, 'card-3', { x: 0, y: 0, w: 6, h: 6 })
  const movedCard = moved.find((card) => card.id === 'card-3')

  assert.deepEqual(movedCard?.layout, { x: 0, y: 0, w: 6, h: 6 })

  for (let index = 0; index < moved.length; index += 1) {
    for (let inner = index + 1; inner < moved.length; inner += 1) {
      assert.equal(
        layoutsOverlap(moved[index], moved[inner]),
        false,
        `cards ${moved[index].id} and ${moved[inner].id} should not overlap`,
      )
    }
  }
})

test('buildAutorangeUpdate resets both axes to autorange', () => {
  assert.deepEqual(
    buildAutorangeUpdate(),
    {
      'xaxis.autorange': true,
      'yaxis.autorange': true,
    },
  )
})

test('buildPlotLayout adds stable uirevision so rerenders keep user viewport', () => {
  assert.deepEqual(
    buildPlotLayout({ hovermode: 'x unified' }, 'card-1'),
    {
      hovermode: 'x unified',
      uirevision: 'card-1',
    },
  )
})

test('copyPngDataUrlToClipboard falls back to html clipboard payload when png write fails', async () => {
  const writeCalls: unknown[][] = []
  const clipboard = {
    async write(items: unknown[]) {
      writeCalls.push(items)

      if (writeCalls.length === 1) {
        throw new Error('image clipboard blocked')
      }
    },
  }

  class FakeClipboardItem {
    readonly items: Record<string, Blob>

    constructor(items: Record<string, Blob>) {
      this.items = items
    }
  }

  const mode = await copyPngDataUrlToClipboard({
    blob: new Blob(['png-bytes'], { type: 'image/png' }),
    dataUrl: 'data:image/png;base64,AAAA',
    clipboard,
    ClipboardItemCtor: FakeClipboardItem,
  })

  assert.equal(mode, 'html')
  assert.equal(writeCalls.length, 2)
  assert.deepEqual(
    Object.keys((writeCalls[1][0] as FakeClipboardItem).items),
    ['text/html', 'text/plain'],
  )
})

test('copyPngDataUrlToClipboard falls back to text when ClipboardItem is unavailable', async () => {
  let copiedText = ''
  const clipboard = {
    async writeText(value: string) {
      copiedText = value
    },
  }

  const mode = await copyPngDataUrlToClipboard({
    blob: new Blob(['png-bytes'], { type: 'image/png' }),
    dataUrl: 'data:image/png;base64,BBBB',
    clipboard,
    ClipboardItemCtor: null,
  })

  assert.equal(mode, 'text')
  assert.equal(copiedText, 'data:image/png;base64,BBBB')
})

function layoutsOverlap(left: ChartCard, right: ChartCard) {
  return (
    left.layout.x < right.layout.x + right.layout.w
    && left.layout.x + left.layout.w > right.layout.x
    && left.layout.y < right.layout.y + right.layout.h
    && left.layout.y + left.layout.h > right.layout.y
  )
}
