import type { SuperColumn, SuperDataset, SuperNumericColumn, SuperStringColumn } from '../types.ts'

/** 判定一个数值列前需要采样的行数。 */
const CLASSIFY_SAMPLE_ROWS = 512
/** 采样列中数值占比达到该阈值才判定为数值列。 */
const NUMERIC_THRESHOLD = 0.8
/** 每个 chunk 单次同步处理的最大行数，避免长任务阻塞主线程。 */
const CHUNK_LINE_BUDGET = 40000

export interface SuperDatasetMeta {
  id: string
  fileName: string
  fileSize?: number
}

export interface ParseProgress {
  rows: number
  bytesProcessed: number
  bytesTotal: number
}

export interface ReadSuperDatasetOptions {
  onProgress?: (progress: ParseProgress) => void
  signal?: AbortSignal
}

export function toSuperDatasetId(fileName: string): string {
  const base = fileName
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return base || 'dataset'
}

export function detectDelimiter(headerLine: string): string {
  const candidates = [',', '\t', ';', '|']
  let best = ','
  let bestCount = -1

  for (const candidate of candidates) {
    const count = headerLine.split(candidate).length - 1
    if (count > bestCount) {
      bestCount = count
      best = candidate
    }
  }

  return best
}

/** 逗号/制表符等分隔符切分，支持双引号包裹字段（含转义 ""）。 */
export function splitDelimitedLine(line: string, delimiter: string): string[] {
  if (!line.includes('"')) {
    return line.split(delimiter)
  }

  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
      continue
    }

    if (char === '"' && current.length === 0) {
      inQuotes = true
    } else if (char === delimiter) {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }

  fields.push(current)
  return fields
}

export function toFiniteNumber(field: string): number {
  if (field.length === 0) {
    return Number.NaN
  }

  const trimmed = field.trim()
  if (trimmed.length === 0) {
    return Number.NaN
  }

  const value = Number(trimmed)
  return Number.isFinite(value) ? value : Number.NaN
}

function isNumericSample(sample: string[][], columnIndex: number): boolean {
  let nonEmpty = 0
  let numeric = 0

  for (const row of sample) {
    const field = row[columnIndex]
    if (field === undefined) {
      continue
    }
    const trimmed = field.trim()
    if (trimmed === '') {
      continue
    }
    nonEmpty += 1
    if (Number.isFinite(Number(trimmed))) {
      numeric += 1
    }
  }

  return nonEmpty > 0 && numeric / nonEmpty >= NUMERIC_THRESHOLD
}

interface NumericBuilder {
  kind: 'number'
  name: string
  values: number[]
  missingCount: number
}

interface StringBuilder {
  kind: 'string'
  name: string
  values: string[]
}

type ColumnBuilder = NumericBuilder | StringBuilder

function createBuilder(name: string, numeric: boolean): ColumnBuilder {
  return numeric
    ? { kind: 'number', name, values: [], missingCount: 0 }
    : { kind: 'string', name, values: [] }
}

function pushField(builder: ColumnBuilder, field: string | undefined) {
  const value = field ?? ''

  if (builder.kind === 'number') {
    const parsed = toFiniteNumber(value)
    if (Number.isNaN(parsed)) {
      builder.missingCount += 1
    }
    builder.values.push(parsed)
  } else {
    builder.values.push(value)
  }
}

function finalizeNumericColumn(builder: NumericBuilder): SuperNumericColumn {
  const length = builder.values.length
  const values = new Float64Array(length)
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let valid = 0

  for (let i = 0; i < length; i += 1) {
    const value = builder.values[i]
    values[i] = value
    if (!Number.isNaN(value)) {
      valid += 1
      sum += value
      if (value < min) {
        min = value
      }
      if (value > max) {
        max = value
      }
    }
  }

  const missing = builder.missingCount > 0 ? new Uint8Array(length) : null
  if (missing) {
    for (let i = 0; i < length; i += 1) {
      missing[i] = Number.isNaN(values[i]) ? 1 : 0
    }
  }

  return {
    name: builder.name,
    kind: 'number',
    values,
    missing,
    validCount: valid,
    missingCount: length - valid,
    min: valid > 0 ? min : Number.NaN,
    max: valid > 0 ? max : Number.NaN,
    mean: valid > 0 ? sum / valid : Number.NaN,
  }
}

