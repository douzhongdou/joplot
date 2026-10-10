import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getFunctionStudioPath,
  replaceRouteLanguage,
  resolveInitialLanguage,
  resolveLanguageFromPath,
} from '../src/i18n/config.ts'

test('resolveLanguageFromPath understands nested localized routes', () => {
  assert.equal(resolveLanguageFromPath('/zh/function'), 'zh-CN')
  assert.equal(resolveLanguageFromPath('/en/function/'), 'en')
  assert.equal(resolveLanguageFromPath('/JA/function'), 'ja-JP')
  assert.equal(resolveLanguageFromPath('/ja'), 'ja-JP')
})

test('resolveLanguageFromPath ignores paths that only look like a language prefix', () => {
  assert.equal(resolveLanguageFromPath('/zhfunction'), null)
  assert.equal(resolveLanguageFromPath('/function'), null)
  assert.equal(resolveLanguageFromPath('/'), null)
  assert.equal(resolveLanguageFromPath(''), null)
})

test('resolveInitialLanguage picks up the language from nested routes', () => {
  assert.equal(resolveInitialLanguage('/zh/function', null, 'en-US'), 'zh-CN')
})

test('replaceRouteLanguage swaps the prefix and keeps the rest of the path', () => {
  assert.equal(replaceRouteLanguage('/zh/function', 'en'), '/en/function')
  assert.equal(replaceRouteLanguage('/ja/function/', 'zh-CN'), '/zh/function')
  assert.equal(replaceRouteLanguage('/en', 'ja-JP'), '/ja')
  assert.equal(replaceRouteLanguage('/', 'zh-CN'), '/zh')
  assert.equal(replaceRouteLanguage('/something-else', 'en'), '/en')
})

test('getFunctionStudioPath builds the localized function route', () => {
  assert.equal(getFunctionStudioPath('zh-CN'), '/zh/function')
  assert.equal(getFunctionStudioPath('en'), '/en/function')
  assert.equal(getFunctionStudioPath('ja-JP'), '/ja/function')
})
