import type { SupportedLanguage } from '../i18n/config'

export interface FileLike {
  name: string
  type?: string | null
}

const uploadHints: Record<SupportedLanguage, { upload: string; add: string }> = {
  'zh-CN': {
    upload: '拖拽一个或多个 CSV 到页面任意位置，或点击上传',
    add: '拖拽一个或多个 CSV 到页面任意位置，或点击添加',
  },
  en: {
    upload: 'Drag one or more CSV files anywhere on the page, or click Upload',
    add: 'Drag one or more CSV files anywhere on the page, or click Add',
  },
  'ja-JP': {
    upload: '1 件以上の CSV をページ上の任意の場所にドラッグするか、アップロードをクリックしてください',
    add: '1 件以上の CSV をページ上の任意の場所にドラッグするか、追加をクリックしてください',
  },
}

export function isCsvLikeFile(file: FileLike): boolean {
  const fileName = file.name.trim().toLowerCase()
  const mimeType = file.type?.trim().toLowerCase()

  return fileName.endsWith('.csv') || mimeType === 'text/csv'
}

export function pickCsvFiles<T extends FileLike>(files: Iterable<T>): T[] {
  return Array.from(files).filter((file) => isCsvLikeFile(file))
}

export function pickFirstCsvFile<T extends FileLike>(files: Iterable<T>): T | null {
  return pickCsvFiles(files)[0] ?? null
}

export function buildUploadHint(
  hasDataset: boolean,
  language: SupportedLanguage = 'zh-CN',
): string {
  const copy = uploadHints[language]

  return hasDataset ? copy.add : copy.upload
}
