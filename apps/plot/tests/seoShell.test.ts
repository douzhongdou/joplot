import test from 'node:test'
import assert from 'node:assert/strict'
import robots from '../app/robots.ts'
import sitemap from '../app/sitemap.ts'
import { getLanguageMetadata, getSoftwareApplicationJsonLd } from '../src/lib/siteMetadata.ts'

test('new joplot stays unindexed and does not claim the legacy production domain', () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL
  delete process.env.NEXT_PUBLIC_SITE_URL
  try {
    for (const language of ['en', 'zh-CN', 'ja-JP'] as const) {
      const metadata = getLanguageMetadata(language)
      assert.deepEqual(metadata.robots, { index: false, follow: false })
      assert.equal(metadata.alternates, undefined)
      assert.equal(metadata.metadataBase, undefined)
      assert.doesNotMatch(JSON.stringify(metadata), /https:\/\/joplot\.com/)
    }
    assert.equal(getSoftwareApplicationJsonLd().url, undefined)
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = previous
  }
})

test('an explicitly configured new-app URL controls its canonical independently', () => {
  const previous = process.env.NEXT_PUBLIC_SITE_URL
  process.env.NEXT_PUBLIC_SITE_URL = 'https://new.example.com/'
  try {
    assert.equal(getLanguageMetadata('en').alternates?.canonical, 'https://new.example.com/')
    assert.equal(getSoftwareApplicationJsonLd().url, 'https://new.example.com/')
    assert.deepEqual(getLanguageMetadata('en').robots, { index: false, follow: false })
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = previous
  }
})

test('preview robots and sitemap do not advertise production pages', () => {
  assert.deepEqual(robots(), { rules: { userAgent: '*', disallow: '/' } })
  assert.deepEqual(sitemap(), [])
})
