import assert from 'node:assert/strict'
import test from 'node:test'
import { spectrumReference, toRelativeDb } from '../src/science/lib/spectrumDisplay.ts'

test('relative dB exposes small spectral components beside a strong DC bin', () => {
  const magnitude = Float64Array.of(0.0058, 0.0001, 0.000003, 0)
  const reference = spectrumReference(magnitude)
  const db = toRelativeDb(magnitude, reference)
  assert.equal(reference, 0.0058)
  assert.equal(db[0], 0)
  assert.ok(db[1] < -35 && db[1] > -36)
  assert.ok(db[2] < -65 && db[2] > -66)
  assert.equal(db[3], -120)
  assert.equal(magnitude[1], 0.0001, 'plot conversion must not alter FFT output')
})

test('range previews can use the same full-spectrum reference', () => {
  const reference = spectrumReference([0.0058, 0.0001, 0.000003])
  const db = toRelativeDb([0.0001, 0.000003], reference)
  assert.ok(db[0] < 0)
  assert.ok(db[1] < db[0])
})
