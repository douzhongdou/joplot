import type { SupportedLanguage } from '../i18n/config'

export type SampleDatasetId = 'sales' | 'stock' | 'traffic' | 'sensor'

interface SampleDatasetDefinition {
  id: SampleDatasetId
  fileName: string
  path: string
  labels: Record<SupportedLanguage, string>
  descriptions: Record<SupportedLanguage, string>
}

interface SampleDatasetCopy {
  id: SampleDatasetId
  fileName: string
  path: string
  label: string
  description: string
}

interface SampleFetchResponse {
  ok: boolean
  text: () => Promise<string>
}

type SampleFetch = (input: string) => Promise<SampleFetchResponse>

export const SAMPLE_DATASETS: SampleDatasetDefinition[] = [
  {
    id: 'sales',
    fileName: 'sales.csv',
    path: '/samples/sales.csv',
    labels: {
      'zh-CN': '销售',
      en: 'Sales',
      'ja-JP': '売上',
    },
    descriptions: {
      'zh-CN': '月度营收与订单趋势',
      en: 'Monthly revenue and order trend',
      'ja-JP': '月次売上と注文数の推移',
    },
  },
  {
    id: 'stock',
    fileName: 'stock.csv',
    path: '/samples/stock.csv',
    labels: {
      'zh-CN': '股票',
      en: 'Stock',
      'ja-JP': '株価',
    },
    descriptions: {
      'zh-CN': '收盘价与成交量走势',
      en: 'Closing price and volume trend',
      'ja-JP': '終値と出来高の推移',
    },
  },
  {
    id: 'traffic',
    fileName: 'traffic.csv',
    path: '/samples/traffic.csv',
    labels: {
      'zh-CN': '流量',
      en: 'Traffic',
      'ja-JP': 'トラフィック',
    },
    descriptions: {
      'zh-CN': '访问量与注册转化',
      en: 'Visits and signup conversion',
      'ja-JP': '訪問数と登録転換',
    },
  },
  {
    id: 'sensor',
    fileName: 'sensor.csv',
    path: '/samples/sensor.csv',
    labels: {
      'zh-CN': '传感器',
      en: 'Sensor',
      'ja-JP': 'センサー',
    },
    descriptions: {
      'zh-CN': '温度与湿度监测',
      en: 'Temperature and humidity monitoring',
      'ja-JP': '温度と湿度のモニタリング',
    },
  },
]

function findSampleDataset(id: SampleDatasetId) {
  const sample = SAMPLE_DATASETS.find((item) => item.id === id)

  if (!sample) {
    throw new Error(`Unknown sample dataset: ${id}`)
  }

  return sample
}

export function getSampleDatasetCopy(language: SupportedLanguage = 'zh-CN'): SampleDatasetCopy[] {
  return SAMPLE_DATASETS.map((item) => ({
    id: item.id,
    fileName: item.fileName,
    path: item.path,
    label: item.labels[language],
    description: item.descriptions[language],
  }))
}

export async function loadSampleDatasetFile(
  id: SampleDatasetId,
  fetchImpl: SampleFetch = (input) => fetch(input) as Promise<SampleFetchResponse>,
) {
  const sample = findSampleDataset(id)
  const response = await fetchImpl(sample.path)

  if (!response.ok) {
    throw new Error(`Failed to load sample dataset: ${sample.id}`)
  }

  const text = await response.text()

  return new File([text], sample.fileName, { type: 'text/csv' })
}
