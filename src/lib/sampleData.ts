import type { SupportedLanguage } from '../i18n/config'

export type SampleDatasetId = 'demo'

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
    id: 'demo',
    fileName: 'demo.csv',
    path: '/samples/demo.csv',
    labels: {
      'zh-CN': '查看示例数据',
      en: 'Open sample data',
      'ja-JP': 'サンプルデータを見る',
    },
    descriptions: {
      'zh-CN': '加载一份内置 CSV 示例',
      en: 'Load the built-in CSV example',
      'ja-JP': '内蔵 CSV サンプルを読み込む',
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
