import type { Metadata } from 'next'
import type { SupportedLanguage } from '../i18n/config'

interface LanguageMetadataContent {
  path: '/en' | '/zh' | '/ja'
  locale: string
  title: string
  description: string
}

const siteUrl = 'https://joplot.com'
const canonicalLanguages = {
  en: `${siteUrl}/en`,
  'zh-CN': `${siteUrl}/zh`,
  ja: `${siteUrl}/ja`,
  'x-default': `${siteUrl}/en`,
}

const metadataByLanguage: Record<SupportedLanguage, LanguageMetadataContent> = {
  en: {
    path: '/en',
    locale: 'en_US',
    title: 'joplot | Free online CSV plot tool',
    description: 'Plot CSV files online with joplot. Import CSV or Excel files, build charts quickly, filter data, and compare datasets in one workspace.',
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
  const url = `${siteUrl}${content.path}`

  return {
    title: content.title,
    description: content.description,
    keywords: [
      'joplot',
      'CSV plot tool',
      'plot CSV online',
      'CSV chart generator',
      'CSV to chart',
    ],
    applicationName: 'joplot',
    authors: [{ name: 'joplot' }],
    alternates: {
      canonical: url,
      languages: canonicalLanguages,
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

const functionStudioContentByLanguage: Record<SupportedLanguage, { title: string; description: string }> = {
  en: {
    title: 'joplot | Free online function plotter',
    description: 'Graph y = f(x) formulas instantly in the browser. Overlay curves, tune parameters with sliders, and send sampled points to the CSV workbench.',
  },
  'zh-CN': {
    title: 'joplot | 在线函数画板',
    description: '输入 y = f(x) 公式即刻出图，支持多曲线叠加、参数滑块和渐近线断线，并可把采样点发送到 CSV 工作台继续分析。',
  },
  'ja-JP': {
    title: 'joplot | オンライン関数プロッター',
    description: 'y = f(x) の数式を入力するだけでグラフを描画。複数曲線の重ね合わせ、スライダーでのパラメータ調整、CSV ワークベンチへの送信に対応。',
  },
}

const functionStudioCanonicalLanguages = {
  en: `${siteUrl}/en/function`,
  'zh-CN': `${siteUrl}/zh/function`,
  ja: `${siteUrl}/ja/function`,
  'x-default': `${siteUrl}/en/function`,
}

export function getFunctionStudioMetadata(language: SupportedLanguage): Metadata {
  const base = getLanguageMetadata(language)
  const content = functionStudioContentByLanguage[language]
  const url = `${siteUrl}${metadataByLanguage[language].path}/function`

  return {
    ...base,
    title: content.title,
    description: content.description,
    keywords: [
      'joplot',
      'function plotter',
      'graph a function online',
      'plot equation online',
      'y = f(x) grapher',
    ],
    alternates: {
      canonical: url,
      languages: functionStudioCanonicalLanguages,
    },
    openGraph: {
      ...base.openGraph,
      url,
      title: content.title,
      description: content.description,
    },
    twitter: {
      ...base.twitter,
      title: content.title,
      description: content.description,
    },
  }
}

export function getSoftwareApplicationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'joplot',
    alternateName: 'joplot CSV plot tool',
    url: canonicalLanguages.en,
    applicationCategory: ['DataVisualizationApplication', 'BusinessApplication'],
    operatingSystem: 'Web',
    description: 'joplot is a free online CSV plot tool for turning CSV and Excel files into clean charts in the browser.',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: [
      'Plot CSV files online',
      'Import CSV and Excel files',
      'Generate charts without signup',
      'Filter and compare multiple datasets',
      'Export chart images',
    ],
  }
}
