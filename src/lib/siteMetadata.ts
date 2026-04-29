import type { Metadata } from 'next'
import type { SupportedLanguage } from '../i18n/config'

interface LanguageMetadataContent {
  path: '/en' | '/zh' | '/ja'
  locale: string
  title: string
  description: string
}

const metadataByLanguage: Record<SupportedLanguage, LanguageMetadataContent> = {
  en: {
    path: '/en',
    locale: 'en_US',
    title: 'joplot | CSV charting and data analysis workspace',
    description: 'Import multiple CSV files, build charts quickly, filter data, and compare datasets in one workspace.',
  },
  'zh-CN': {
    path: '/zh',
    locale: 'zh_CN',
    title: 'joplot | CSV 图表与数据分析工作台',
    description: '拖拽上传多个 CSV，快速生成图表、筛选数据并在同一画布中比较多份数据集。',
  },
  'ja-JP': {
    path: '/ja',
    locale: 'ja_JP',
    title: 'joplot | CSV グラフとデータ分析ワークスペース',
    description: '複数の CSV を取り込み、グラフ作成、データの絞り込み、比較を 1 つのキャンバスで行えます。',
  },
}

export function getLanguageMetadata(language: SupportedLanguage): Metadata {
  const content = metadataByLanguage[language]
  const url = `https://joplot.com${content.path}`

  return {
    title: content.title,
    description: content.description,
    applicationName: 'joplot',
    authors: [{ name: 'joplot' }],
    alternates: {
      canonical: url,
      languages: {
        en: 'https://joplot.com/en',
        'zh-CN': 'https://joplot.com/zh',
        ja: 'https://joplot.com/ja',
        'x-default': 'https://joplot.com/',
      },
    },
    openGraph: {
      type: 'website',
      locale: content.locale,
      siteName: 'joplot',
      url,
      title: content.title,
      description: content.description,
      images: [
        {
          url: 'https://joplot.com/icon.webp',
          width: 500,
          height: 500,
          alt: 'joplot logo',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: content.title,
      description: content.description,
      images: ['https://joplot.com/icon.webp'],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      },
    },
    icons: {
      icon: [
        { url: '/favicon.ico' },
        { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
        { url: '/icon.webp', type: 'image/webp' },
      ],
      apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    },
    manifest: '/manifest.webmanifest',
    other: {
      'theme-color': '#155eef',
      'apple-mobile-web-app-title': 'joplot',
    },
  }
}
