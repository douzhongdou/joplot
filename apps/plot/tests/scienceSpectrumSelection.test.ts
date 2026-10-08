import assert from 'node:assert/strict'
import test from 'node:test'

import { createDense } from '../src/science/lib/dense.ts'
import { resolveSpectrumTarget } from '../src/science/lib/spectrum.ts'
import { projectVector } from '../src/science/lib/vectors.ts'
import type { ScienceValue, Series, SpectrumValue } from '../src/science/types.ts'

function makeSeries(id: string): Series {
  return {
    id,
    name: id,
    kind: 'series',
    x: createDense(Float64Array.of(0, 1, 2, 3)),
    y: createDense(Float64Array.of(3, 1, 4, 1)),
    provenance: 'test',
  }
}

function makeSpectrum(id: string, phase: boolean): SpectrumValue {
  return {
    id,
    name: id,
    kind: 'spectrum',
    frequency: createDense(Float64Array.of(0, 1, 2, 3)),
    magnitude: createDense(Float64Array.of(1, 2, 3, 4)),
    phase: phase ? createDense(Float64Array.of(0, 0.1, 0.2, 0.3)) : null,
    sampleRate: 100,
    provenance: 'test',
  }
}

test('选中频谱本身时表示画整个频谱，不指定字段', () => {
  const spectrum = makeSpectrum('fft1', true)
  const target = resolveSpectrumTarget([spectrum], spectrum)

  assert.equal(target?.spectrum, spectrum)
  assert.equal(target?.field, null)
})

test('选中 fft1::phase 会落回该频谱的 phase 字段', () => {
  const spectrum = makeSpectrum('fft1', true)
  const values: ScienceValue[] = [makeSeries('signal'), spectrum]
  const projected = projectVector(spectrum, 'phase')
  assert.ok(projected, 'phase 投影应当存在')

  const target = resolveSpectrumTarget(values, projected)
  assert.equal(target?.spectrum, spectrum)
  assert.equal(target?.field, 'phase')
})

test('选中 fft1::magnitude 会落回该频谱的 magnitude 字段', () => {
  const spectrum = makeSpectrum('fft1', false)
  const projected = projectVector(spectrum, 'magnitude')
  const target = resolveSpectrumTarget([spectrum], projected)

  assert.equal(target?.spectrum, spectrum)
  assert.equal(target?.field, 'magnitude')
})

test('选中 fft1::frequency 等同于看整个频谱，因为 frequency 只是横轴数据', () => {
  const spectrum = makeSpectrum('fft1', true)
  const projected = projectVector(spectrum, 'frequency')
  const target = resolveSpectrumTarget([spectrum], projected)

  assert.equal(target?.spectrum, spectrum)
  assert.equal(target?.field, null)
})

test('普通 series 与它的字段投影都不接管频谱图', () => {  const spectrum = makeSpectrum('fft1', true)
  const series = makeSeries('signal')
  const values: ScienceValue[] = [series, spectrum]
  const projected = projectVector(series, 'y')
  assert.ok(projected)

  assert.equal(resolveSpectrumTarget(values, series), null)
  assert.equal(resolveSpectrumTarget(values, projected), null)
})

test('数据集列投影不会被误判成频谱字段', () => {
  const spectrum = makeSpectrum('fft1', true)
  const datasetColumn = makeSeries('ds:abc:speed')
  const projected = projectVector(datasetColumn, 'y')
  assert.ok(projected)

  assert.equal(resolveSpectrumTarget([datasetColumn, spectrum], projected), null)
})

test('没有选中项时返回 null', () => {
  assert.equal(resolveSpectrumTarget([makeSpectrum('fft1', true)], undefined), null)
})
