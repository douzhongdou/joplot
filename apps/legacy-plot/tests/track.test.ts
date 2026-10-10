import test from 'node:test'
import assert from 'node:assert/strict'

import { track } from '../src/lib/track.ts'

test('track is a no-op when window is unavailable', () => {
  assert.doesNotThrow(() => {
    track('upload_csv', {
      rows: 12,
    })
  })
})

test('track is a no-op when umami tracker is missing', () => {
  const previousWindow = globalThis.window

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  })

  try {
    assert.doesNotThrow(() => {
      track('upload_csv', {
        rows: 12,
      })
    })
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      })
    }
  }
})

test('track forwards sanitized payloads to umami', () => {
  const calls: Array<{ eventName: string; payload: Record<string, unknown> }> = []
  const previousWindow = globalThis.window

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      umami: {
        track(eventName: string, payload: Record<string, unknown>) {
          calls.push({ eventName, payload })
        },
      },
    },
  })

  try {
    track('upload_csv', {
      rows: 12,
      columns: 3,
      language: 'en',
      ignored: undefined,
    })
  } finally {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      })
    }
  }

  assert.deepEqual(calls, [{
    eventName: 'upload_csv',
    payload: {
      rows: 12,
      columns: 3,
      language: 'en',
    },
  }])
})
