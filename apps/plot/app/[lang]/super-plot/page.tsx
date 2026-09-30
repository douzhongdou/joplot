import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ErrorBoundary } from '../../../src/components/ErrorBoundary'
import { I18nProvider } from '../../../src/i18n'
import { resolveSupportedLanguageFromRouteLanguage } from '../../../src/i18n/config'
import { SuperPlotApp } from '../../../src/superplot/components/SuperPlotApp'
import { resolveSuperPlotLanguage } from '../../../src/superplot/lib/i18n'

export function generateStaticParams() {
  return [{ lang: 'en' }, { lang: 'zh' }, { lang: 'ja' }]
}

const LOCALIZED_METADATA: Record<string, { title: string; description: string }> = {
  zh: {
    title: 'super-plot · 大数波形与 FFT 频谱实验台',
    description: '本地优先的百万行 CSV 波形浏览与 FFT 频谱分析实验台。',
  },
  en: {
    title: 'super-plot · large-data waveform & FFT spectrum lab',
    description: 'Local-first million-row CSV waveform viewer with FFT spectrum analysis.',
  },
  ja: {
    title: 'super-plot · 大規模波形と FFT スペクトラム実験台',
    description: 'ローカル優先の百万行 CSV 波形ビューアと FFT スペクトラム解析実験台。',
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

export default async function SuperPlotPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const supported = resolveSupportedLanguageFromRouteLanguage(lang)

  if (!supported) {
    notFound()
  }

  return (
    <I18nProvider initialLanguage={supported}>
      <ErrorBoundary>
        <SuperPlotApp language={resolveSuperPlotLanguage(lang)} routeLanguage={lang} />
      </ErrorBoundary>
    </I18nProvider>
  )
}
