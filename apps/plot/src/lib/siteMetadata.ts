import type { Metadata } from 'next'
import type { SupportedLanguage } from '../i18n/config'

// 新 joplot 尚在开发，只使用它自己的预览地址，不能指向老站的线上域名。
export function getSiteUrl(): string | null {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') || null
}

const metadataByLanguage = {
  'zh-CN': {
    title: 'joplot · 科学数据处理与分析工作台',
    description: '浏览器内科学数据处理：平滑、去趋势、FFT、曲线拟合与描述统计。',
  },
  en: {
    title: 'joplot · Scientific data processing and analysis',
    description: 'In-browser scientific data processing: smoothing, detrending, FFT, curve fitting and statistics.',
  },
  'ja-JP': {
    title: 'joplot · 科学データ処理・解析ワークスペース',
    description: 'ブラウザ内の科学データ処理：平滑化、トレンド除去、FFT、曲線フィット、記述統計。',
  },
}

export function getLanguageMetadata(language: SupportedLanguage): Metadata {
  const content = metadataByLanguage[language]
  const siteUrl = getSiteUrl()
  return {
    ...content,
    applicationName: 'joplot',
    ...(siteUrl ? { metadataBase: new URL(siteUrl), alternates: { canonical: `${siteUrl}/` } } : {}),
    // 新应用只用于预览，正式上线时再单独开放索引。
    robots: { index: false, follow: false },
    icons: {
      icon: [{ url: '/favicon.ico' }, { url: '/icon.webp', type: 'image/webp' }],
      apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    },
    manifest: '/manifest.webmanifest',
  }
}

export function getSoftwareApplicationJsonLd() {
  const siteUrl = getSiteUrl()
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'joplot',
    ...(siteUrl ? { url: `${siteUrl}/` } : {}),
    applicationCategory: ['DataVisualizationApplication', 'ScienceApplication'],
    operatingSystem: 'Web',
    description: metadataByLanguage.en.description,
  }
}
