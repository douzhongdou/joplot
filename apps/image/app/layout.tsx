import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import type { SupportedLanguage } from '@joplot/i18n/config'
import { ErrorBoundary } from '../src/components/ErrorBoundary'
import { I18nProvider } from '../src/i18n'
import { LANGUAGE_HTML_LANG } from '../src/i18n/config'
import { getRequestLanguage } from '../src/lib/requestLanguage'
import './globals.css'

const LOCALIZED_METADATA: Record<SupportedLanguage, { title: string; description: string }> = {
  'zh-CN': {
    title: 'joplot imagej · 浏览器图像工作台',
    description: '纯本地的 8 位灰度图像处理：阈值与 Otsu 自动阈值、3×3 滤波、裁剪翻转、直方图与 ROI 测量。',
  },
  en: {
    title: 'joplot imagej · in-browser image workspace',
    description: 'Local-only 8-bit grayscale image processing: threshold and Otsu, 3x3 filters, crop and flips, histogram and ROI measurements.',
  },
  'ja-JP': {
    title: 'joplot imagej · ブラウザ画像ワークベンチ',
    description: 'ローカル完結の 8bit グレースケール画像処理：しきい値と Otsu、3×3 フィルタ、切り抜き・反転、ヒストグラムと ROI 測定。',
  },
}

export async function generateMetadata(): Promise<Metadata> {
  const localized = LOCALIZED_METADATA[await getRequestLanguage()]

  return {
    title: localized.title,
    description: localized.description,
    robots: { index: false, follow: false },
  }
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  const language = await getRequestLanguage()

  return (
    <html lang={LANGUAGE_HTML_LANG[language]} suppressHydrationWarning>
      <body>
        <I18nProvider initialLanguage={language}>
          <ErrorBoundary>{children}</ErrorBoundary>
        </I18nProvider>
      </body>
    </html>
  )
}
