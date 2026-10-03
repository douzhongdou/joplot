/**
 * 解析拖放内容：散落文件 → 多个 tab；文件夹（含子目录）→ 一个 Stack 的来源列表。
 *
 * 用 `DataTransferItem.webkitGetAsEntry()` 递归读取目录（这是浏览器里唯一能拿到
 * 「文件夹」这一信息的接口；`dataTransfer.files` 对文件夹只会给出一个空条目）。
 * 框架无关，便于在 Node 测试里用假的 entry 树覆盖目录遍历与回退分支。
 */

/** 结构化的 entry 视图，兼容 DOM 的 FileSystemEntry 子类型。 */
export type DropEntry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?(success: (file: File) => void, error?: (error: unknown) => void): void
  createReader?(): { readEntries(success: (entries: DropEntry[]) => void, error?: (error: unknown) => void): void }
}

/** 结构化视图，兼容 DOM 的 DataTransfer（items 是 DataTransferItemList，files 是 FileList）。 */
export type DropSource = {
  readonly items?: ArrayLike<{ readonly kind: string; webkitGetAsEntry?(): DropEntry | null }>
  readonly files?: ArrayLike<File>
}

export interface DroppedContent {
  files: File[]
  folders: { name: string; files: File[] }[]
}

function toArray<T>(list: ArrayLike<T> | undefined): T[] {
  return list ? Array.from({ length: list.length }, (_, index) => list[index]!) : []
}

function entryFile(entry: DropEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) { reject(new Error('拖放条目不是文件')); return }
    entry.file(resolve, reject)
  })
}

/** 递归读取一个目录的所有文件（`readEntries` 分批返回，需读到空批次为止）。 */
export async function readDirectory(dir: DropEntry): Promise<File[]> {
  const reader = dir.createReader?.()
  if (!reader) return []
  const out: File[] = []
  for (;;) {
    const batch = await new Promise<DropEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (!batch.length) break
    for (const entry of batch) {
      if (entry.isFile) out.push(await entryFile(entry))
      else if (entry.isDirectory) out.push(...await readDirectory(entry))
    }
  }
  return out
}

export async function readDroppedContent(data: DropSource): Promise<DroppedContent> {
  const entries = toArray(data.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is DropEntry => Boolean(entry))

  // 没有 entry（老浏览器或非目录拖放）时回退到 files 列表。
  if (entries.length === 0) return { files: toArray(data.files), folders: [] }

  const files: File[] = []
  const folders: { name: string; files: File[] }[] = []
  for (const entry of entries) {
    if (entry.isDirectory) folders.push({ name: entry.name, files: await readDirectory(entry) })
    else if (entry.isFile) files.push(await entryFile(entry))
  }
  return { files, folders }
}
