import test from 'node:test'
import assert from 'node:assert/strict'

import { parseDelimitedText } from '../src/superplot/lib/parse.ts'
import { seriesFromDataset, seriesListFromDataset } from '../src/science/lib/import.ts'
import { readScienceDataset } from '../src/science/lib/readDataset.ts'
import { datasetKey, decodeScienceWorkspace } from '../src/science/lib/persistence.ts'
import { valueToCsv } from '../src/science/lib/export.ts'
import { values1d } from '../src/science/lib/dense.ts'
import { runPipeline } from '../src/science/lib/pipeline.ts'

test('import keeps X and Y paired when missing rows are dropped', () => {
  const dataset = parseDelimitedText('time,signal\n0,2\n0.5,3\n1,\n1.5,5\n', {
    id: 'data', fileName: 'data.csv',
  })
  const series = seriesFromDataset(dataset, 'time', 'signal')
  assert.deepEqual([...values1d(series.x)], [0, 0.5, 1.5])
  assert.deepEqual([...values1d(series.y)], [2, 3, 5])
  assert.equal(series.sampleRate, undefined, 'a missing row must not imply a false uniform sample rate')
  const result = runPipeline([series], [{ id: 'fft', op: 'fft', inputId: 'signal', outputId: 'spectrum', params: {} }])
  assert.match(result.errors.fft, /uniformly spaced X/)
})

test('row index mapping enables FFT and exports full precision values', async () => {
  const dataset = parseDelimitedText('signal\n1.25\n2.5\n3.75\n4.5\n', {
    id: 'data', fileName: 'data.csv',
  })
  const series = seriesFromDataset(dataset, '', 'signal')
  assert.equal(series.sampleRate, 1)
  const result = runPipeline([series], [{ id: 'fft', op: 'fft', inputId: 'signal', outputId: 'spectrum', params: {} }])
  assert.deepEqual(result.errors, {})
  const spectrum = result.values.find((value) => value.id === 'spectrum')
  assert.equal(spectrum?.kind === 'spectrum' ? spectrum.frequencyUnit : null, 'cycles/sample')
  assert.equal(await valueToCsv(series).text(), 'x,y\r\n0,1.25\r\n1,2.5\r\n2,3.75\r\n3,4.5\r\n')
})

test('multiple selected Y columns get stable series ids and preserve their own missing rows', () => {
  const dataset = parseDelimitedText('time,a,b\n0,1,10\n1,,20\n2,3,30\n', {
    id: 'multi', fileName: 'multi.csv',
  })
  const series = seriesListFromDataset(dataset, 'time', ['a', 'b'])
  assert.deepEqual(series.map((value) => value.id), ['ds:multi:a', 'ds:multi:b'])
  assert.deepEqual([...values1d(series[0].x)], [0, 2])
  assert.deepEqual([...values1d(series[1].x)], [0, 1, 2])
  assert.equal(series[0].sampleRate, 0.5)
  assert.equal(series[1].sampleRate, 1)
})

test('a seconds-based X column labels FFT frequency in Hz', () => {
  const dataset = parseDelimitedText('time_s,y\n0,1\n0.5,2\n1,3\n1.5,4\n', {
    id: 'time', fileName: 'time.csv',
  })
  const series = seriesFromDataset(dataset, 'time_s', 'y')
  const result = runPipeline([series], [{ id: 'fft', op: 'fft', inputId: 'signal', outputId: 'spectrum', params: {} }])
  const spectrum = result.values.find((value) => value.id === 'spectrum')
  assert.equal(spectrum?.kind === 'spectrum' ? spectrum.frequencyUnit : null, 'Hz')
})

test('Excel first worksheet imports as a numeric science dataset', async () => {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['time', 'signal', 'label'], [0, 1.5, 'first'], [0.5, 2.25, 'second'],
  ]), 'Run 1')
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const file = new File([bytes], 'run.xlsx')
  const dataset = await readScienceDataset(file)
  assert.deepEqual(dataset.numericColumns, ['time', 'signal'])
  assert.equal(dataset.rowCount, 2)
  assert.equal(dataset.timeColumn, null, 'two points are insufficient for automatic time inference')
})

test('workspace restore accepts matching data and rejects a stale or malformed recipe', () => {
  const dataset = parseDelimitedText('time,y\n0,1\n1,2\n', { id: 'data', fileName: 'data.csv' })
  const recipe = {
    version: 2,
    source: 'dataset',
    datasets: [{ key: datasetKey(dataset), datasetId: dataset.id, xColumn: 'time', yColumns: ['y'] }],
    steps: [{ id: 's1', op: 'stats', inputId: 'ds:data:y', outputId: 'stats1', params: {} }],
    selectedId: 'stats1',
  }
  assert.equal(decodeScienceWorkspace([dataset], recipe)?.datasets[0]?.fileName, 'data.csv')
  // 对不上的条目被丢弃而不是整档报废；没有有效数据集时回退 sample 语义
  const stale = decodeScienceWorkspace([dataset], { ...recipe, datasets: [{ ...recipe.datasets[0], key: 'old' }] })
  assert.deepEqual(stale?.datasets, [])
  assert.equal(stale?.recipe.source, 'sample')
  assert.equal(decodeScienceWorkspace([dataset], { ...recipe, steps: [{ ...recipe.steps[0], op: 'unknown' }] }), null)
})

test('v1 workspace archives migrate to the v2 shape instead of being dropped', () => {
  const dataset = parseDelimitedText('time,y\n0,1\n1,2\n', { id: 'data', fileName: 'data.csv' })
  const legacy = {
    version: 1,
    source: 'dataset',
    datasetKey: datasetKey(dataset),
    xColumn: 'time',
    yColumns: ['y'],
    steps: [{ id: 's1', op: 'stats', inputId: 'series-1', outputId: 'stats1', params: {} }],
    selectedId: 'stats1',
  }
  const migrated = decodeScienceWorkspace(undefined, legacy, dataset)
  assert.equal(migrated?.recipe.version, 2)
  assert.equal(migrated?.datasets[0]?.fileName, 'data.csv')
  assert.deepEqual(migrated?.recipe.datasets, [
    { key: datasetKey(dataset), datasetId: dataset.id, xColumn: 'time', yColumns: ['y'] },
  ])
  assert.equal(decodeScienceWorkspace(undefined, { ...legacy, datasetKey: 'old' }, dataset)?.datasets.length, 0)
})
