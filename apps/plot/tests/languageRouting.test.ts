import test from 'node:test'
import assert from 'node:assert/strict'

import {
  pickLanguageFromAcceptLanguage,
  resolveRequestLanguage,
  toLanguagePath,
} from '@joplot/i18n/routing'

test('toLanguagePath prefixes the outgoing path with the language segment', () => {
  assert.equal(toLanguagePath('/', 'zh-CN'), '/zh-CN')
  assert.equal(toLanguagePath('/science', 'ja-JP'), '/ja-JP/science')
  assert.equal(toLanguagePath('/spike/runtime', 'en'), '/en/spike/runtime')
})

test('pickLanguageFromAcceptLanguage honours q ordering', () => {
  assert.equal(pickLanguageFromAcceptLanguage('en;q=0.3,zh-CN;q=0.9,ja;q=0.5'), 'zh-CN')
  assert.equal(pickLanguageFromAcceptLanguage('ja-JP,en;q=0.9'), 'ja-JP')
  assert.equal(pickLanguageFromAcceptLanguage('zh,en;q=0.5'), 'zh-CN')
})

test('pickLanguageFromAcceptLanguage falls back to english when nothing matches', () => {
  assert.equal(pickLanguageFromAcceptLanguage('fr-FR,de;q=0.8'), 'en')
  assert.equal(pickLanguageFromAcceptLanguage('*'), 'en')
  assert.equal(pickLanguageFromAcceptLanguage(''), 'en')
  assert.equal(pickLanguageFromAcceptLanguage(null), 'en')
  assert.equal(pickLanguageFromAcceptLanguage(undefined), 'en')
  assert.equal(pickLanguageFromAcceptLanguage(undefined, 'ja-JP'), 'ja-JP')
})

test('pickLanguageFromAcceptLanguage skips explicitly rejected languages', () => {
  assert.equal(pickLanguageFromAcceptLanguage('zh-CN;q=0,en;q=0.5'), 'en')
  assert.equal(pickLanguageFromAcceptLanguage('zh-CN;q=0'), 'en')
})

test('resolveRequestLanguage prefers an explicit cookie over the browser header', () => {
  assert.deepEqual(
    resolveRequestLanguage({ cookieLanguage: 'ja-JP', acceptLanguage: 'zh-CN' }),
    { language: 'ja-JP', fromCookie: true },
  )
})

test('resolveRequestLanguage ignores unusable cookies and uses Accept-Language', () => {
  assert.deepEqual(
    resolveRequestLanguage({ cookieLanguage: 'fr-FR', acceptLanguage: 'zh-CN' }),
    { language: 'zh-CN', fromCookie: false },
  )
  assert.deepEqual(
    resolveRequestLanguage({ cookieLanguage: '', acceptLanguage: 'ja' }),
    { language: 'ja-JP', fromCookie: false },
  )
  assert.deepEqual(resolveRequestLanguage(), { language: 'en', fromCookie: false })
})
