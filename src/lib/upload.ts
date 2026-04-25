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
    overlayBadge: '数据上传',
    overlayTitle: '释放以上传一个或多个 CSV 或 Excel 文件',
    heroTitle: '把表格变成能直接分享的图表',
    heroSubtitle: '无需注册，上传 CSV 或 Excel 后立即出图，并可直接复制或下载。',
    sampleButton: '试试示例数据',
    sampleTitle: '没有文件也能立刻开始',
    sampleDescription: '直接载入一份示例数据，看看 joplot 能如何自动出图。',
    proofPoints: ['支持 CSV / Excel', '本地处理', '一键复制图片', '无需注册'],
  },
  en: {
    upload: 'Drag one or more CSV or Excel files anywhere on the page, or click Upload',
    add: 'Drag one or more CSV or Excel files anywhere on the page, or click Add',
    uploadButton: 'Upload Data',
    addButton: 'Add Data',
    importTitle: 'Import Data',
    importDescription: 'Import one or more CSV or Excel files to start.',
    overlayBadge: 'Data Upload',
    overlayTitle: 'Drop to upload one or more CSV or Excel files',
    heroTitle: 'Turn spreadsheets into charts you can share right away',
    heroSubtitle: 'No signup needed. Upload a CSV or Excel file, get a chart instantly, then copy or download it.',
    sampleButton: 'Try sample data',
    sampleTitle: 'Start even if you do not have a file yet',
    sampleDescription: 'Load a sample dataset and see how joplot builds a chart for you automatically.',
    proofPoints: ['CSV / Excel ready', 'Local-first', 'Copy-ready images', 'No signup'],
  },
  'ja-JP': {
    upload: '1 件以上の CSV / Excel をページ上の任意の場所にドロップするか、アップロードをクリックしてください',
    add: '1 件以上の CSV / Excel をページ上の任意の場所にドロップするか、追加をクリックしてください',
    uploadButton: 'データをアップロード',
    addButton: 'データを追加',
    importTitle: 'データを取り込む',
    importDescription: 'CSV または Excel ファイルをまとめて取り込めます。',
    overlayBadge: 'データアップロード',
    overlayTitle: 'ドロップして 1 件以上の CSV / Excel ファイルをアップロード',
    heroTitle: '表計算ファイルをそのまま共有しやすいグラフに変える',
    heroSubtitle: '登録不要。CSV や Excel をアップロードすると、すぐにグラフ化してコピーまたはダウンロードできます。',
    sampleButton: 'サンプルデータを試す',
    sampleTitle: '手元にファイルがなくてもすぐ始められる',
    sampleDescription: 'サンプルデータを読み込み、joplot が自動でグラフを作る流れをすぐ試せます。',
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
