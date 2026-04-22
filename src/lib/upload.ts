export interface FileLike {
  name: string
  type?: string | null
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

export function buildUploadHint(hasDataset: boolean): string {
  return hasDataset
    ? '拖拽一个或多个 CSV 到页面任意位置，或点击添加'
    : '拖拽一个或多个 CSV 到页面任意位置，或点击上传'
}
