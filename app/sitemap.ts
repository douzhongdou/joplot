import type { MetadataRoute } from 'next'

const lastModified = new Date('2026-04-29T00:00:00.000Z')

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://joplot.com/',
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: 'https://joplot.com/en',
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
      alternates: {
        languages: {
          en: 'https://joplot.com/en',
          'zh-CN': 'https://joplot.com/zh',
          ja: 'https://joplot.com/ja',
          'x-default': 'https://joplot.com/',
        },
      },
    },
    {
      url: 'https://joplot.com/zh',
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
      alternates: {
        languages: {
          en: 'https://joplot.com/en',
          'zh-CN': 'https://joplot.com/zh',
          ja: 'https://joplot.com/ja',
          'x-default': 'https://joplot.com/',
        },
      },
    },
    {
      url: 'https://joplot.com/ja',
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
      alternates: {
        languages: {
          en: 'https://joplot.com/en',
          'zh-CN': 'https://joplot.com/zh',
          ja: 'https://joplot.com/ja',
          'x-default': 'https://joplot.com/',
        },
      },
    },
  ]
}
