import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeLanguage,
  resolveInitialLanguage,
} from '../src/i18n/config.ts'

test('normalizeLanguage accepts supported language ids', () => {
  assert.equal(normalizeLanguage('zh-CN'), 'zh-CN')
  assert.equal(normalizeLanguage('en'), 'en')
  assert.equal(normalizeLanguage('ja-JP'), 'ja-JP')
})

test('normalizeLanguage maps browser language variants to supported languages', () => {
  assert.equal(normalizeLanguage('zh'), 'zh-CN')
  assert.equal(normalizeLanguage('zh-Hans-CN'), 'zh-CN')
  assert.equal(normalizeLanguage('en-US'), 'en')
  assert.equal(normalizeLanguage('ja'), 'ja-JP')
  assert.equal(normalizeLanguage('ja-JP-u-ca-japanese'), 'ja-JP')
})

test('normalizeLanguage returns null for unsupported languages', () => {
  assert.equal(normalizeLanguage('fr-FR'), null)
  assert.equal(normalizeLanguage('de'), null)
  assert.equal(normalizeLanguage(undefined), null)
})

test('resolveInitialLanguage prefers stored language over browser language', () => {
  assert.equal(resolveInitialLanguage('ja-JP', 'zh-CN'), 'ja-JP')
  assert.equal(resolveInitialLanguage('en', 'ja-JP'), 'en')
})

test('resolveInitialLanguage falls back to browser language when stored value is invalid', () => {
  assert.equal(resolveInitialLanguage('fr-FR', 'ja-JP'), 'ja-JP')
  assert.equal(resolveInitialLanguage(null, 'zh-CN'), 'zh-CN')
})

test('resolveInitialLanguage falls back to english when nothing matches', () => {
  assert.equal(resolveInitialLanguage(null, 'fr-FR'), 'en')
  assert.equal(resolveInitialLanguage(undefined, undefined), 'en')
})
