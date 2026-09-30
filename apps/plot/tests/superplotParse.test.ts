import test from 'node:test'
import assert from 'node:assert/strict'

import {
  detectDelimiter,
  inferTimeColumn,
  parseDelimitedText,
  splitDelimitedLine,
  toFiniteNumber,
} from '../src/superplot/lib/parse.ts'
import { extractSeriesWindow, computeSeriesStats, getNumericColumn } from '../src/superplot/lib/columns.ts'

const SCOPE_CSV = [
  'time_s,voltage_V,region',
  '-2.000000000000e-08,-1.000000000000e-03,north',
  '0.000000000000e+00,2.000000000000e-03,north',
  '2.000000000000e-08,5.000000000000e-03,south',
  '4.000000000000e-08,,south',
  '6.000000000000e-08,-4.000000000000e-03,north',
].join('\n')

test('detectDelimiter picks the most frequent separator', () => {
  assert.equal(detectDelimiter('a,b,c'), ',')
  assert.equal(detectDelimiter('a\tb\tc'), '\t')
  assert.equal(detectDelimiter('a;b;c;d'), ';')
})

test('splitDelimitedLine understands quoted fields', () => {
  assert.deepEqual(splitDelimitedLine('a,"b,c",d', ','), ['a', 'b,c', 'd'])
  assert.deepEqual(splitDelimitedLine('a,"he said ""hi""",c', ','), ['a', 'he said "hi"', 'c'])
})

test('toFiniteNumber rejects blanks and non-numeric text', () => {
  assert.equal(toFiniteNumber('1.5'), 1.5)
  assert.ok(Number.isNaN(toFiniteNumber('')))
  assert.ok(Number.isNaN(toFiniteNumber('   ')))
  assert.ok(Number.isNaN(toFiniteNumber('abc')))
})

test('parseDelimitedText builds columnar typed arrays', () => {
  const dataset = parseDelimitedText(SCOPE_CSV, { id: 'scope', fileName: 'scope.csv', fileSize: 123 })

  assert.deepEqual(dataset.headers, ['time_s', 'voltage_V', 'region'])
  assert.equal(dataset.rowCount, 5)
  assert.deepEqual(dataset.numericColumns, ['time_s', 'voltage_V'])
  assert.equal(dataset.fileSize, 123)

  const time = getNumericColumn(dataset, 'time_s')
  const voltage = getNumericColumn(dataset, 'voltage_V')
  assert.ok(time && voltage)
  assert.equal(time.values.length, 5)
  assert.ok(Math.abs(time.values[1] - 0) < 1e-15)
  assert.equal(voltage.missingCount, 1)
  assert.equal(voltage.validCount, 4)
  assert.ok(Number.isNaN(voltage.values[3]))

  const region = dataset.columns.find((column) => column.name === 'region')
  assert.ok(region && region.kind === 'string')
  assert.deepEqual(region.values, ['north', 'north', 'south', 'south', 'north'])
})

test('parseDelimitedText infers the time column and sample rate', () => {
  const dataset = parseDelimitedText(SCOPE_CSV, { id: 'scope', fileName: 'scope.csv' })
  assert.equal(dataset.timeColumn, 'time_s')
  assert.ok(dataset.sampleRate !== null)
  assert.ok(Math.abs(dataset.sampleRate! - 5e7) < 1)
})

test('parseDelimitedText tolerates CRLF line endings and trailing newlines', () => {
  const dataset = parseDelimitedText(SCOPE_CSV.replace(/\n/g, '\r\n') + '\r\n', { id: 'scope', fileName: 'scope.csv' })
  assert.equal(dataset.rowCount, 5)
  assert.equal(dataset.headers.length, 3)
})

test('parseDelimitedText handles a header-only file', () => {
  const dataset = parseDelimitedText('a,b\n', { id: 'empty', fileName: 'empty.csv' })
  assert.equal(dataset.rowCount, 0)
  assert.deepEqual(dataset.headers, ['a', 'b'])
})

test('inferTimeColumn returns null when there is no monotonic axis', () => {
  const inference = inferTimeColumn(
    [
      { name: 'a', kind: 'number', values: new Float64Array([1, 0, 1, 0]), missing: null, validCount: 4, missingCount: 0, min: 0, max: 1, mean: 0.5 },
    ],
    4,
  )
  assert.equal(inference.timeColumn, null)
})

test('extractSeriesWindow slices typed arrays without copying the whole column', () => {
  const dataset = parseDelimitedText(SCOPE_CSV, { id: 'scope', fileName: 'scope.csv' })
  const window = extractSeriesWindow(dataset, 'time_s', 'voltage_V', { min: 0, max: 2e-8 })

  assert.equal(window.x.length, 2)
  assert.equal(window.x[0], 0)
  assert.equal(window.y[0], 2e-3)

  const stats = computeSeriesStats(window.y)
  assert.equal(stats.count, 2)
  assert.equal(stats.max, 5e-3)
})
