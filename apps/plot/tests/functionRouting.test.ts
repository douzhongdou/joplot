import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FUNCTION_STUDIO_PATH,
  HOME_PATH,
  IMAGEJ_PATH,
  SCIENCE_PATH,
  SUPER_PLOT_PATH,
  normalizeLanguage,
} from '../src/i18n/config.ts'

test('section paths are language-agnostic', () => {
  assert.equal(HOME_PATH, '/')
  assert.equal(FUNCTION_STUDIO_PATH, '/function')
  assert.equal(SUPER_PLOT_PATH, '/super-plot')
  assert.equal(SCIENCE_PATH, '/science')
  assert.equal(IMAGEJ_PATH, '/imagej')
})

test('normalizeLanguage still maps browser and cookie values', () => {
  assert.equal(normalizeLanguage('zh'), 'zh-CN')
  assert.equal(normalizeLanguage('ja-JP'), 'ja-JP')
  assert.equal(normalizeLanguage('en-US'), 'en')
  assert.equal(normalizeLanguage('fr'), null)
})
