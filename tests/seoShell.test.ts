import test from 'node:test'
import assert from 'node:assert/strict'

import {
  renderSeoShell,
  seoShellContentByLanguage,
} from '../src/lib/seoShell.ts'

test('seo shell content exists for every supported language', () => {
  assert.deepEqual(Object.keys(seoShellContentByLanguage).sort(), ['en', 'ja-JP', 'zh-CN'])
  assert.equal(seoShellContentByLanguage.en.featureItems.length >= 3, true)
  assert.equal(seoShellContentByLanguage.en.faqItems.length >= 2, true)
})

test('renderSeoShell outputs crawlable hero, features, and faq content', () => {
  const html = renderSeoShell('en')

  assert.match(html, /<main id="seo-shell"/)
  assert.match(html, /<h1>Drop in a CSV and get a chart instantly<\/h1>/)
  assert.match(html, /<h2>Why teams use joplot<\/h2>/)
  assert.match(html, /<h2>Frequently asked questions<\/h2>/)
  assert.match(html, /Compare datasets in one workspace/)
  assert.match(html, /Can I compare multiple CSV files at once\?/)
})

test('renderSeoShell localizes HTML metadata content for chinese and japanese pages', () => {
  const zhHtml = renderSeoShell('zh-CN')
  const jaHtml = renderSeoShell('ja-JP')

  assert.match(zhHtml, /将 CSV 拖进来，立刻出图/)
  assert.match(zhHtml, /为什么团队会选择 joplot/)
  assert.match(jaHtml, /CSV をドロップすると、すぐにグラフ化/)
  assert.match(jaHtml, /joplot が選ばれる理由/)
})
