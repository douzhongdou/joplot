import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LANGUAGE_COOKIE_KEY,
  normalizeLanguage,
  parseLanguageCookie,
  resolveLanguage,
  serializeLanguageCookie,
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

test('parseLanguageCookie reads the language cookie out of a cookie header', () => {
  assert.equal(parseLanguageCookie(`${LANGUAGE_COOKIE_KEY}=ja-JP`), 'ja-JP')
  assert.equal(parseLanguageCookie(`theme=dark; ${LANGUAGE_COOKIE_KEY}=zh-CN; foo=1`), 'zh-CN')
  assert.equal(parseLanguageCookie('theme=dark'), null)
  assert.equal(parseLanguageCookie(''), null)
  assert.equal(parseLanguageCookie(undefined), null)
  assert.equal(parseLanguageCookie(`${LANGUAGE_COOKIE_KEY}=fr-FR`), null)
})

test('serializeLanguageCookie produces a readable Set-Cookie value', () => {
  const cookie = serializeLanguageCookie('zh-CN')
  assert.match(cookie, new RegExp(`^${LANGUAGE_COOKIE_KEY}=`))
  assert.match(cookie, /Path=\//)
  assert.equal(parseLanguageCookie(cookie), 'zh-CN')
})

test('resolveLanguage prefers cookie over browser language', () => {
  assert.equal(resolveLanguage({ cookie: `${LANGUAGE_COOKIE_KEY}=ja-JP`, browser: 'zh-CN' }), 'ja-JP')
  assert.equal(resolveLanguage({ cookie: `${LANGUAGE_COOKIE_KEY}=en`, browser: 'ja-JP' }), 'en')
})

test('resolveLanguage falls back to the browser language when the cookie is missing or invalid', () => {
  assert.equal(resolveLanguage({ browser: 'zh-CN' }), 'zh-CN')
  assert.equal(resolveLanguage({ cookie: `${LANGUAGE_COOKIE_KEY}=fr-FR`, browser: 'ja-JP' }), 'ja-JP')
})

test('resolveLanguage falls back to english when nothing matches', () => {
  assert.equal(resolveLanguage({ browser: 'fr-FR' }), 'en')
  assert.equal(resolveLanguage(), 'en')
  assert.equal(resolveLanguage({ fallback: 'ja-JP' }), 'ja-JP')
})
