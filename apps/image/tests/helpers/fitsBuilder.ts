/**
 * 测试用的 FITS 文件构造器。
 *
 * 按 FITS 规范生成「2880 字节对齐的头块 + 大端数据段」，用于验证 `fits/` 的头部解析、
 * HDU 索引与像素解码。数据以字节数组给出，方便自行构造大端整数 / 浮点与截断样本。
 */

const BLOCK = 2880
const CARD = 80

/** 生成一张 80 字符卡片；值可为逻辑 / 数字 / 字符串。 */
export function fitsCard(keyword: string, value?: string | number | boolean, comment?: string): string {
  const head = keyword.padEnd(8)
  let body: string
  if (value === undefined) {
    body = comment ? `${head} ${comment}` : head
  } else {
    body = `${head}= ${formatValue(value)}`
    if (comment) body += ` / ${comment}`
  }
  if (body.length > CARD) throw new Error(`FITS 卡片超长：${body}`)
  return body.padEnd(CARD)
}

function formatValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'T' : 'F'
  if (typeof value === 'number') return String(value)
  return `'${value.replace(/'/g, "''")}'`
}

/** 组装头块：卡片 + END，并补齐到 2880 边界。 */
export function fitsHeader(cards: readonly string[]): Uint8Array<ArrayBuffer> {
  const all = [...cards, fitsCard('END')]
  const bytes = new Uint8Array(Math.ceil((all.length * CARD) / BLOCK) * BLOCK)
  bytes.fill(0x20)
  all.forEach((card, index) => {
    for (let i = 0; i < CARD; i += 1) bytes[index * CARD + i] = card.charCodeAt(i) & 0xff
  })
  return bytes
}

export interface BuildFitsHdu {
  bitpix: number
  /** `[NAXIS1, NAXIS2, …]`；空数组表示 NAXIS=0（无数据主头）。 */
  naxis: readonly number[]
  /** 大端像素字节（未补齐）。 */
  data?: Uint8Array
  /** 额外卡片，如 BSCALE / BZERO / BLANK。 */
  cards?: readonly string[]
  /** 扩展 HDU 的 XTENSION 类型。 */
  xtension?: string
  /** 省略 SIMPLE 卡（用于扩展 HDU）。 */
  simple?: boolean
  /** 数据补齐字节，默认 0。 */
  padByte?: number
}

/** 生成完整的 FITS 文件字节（可含多个 HDU）。 */
export function buildFitsBytes(hdus: readonly BuildFitsHdu[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = []
  for (const hdu of hdus) {
    const cards: string[] = []
    if (hdu.simple !== false) cards.push(fitsCard('SIMPLE', true, 'conforms to FITS'))
    if (hdu.xtension) cards.push(fitsCard('XTENSION', hdu.xtension))
    cards.push(fitsCard('BITPIX', hdu.bitpix))
    cards.push(fitsCard('NAXIS', hdu.naxis.length))
    hdu.naxis.forEach((length, index) => cards.push(fitsCard(`NAXIS${index + 1}`, length)))
    if (hdu.cards) cards.push(...hdu.cards)
    parts.push(fitsHeader(cards))

    const data = hdu.data ?? new Uint8Array(0)
    if (data.length > 0) {
      parts.push(data)
      const pad = Math.ceil(data.length / BLOCK) * BLOCK - data.length
      if (pad > 0) parts.push(new Uint8Array(pad).fill(hdu.padByte ?? 0))
    }
  }
  return concat(parts)
}

/** 大端有符号 16 位。 */
export function beInt16(values: readonly number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(values.length * 2)
  const view = new DataView(out.buffer)
  values.forEach((value, index) => view.setInt16(index * 2, value, false))
  return out
}

/** 大端有符号 32 位。 */
export function beInt32(values: readonly number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(values.length * 4)
  const view = new DataView(out.buffer)
  values.forEach((value, index) => view.setInt32(index * 4, value, false))
  return out
}

/** 大端 32 位浮点。 */
export function beFloat32(values: readonly number[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(values.length * 4)
  const view = new DataView(out.buffer)
  values.forEach((value, index) => view.setFloat32(index * 4, value, false))
  return out
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
