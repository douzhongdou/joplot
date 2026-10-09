import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'
import { I18nProvider } from '../../src/i18n'
import { LANGUAGE_HTML_LANG, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../src/i18n/config'
import { resolveRouteLanguage } from '../../src/lib/routeLanguage'
import '../globals.css'

/** 本应用的站点地址，canonical 与 OpenGraph 都用它；换域名时改这一处。 */
const siteUrl = 'https://joimage.com'

const LOCALIZED_METADATA: Record<SupportedLanguage, { title: string; description: string; locale: string }> = {
  'zh-CN': {
    title: 'joimage · 浏览器图像工作台',
    description: '纯本地的 8 位灰度图像处理：阈值与 Otsu 自动阈值、3×3 滤波、裁剪翻转、直方图与 ROI 测量。',
    locale: 'zh_CN',
  },
  en: {
    title: 'joimage · in-browser image workspace',
    description: 'Local-only 8-bit grayscale image processing: threshold and Otsu, 3x3 filters, crop and flips, histogram and ROI measurements.',
    locale: 'en_US',
  },
  'ja-JP': {
    title: 'joimage · ブラウザ画像ワークベンチ',
    description: 'ローカル完結の 8bit グレースケール画像処理：しきい値と Otsu、3×3 フィルタ、切り抜き・反転、ヒストグラムと ROI 測定。',
    locale: 'ja_JP',
  },
}

interface LanguageRouteProps {
  params: Promise<{ lang: string }>
}

/**
 * 语言取自路由段而不是 cookie，所以每个语言都能在构建时生成一份静态 HTML——HTML 由此可进
 * CDN；对外地址由 proxy.ts 分发到对应语言。
 */
export const dynamicParams = false

export function generateStaticParams() {
  return SUPPORTED_LANGUAGES.map((language) => ({ lang: language }))
}

export async function generateMetadata({ params }: LanguageRouteProps): Promise<Metadata> {
  const { lang } = await params
  const localized = LOCALIZED_METADATA[resolveRouteLanguage(lang)]

  return {
    title: localized.title,
    description: localized.description,
    applicationName: 'joimage',
    // 语言不进 URL：三种语言共用同一个 canonical，与 sitemap 一致。
    alternates: { canonical: `${siteUrl}/` },
    openGraph: {
      type: 'website',
      locale: localized.locale,
      siteName: 'joimage',
      url: `${siteUrl}/`,
      title: localized.title,
      description: localized.description,
      images: [{ url: `${siteUrl}/icon.png`, alt: 'joimage' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: localized.title,
      description: localized.description,
      images: [`${siteUrl}/icon.png`],
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
  }
}

export default async function RootLayout({
  children,
  params,
}: LanguageRouteProps & {
  children: ReactNode
}) {
  const { lang } = await params
  const language = resolveRouteLanguage(lang)

  return (
    <html lang={LANGUAGE_HTML_LANG[language]} data-theme="dark" data-app="imagej" suppressHydrationWarning>
      <body>
        <I18nProvider initialLanguage={language}>
          <ErrorBoundary>{children}</ErrorBoundary>
        </I18nProvider>
      </body>
    </html>
  )
}
