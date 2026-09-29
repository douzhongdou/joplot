import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildWindow,
  computeSpectrum,
  findSpectrumPeaks,
  fft,
  magnitudeToDb,
  nextPowerOfTwo,
} from '../src/superplot/lib/fft.ts'

function makeTone(frequency: number, sampleRate: number, length: number, amplitude = 1) {
  const signal = new Float64Array(length)
  for (let i = 0; i < length; i += 1) {
    signal[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate)
  }
  return signal
}

test('nextPowerOfTwo rounds up to the next power of two', () => {
  assert.equal(nextPowerOfTwo(1), 1)
  assert.equal(nextPowerOfTwo(3), 4)
  assert.equal(nextPowerOfTwo(1024), 1024)
  assert.equal(nextPowerOfTwo(1500), 2048)
})

test('fft of an impulse is flat', () => {
  const re = new Float64Array(8)
  const im = new Float64Array(8)
  re[0] = 1
  fft(re, im)

  for (let k = 0; k < 8; k += 1) {
    assert.ok(Math.abs(re[k] - 1) < 1e-9)
    assert.ok(Math.abs(im[k]) < 1e-9)
  }
})

test('fft locates a pure tone at the expected bin', () => {
  const length = 64
  const toneBin = 7
  const re = new Float64Array(length)
  const im = new Float64Array(length)

  for (let i = 0; i < length; i += 1) {
    re[i] = Math.cos((2 * Math.PI * toneBin * i) / length)
  }

  fft(re, im)

  const magnitude = (k: number) => Math.hypot(re[k], im[k])
  assert.ok(magnitude(toneBin) > magnitude(toneBin + 1) * 10)
  assert.ok(Math.abs(magnitude(toneBin) - length / 2) < 1e-6)
})

test('fft rejects non power-of-two lengths', () => {
  assert.throws(() => fft(new Float64Array(3), new Float64Array(3)))
})

test('hann window is symmetric and tapers to zero at the edges', () => {
  const window = buildWindow('hann', 9)
  assert.ok(window[0] < 1e-12)
  assert.ok(window[8] < 1e-12)
  assert.ok(Math.abs(window[4] - 1) < 1e-9)
  assert.ok(Math.abs(window[2] - window[6]) < 1e-9)
})

test('computeSpectrum recovers the amplitude of a windowed tone', () => {
  const sampleRate = 10000
  const length = 4096
  const frequency = sampleRate * 100 / length // exactly on a bin
  const signal = makeTone(frequency, sampleRate, length, 0.25)

  const result = computeSpectrum(signal, {
    sampleRate,
    window: 'hann',
    detrend: 'mean',
    fftSize: 0,
    segments: 1,
    overlap: 0.5,
    normalize: true,
  })

  assert.equal(result.fftSize, length)
  assert.equal(result.freq.length, length / 2 + 1)

  let peakIndex = 0
  for (let i = 1; i < result.magnitude.length; i += 1) {
    if (result.magnitude[i] > result.magnitude[peakIndex]) {
      peakIndex = i
    }
  }

  const peakFrequency = result.freq[peakIndex]
  assert.ok(Math.abs(peakFrequency - frequency) <= result.binWidth)
  assert.ok(Math.abs(result.magnitude[peakIndex] - 0.25) < 0.02)
  assert.ok(result.phase)
  assert.ok(Math.abs(result.phase[peakIndex] + Math.PI / 2) < 0.02, 'sine FFT phase is -π/2 at the tone bin')
})

test('computeSpectrum supports Welch averaging across segments', () => {
  const signal = makeTone(1000, 20000, 20000, 1)
  const result = computeSpectrum(signal, {
    sampleRate: 20000,
    window: 'hann',
    detrend: 'mean',
    fftSize: 1024,
    segments: 8,
    overlap: 0.5,
    normalize: true,
  })

  assert.ok(result.segmentCount > 1)
  assert.equal(result.phase, null, 'Welch power averaging has no unique phase')
  assert.equal(result.fftSize, 1024)

  const peaks = findSpectrumPeaks(result.freq, result.magnitude, 1, { minFrequency: result.freq[1] * 2 })
  assert.equal(peaks.length, 1)
  assert.ok(Math.abs(peaks[0].frequency - 1000) <= result.binWidth)
})

test('auto Welch sizing actually yields the requested segment count', () => {
  const signal = makeTone(1000, 20000, 20000, 1)
  const result = computeSpectrum(signal, {
    sampleRate: 20000,
    window: 'hann',
    detrend: 'mean',
    fftSize: 0,
    segments: 8,
    overlap: 0.5,
    normalize: true,
  })

  assert.equal(result.segmentCount, 8)
  assert.ok(result.segmentLength <= result.fftSize)
})

test('an explicit fft size shorter than the signal truncates safely', () => {
  const signal = makeTone(1000, 20000, 1000, 1)
  const result = computeSpectrum(signal, {
    sampleRate: 20000,
    window: 'hann',
    detrend: 'mean',
    fftSize: 256,
    segments: 1,
    overlap: 0.5,
    normalize: true,
  })

  assert.equal(result.fftSize, 256)
  assert.equal(result.segmentLength, 256)
  assert.equal(result.freq.length, 129)
})

test('magnitudeToDb normalizes the peak to zero dB', () => {
  const magnitude = new Float64Array([1, 0.5, 0.1])
  const db = magnitudeToDb(magnitude)
  assert.ok(Math.abs(db[0]) < 1e-9)
  assert.ok(Math.abs(db[1] - 20 * Math.log10(0.5)) < 1e-9)
})
