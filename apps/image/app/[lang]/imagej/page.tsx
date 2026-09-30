import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ErrorBoundary } from '../../../src/components/ErrorBoundary'
import { I18nProvider } from '../../../src/i18n'
import { resolveSupportedLanguageFromRouteLanguage } from '../../../src/i18n/config'
import { ImageJApp } from '../../../src/imagej/components/ImageJApp'

export function generateStaticParams() {
  return [{ lang: 'en' }, { lang: 'zh' }, { lang: 'ja' }]
}

const LOCALIZED_METADATA: Record<string, { title: string; description: string }> = {
  zh: {
    title: 'joplot imagej · 浏览器图像工作台',
    description: '纯本地的 8 位灰度图像处理：阈值与 Otsu 自动阈值、3×3 滤波、裁剪翻转、直方图与 ROI 测量。',
  },
  en: {
    title: 'joplot imagej · in-browser image workspace',
    description: 'Local-only 8-bit grayscale image processing: threshold and Otsu, 3x3 filters, crop and flips, histogram and ROI measurements.',
  },
  ja: {
    title: 'joplot imagej · ブラウザ画像ワークベンチ',
    description: 'ローカル完結の 8bit グレースケール画像処理：しきい値と Otsu、3×3 フィルタ、切り抜き・反転、ヒストグラムと ROI 測定。',
  },
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<Metadata> {
  const { lang } = await params
  const localized = LOCALIZED_METADATA[lang] ?? LOCALIZED_METADATA.en

  return {
    title: localized.title,
    description: localized.description,
    robots: { index: false, follow: false },
  }
}

export default async function ImagejPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const supported = resolveSupportedLanguageFromRouteLanguage(lang)

  if (!supported) {
    notFound()
  }

  return (
    <I18nProvider initialLanguage={supported}>
      <ErrorBoundary>
        <ImageJApp />
      </ErrorBoundary>
    </I18nProvider>
  )
}
