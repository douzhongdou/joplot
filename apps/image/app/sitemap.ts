import type { MetadataRoute } from 'next'

const siteUrl = 'https://joimage.com'
const lastModified = new Date('2026-10-09T00:00:00.000Z')

// 语言不再进入 URL，所以 sitemap 只列出可索引的对外页面（工作台就是站点根）。
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteUrl}/`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
    },
  ]
}
