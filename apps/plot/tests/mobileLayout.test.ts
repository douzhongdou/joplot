import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MOBILE_BREAKPOINT,
  isMobileViewport,
  shouldShowMobileInspector,
  toResponsiveCardLayout,
} from '../src/lib/mobileLayout.ts'

test('isMobileViewport uses the shared mobile breakpoint', () => {
  assert.equal(isMobileViewport(MOBILE_BREAKPOINT - 1), true)
  assert.equal(isMobileViewport(MOBILE_BREAKPOINT), true)
  assert.equal(isMobileViewport(MOBILE_BREAKPOINT + 1), false)
})

test('toResponsiveCardLayout keeps desktop card layout untouched', () => {
  const cards = [
    { id: 'a', layout: { x: 0, y: 0, w: 6, h: 7 } },
    { id: 'b', layout: { x: 6, y: 0, w: 6, h: 7 } },
  ]

  assert.deepEqual(toResponsiveCardLayout(cards, false), cards)
})

test('toResponsiveCardLayout stacks cards into a single mobile column while preserving order', () => {
  const cards = [
    { id: 'a', layout: { x: 0, y: 0, w: 6, h: 7 } },
    { id: 'b', layout: { x: 6, y: 0, w: 6, h: 5 } },
    { id: 'c', layout: { x: 0, y: 7, w: 12, h: 6 } },
  ]

  assert.deepEqual(toResponsiveCardLayout(cards, true), [
    { id: 'a', layout: { x: 0, y: 0, w: 12, h: 7 } },
    { id: 'b', layout: { x: 0, y: 7, w: 12, h: 5 } },
    { id: 'c', layout: { x: 0, y: 12, w: 12, h: 6 } },
  ])
})

test('shouldShowMobileInspector only enables the mobile inspector when a card is selected on mobile', () => {
  assert.equal(shouldShowMobileInspector(false, 'card-1', true), false)
  assert.equal(shouldShowMobileInspector(true, null, true), false)
  assert.equal(shouldShowMobileInspector(true, 'card-1', false), false)
  assert.equal(shouldShowMobileInspector(true, 'card-1', true), true)
})
