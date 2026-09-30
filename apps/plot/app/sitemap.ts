import type { MetadataRoute } from 'next'

const lastModified = new Date('2026-09-11T00:00:00.000Z')

// 语言不再进入 URL，所以 sitemap 只列出可索引的静态页面（每页一个 URL）。
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://joplot.com/',
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://joplot.com/function',
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ]
}
