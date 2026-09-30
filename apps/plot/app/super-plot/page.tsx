import type { Metadata } from 'next'
import type { SupportedLanguage } from '../../src/i18n/config'
import { getRequestLanguage } from '../../src/lib/requestLanguage'
import { SuperPlotApp } from '../../src/superplot/components/SuperPlotApp'
import { resolveSuperPlotLanguage } from '../../src/superplot/lib/i18n'

const LOCALIZED_METADATA: Record<SupportedLanguage, { title: string; description: string }> = {
  'zh-CN': {
    title: 'super-plot · 大数波形与 FFT 频谱实验台',
    description: '本地优先的百万行 CSV 波形浏览与 FFT 频谱分析实验台。',
  },
  en: {
    title: 'super-plot · large-data waveform & FFT spectrum lab',
    description: 'Local-first million-row CSV waveform viewer with FFT spectrum analysis.',
  },
  'ja-JP': {
    title: 'super-plot · 大規模波形と FFT スペクトラム実験台',
    description: 'ローカル優先の百万行 CSV 波形ビューアと FFT スペクトラム解析実験台。',
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

export default async function SuperPlotPage() {
  const language = await getRequestLanguage()

  return <SuperPlotApp language={resolveSuperPlotLanguage(language)} />
}