function finalizeStringColumn(builder: StringBuilder): SuperStringColumn {
  return { name: builder.name, kind: 'string', values: builder.values }
}

function median(values: number[]): number {
  if (values.length === 0) {
    return Number.NaN
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

interface TimeColumnInference {
  timeColumn: string | null
  sampleRate: number | null
}

const TIME_NAME_PATTERN = /(^|[^a-z])(t|time|sec|secs|second|seconds|timestamp|dt)([^a-z]|$)|时间|秒/i

export function inferTimeColumn(columns: SuperColumn[], rowCount: number): TimeColumnInference {
  const numericColumns = columns.filter(
    (column): column is SuperNumericColumn => column.kind === 'number' && column.validCount > 1,
  )

  const candidates = [
    ...numericColumns.filter((column) => TIME_NAME_PATTERN.test(column.name)),
    ...numericColumns.filter((column) => !TIME_NAME_PATTERN.test(column.name)),
  ]

  for (const column of candidates) {
    const sampleLimit = Math.min(rowCount, 4096)
    const deltas: number[] = []
    let previous = Number.NaN
    let increasing = 0
    let comparable = 0

    for (let i = 0; i < sampleLimit; i += 1) {
      const value = column.values[i]
      if (Number.isNaN(value)) {
        continue
      }
      if (!Number.isNaN(previous)) {
        const delta = value - previous
        if (delta !== 0) {
          comparable += 1
          deltas.push(Math.abs(delta))
          if (delta > 0) {
            increasing += 1
          }
        }
      }
      previous = value
    }

    if (comparable < 2) {
      continue
    }

    const monotonicRatio = increasing / comparable
    const step = median(deltas)

    if (monotonicRatio >= 0.95 && Number.isFinite(step) && step > 0) {
      return { timeColumn: column.name, sampleRate: 1 / step }
    }
  }

  return { timeColumn: null, sampleRate: null }
}

class DatasetAccumulator {
  private headers: string[] | null = null
  private delimiter = ','
  private builders: ColumnBuilder[] = []
  private sample: string[][] = []
  private classified = false
  private rowCount = 0
  private maxColumns = 0
  private readonly meta: SuperDatasetMeta

  constructor(meta: SuperDatasetMeta) {
    this.meta = meta
  }

  get rows(): number {
    return this.rowCount
  }

  pushLine(rawLine: string): void {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.length === 0) {
      return
    }

    if (!this.headers) {
      this.delimiter = detectDelimiter(line)
      this.headers = splitDelimitedLine(line, this.delimiter).map((header, index) => {
        const trimmed = header.trim()
        return trimmed.length > 0 ? trimmed : `column_${index + 1}`
      })
      this.builders = this.headers.map((name) => createBuilder(name, false))
      return
    }

    const fields = splitDelimitedLine(line, this.delimiter)
    if (fields.length > this.maxColumns) {
      this.maxColumns = fields.length
    }

    if (!this.classified) {
      this.sample.push(fields)
      if (this.sample.length >= CLASSIFY_SAMPLE_ROWS) {
        this.classify()
      }
    } else {
      this.appendRow(fields)
    }

    this.rowCount += 1
  }

  private classify(): void {
    const headers = this.headers ?? []
    this.builders = headers.map((name, index) =>
      createBuilder(name, isNumericSample(this.sample, index)),
    )
    for (const row of this.sample) {
      this.appendRow(row)
    }
    this.sample = []
    this.classified = true
  }

  private appendRow(fields: string[]): void {
    for (let i = 0; i < this.builders.length; i += 1) {
      pushField(this.builders[i], fields[i])
    }
  }

  finish(): SuperDataset {
    if (!this.classified) {
      this.classify()
    }

    const headers = this.headers ?? []
    const columns: SuperColumn[] = this.builders.map((builder) =>
      builder.kind === 'number' ? finalizeNumericColumn(builder) : finalizeStringColumn(builder),
    )

    // 补齐短行导致的列长度不一致
    for (const column of columns) {
      const length = column.values.length
      if (length >= this.rowCount) {
        continue
      }
      if (column.kind === 'number') {
        const padded = new Float64Array(this.rowCount)
        padded.fill(Number.NaN)
        padded.set(column.values, 0)
        column.values = padded
        column.missing = new Uint8Array(this.rowCount)
        column.missing.fill(1, length)
        column.missingCount += this.rowCount - length
      } else {
        while (column.values.length < this.rowCount) {
          column.values.push('')
        }
      }
    }

    const numericColumns = columns
      .filter((column): column is SuperNumericColumn => column.kind === 'number')
      .map((column) => column.name)
    const { timeColumn, sampleRate } = inferTimeColumn(columns, this.rowCount)

    return {
      id: this.meta.id,
      fileName: this.meta.fileName,
      headers,
      columns,
      rowCount: this.rowCount,
      numericColumns,
      timeColumn,
      sampleRate,
      fileSize: this.meta.fileSize ?? 0,
      createdAt: Date.now(),
    }
  }
}

/** 纯函数版本：把整段 CSV 文本解析为列式数据集（用于测试与回退路径）。 */
export function parseDelimitedText(text: string, meta: SuperDatasetMeta): SuperDataset {
  const accumulator = new DatasetAccumulator(meta)
  let start = 0

  while (start <= text.length) {
    const next = text.indexOf('\n', start)
    if (next === -1) {
      if (start < text.length) {
        accumulator.pushLine(text.slice(start))
      }
      break
    }
    accumulator.pushLine(text.slice(start, next))
    start = next + 1
  }

  return accumulator.finish()
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/**
 * 以流式方式读取文件并按列累积，按时让出主线程，避免大文件导入时界面卡死。
 */
export async function readSuperDataset(
  file: File,
  options: ReadSuperDatasetOptions & { id?: string } = {},
): Promise<SuperDataset> {
  const meta: SuperDatasetMeta = {
    id: options.id ?? toSuperDatasetId(file.name),
    fileName: file.name,
    fileSize: file.size,
  }

  if (typeof file.stream !== 'function') {
    const text = await file.text()
    return parseDelimitedText(text, meta)
  }

  const accumulator = new DatasetAccumulator(meta)
  const reader = file.stream().getReader()
  const decoder = new TextDecoder('utf-8')
  let carry = ''
  let bytesProcessed = 0
  let linesSinceYield = 0
  let lastYield = Date.now()

  const consume = (text: string) => {
    carry += text
    let newlineIndex = carry.indexOf('\n')

    while (newlineIndex !== -1) {
      accumulator.pushLine(carry.slice(0, newlineIndex))
      carry = carry.slice(newlineIndex + 1)
      linesSinceYield += 1
      newlineIndex = carry.indexOf('\n')
    }
  }

  try {
    for (;;) {
      if (options.signal?.aborted) {
        throw new Error('aborted')
      }

      const { done, value } = await reader.read()
      if (done) {
        break
      }

      bytesProcessed += value.byteLength
      consume(decoder.decode(value, { stream: true }))

      const now = Date.now()
      if (linesSinceYield >= CHUNK_LINE_BUDGET || now - lastYield >= 40) {
        options.onProgress?.({ rows: accumulator.rows, bytesProcessed, bytesTotal: file.size })
        linesSinceYield = 0
        lastYield = now
        await yieldToMainThread()
      }
    }
  } finally {
    reader.releaseLock()
  }

  consume(decoder.decode())
  if (carry.length > 0) {
    accumulator.pushLine(carry)
  }

  options.onProgress?.({ rows: accumulator.rows, bytesProcessed, bytesTotal: file.size })
  return accumulator.finish()
}
