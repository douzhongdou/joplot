import type { Metadata } from 'next'
import type { SupportedLanguage } from '../../src/i18n/config'
import { getRequestLanguage } from '../../src/lib/requestLanguage'
import { ScienceApp } from '../../src/science/components/ScienceApp'
import { resolveScienceLanguage } from '../../src/science/lib/i18n'

const LOCALIZED_METADATA: Record<SupportedLanguage, { title: string; description: string }> = {
  'zh-CN': {
    title: 'joplot science · 科学处理工作台',
    description: '浏览器内科学数据处理：平滑、去趋势、FFT、曲线拟合与描述统计。',
  },
  en: {
    title: 'joplot science · scientific workspace',
    description: 'In-browser scientific data processing: smoothing, detrend, FFT, curve fitting and statistics.',
  },
  'ja-JP': {
    title: 'joplot science · 科学データワークスペース',
    description: 'ブラウザ内の科学データ処理：平滑化、トレンド除去、FFT、曲線フィット、記述統計。',
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

export default async function SciencePage() {
  const language = await getRequestLanguage()

  return <ScienceApp language={resolveScienceLanguage(language)} />
}
