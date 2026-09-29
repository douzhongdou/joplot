import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolveSupportedLanguageFromRouteLanguage } from '../../../src/i18n/config'
import { ScienceApp } from '../../../src/science/components/ScienceApp'
import { ErrorBoundary } from '../../../src/components/ErrorBoundary'
import { I18nProvider } from '../../../src/i18n'
import { resolveScienceLanguage } from '../../../src/science/lib/i18n'

export function generateStaticParams() {
  return [{ lang: 'en' }, { lang: 'zh' }, { lang: 'ja' }]
}

const LOCALIZED_METADATA: Record<string, { title: string; description: string }> = {
  zh: {
    title: 'joplot science · 科学处理工作台',
    description: '浏览器内科学数据处理：平滑、去趋势、FFT、曲线拟合与描述统计。',
  },
  en: {
    title: 'joplot science · scientific workspace',
    description: 'In-browser scientific data processing: smoothing, detrend, FFT, curve fitting and statistics.',
  },
  ja: {
    title: 'joplot science · 科学データワークスペース',
    description: 'ブラウザ内の科学データ処理：平滑化、トレンド除去、FFT、曲線フィット、記述統計。',
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

export default async function SciencePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const supported = resolveSupportedLanguageFromRouteLanguage(lang)

  if (!supported) {
    notFound()
  }

  return (
    <I18nProvider initialLanguage={supported}>
      <ErrorBoundary>
        <ScienceApp language={resolveScienceLanguage(lang)} />
      </ErrorBoundary>
    </I18nProvider>
  )
}
