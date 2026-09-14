import type { MetadataRoute } from 'next'

const lastModified = new Date('2026-09-11T00:00:00.000Z')

export default function sitemap(): MetadataRoute.Sitemap {
  const alternates = {
    languages: {
      en: 'https://joplot.com/en',
      'zh-CN': 'https://joplot.com/zh',
      ja: 'https://joplot.com/ja',
      'x-default': 'https://joplot.com/en',
    },
  }

  const functionAlternates = {
    languages: {
      en: 'https://joplot.com/en/function',
      'zh-CN': 'https://joplot.com/zh/function',
      ja: 'https://joplot.com/ja/function',
      'x-default': 'https://joplot.com/en/function',
    },
  }

  return [
    {
      url: 'https://joplot.com/en',
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
      alternates,
    },
    {
      url: 'https://joplot.com/zh',
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
      alternates,
    },
    {
      url: 'https://joplot.com/ja',
      lastModified,
      changeFrequency: 'weekly',
      priority: 1,
      alternates,
    },
    {
      url: 'https://joplot.com/en/function',
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.8,
      alternates: functionAlternates,
    },
    {
      url: 'https://joplot.com/zh/function',
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.8,
      alternates: functionAlternates,
    },
    {
      url: 'https://joplot.com/ja/function',
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.8,
      alternates: functionAlternates,
    },
  ]
}
