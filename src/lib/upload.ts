import type { SupportedLanguage } from '../i18n/config'

export interface FileLike {
  name: string
  type?: string | null
}

interface UploadCopy {
  upload: string
  add: string
  uploadButton: string
  addButton: string
  importTitle: string
  importDescription: string
  overlayBadge: string
  overlayTitle: string
  heroTitle: string
  heroSubtitle: string
  sampleButton: string
  sampleTitle: string
  sampleDescription: string
  proofPoints: string[]
}

const uploadCopy: Record<SupportedLanguage, UploadCopy> = {
  'zh-CN': {
    upload: '拖拽一个或多个 CSV / Excel 到页面任意位置，或点击上传',
    add: '拖拽一个或多个 CSV / Excel 到页面任意位置，或点击添加',
    uploadButton: '上传数据',
    addButton: '添加数据',
    importTitle: '导入数据',
    importDescription: '支持一次导入多个 CSV 或 Excel 文件。',
    overlayBadge: '拖拽上传',
    overlayTitle: '把 CSV / Excel 拖到这里，松开后自动出图',
    heroTitle: '把 CSV 拖进来，立刻出图',
    heroSubtitle: '支持直接拖拽或点击上传。导入后自动生成图表，可以继续复制或下载。',
    sampleButton: '查看示例数据',
    sampleTitle: '示例数据',
    sampleDescription: '内置一份 CSV 示例，可直接载入。',
    proofPoints: ['支持 CSV / Excel', '本地处理', '一键复制图片', '无需注册'],
  },
  en: {
    upload: 'Drag one or more CSV or Excel files anywhere on the page, or click Upload',
    add: 'Drag one or more CSV or Excel files anywhere on the page, or click Add',
    uploadButton: 'Upload Data',
    addButton: 'Add Data',
    importTitle: 'Import Data',
    importDescription: 'Import one or more CSV or Excel files to start.',
    overlayBadge: 'Drop to import',
    overlayTitle: 'Drop your CSV or Excel file here to generate the chart',
    heroTitle: 'Drop in a CSV and get a chart instantly',
    heroSubtitle: 'Drag a file in or click upload. joplot builds the chart for you right away.',
    sampleButton: 'Open sample data',
    sampleTitle: 'Sample data',
    sampleDescription: 'Load the built-in CSV example.',
    proofPoints: ['CSV / Excel ready', 'Local-first', 'Copy-ready images', 'No signup'],
  },
  'ja-JP': {
    upload: '1 件以上の CSV / Excel をページ上の任意の場所にドロップするか、アップロードをクリックしてください',
    add: '1 件以上の CSV / Excel をページ上の任意の場所にドロップするか、追加をクリックしてください',
    uploadButton: 'データをアップロード',
    addButton: 'データを追加',
    importTitle: 'データを取り込む',
    importDescription: 'CSV または Excel ファイルをまとめて取り込めます。',
    overlayBadge: 'ドラッグして読み込み',
    overlayTitle: 'ここに CSV / Excel をドロップすると自動でグラフ化します',
    heroTitle: 'CSV をドラッグすると、すぐにグラフ化',
    heroSubtitle: 'ドラッグして読み込むか、アップロードをクリックするだけで自動でグラフを作成します。',
    sampleButton: 'サンプルデータを見る',
    sampleTitle: 'サンプルデータ',
    sampleDescription: '内蔵の CSV サンプルを読み込みます。',
    proofPoints: ['CSV / Excel 対応', 'ローカル処理', '画像をすぐコピー', '登録不要'],
  },
}

export const ACCEPTED_UPLOAD_TYPES = '.csv,.xlsx,.xls'

const spreadsheetMimeTypes = new Set([
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroenabled.12',
])

export function isCsvLikeFile(file: FileLike): boolean {
  const fileName = file.name.trim().toLowerCase()
  const mimeType = file.type?.trim().toLowerCase()

  return fileName.endsWith('.csv')
    || fileName.endsWith('.xlsx')
    || fileName.endsWith('.xls')
    || (mimeType ? spreadsheetMimeTypes.has(mimeType) : false)
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
  const copy = uploadCopy[language]

  return hasDataset ? copy.add : copy.upload
}

export function getUploadCopy(language: SupportedLanguage = 'zh-CN') {
  return uploadCopy[language]
}
