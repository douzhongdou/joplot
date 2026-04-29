import test from 'node:test'
import assert from 'node:assert/strict'

import { resolveLocaleRedirect } from '../src/lib/localeRouting.ts'

test('resolveLocaleRedirect falls back to /en when no language is present', () => {
  assert.equal(resolveLocaleRedirect(null), '/en')
  assert.equal(resolveLocaleRedirect(''), '/en')
})

test('resolveLocaleRedirect prioritizes zh over default', () => {
  assert.equal(resolveLocaleRedirect('zh-CN,zh;q=0.9,en;q=0.8'), '/zh')
})

test('resolveLocaleRedirect maps ja browsers to /ja', () => {
  assert.equal(resolveLocaleRedirect('ja-JP,ja;q=0.9,en;q=0.8'), '/ja')
})
