/**
 * FITS 头部解析：把 80 字符卡片的序列解析成可查询的键值表。
 *
 * FITS 头由若干 2880 字节块组成，每块 36 张、每张 80 字符的卡片；卡片以 `END` 结束，
 * 之后用空格补齐到块边界。卡片有两种形态：
 * - 带值：`KEYWORD = value / comment`，值可为单引号字符串、逻辑 T/F、整数 / 浮点。
 * - 无值：`COMMENT ...` / `HISTORY ...` 等，第 9 列不是 `=`。
 *
 * 本模块只负责「单张卡片 / 一组卡片」的解析，跨块读取与 `END` 定位由 `index.ts` 完成，
 * 因此可以在 Node 测试里直接用字节构造用例，不依赖 Blob。
 */

/** 一个 FITS 头块固定 2880 字节。 */
export const FITS_BLOCK_BYTES = 2880

/** 一张 FITS 卡片固定 80 字符。 */
export const FITS_CARD_BYTES = 80

export type FitsValue = string | number | boolean

export interface FitsCard {
  /** 前 8 列、去掉两侧空格后的关键字。 */
  keyword: string
  /** 解析出的值；无值卡（COMMENT 等）为 undefined。 */
  value?: FitsValue
  /** `/` 之后的注释；无注释时为 undefined。 */
  comment?: string
  /** 原始 80 字符，便于调试与回放。 */
  raw: string
}

/** 头部键值查询表。关键字按出现顺序保留，重复关键字以最后一个为准（FITS 少见）。 */
export class FitsHeader {
  readonly cards: readonly FitsCard[]
  private readonly byKeyword: Map<string, FitsCard>

  constructor(cards: readonly FitsCard[]) {
    this.cards = cards
    this.byKeyword = new Map()
    for (const card of cards) this.byKeyword.set(card.keyword, card)
  }

  get(keyword: string): FitsCard | undefined {
    return this.byKeyword.get(keyword)
  }

  has(keyword: string): boolean {
    return this.byKeyword.has(keyword)
  }

  /** 取数值；缺失或非数值时返回 undefined。 */
  number(keyword: string): number | undefined {
    const value = this.get(keyword)?.value
    return typeof value === 'number' ? value : undefined
  }

  /** 取字符串；缺失或非字符串时返回 undefined。 */
  string(keyword: string): string | undefined {
    const value = this.get(keyword)?.value
    return typeof value === 'string' ? value : undefined
  }

  /** 取逻辑值；缺失或非逻辑时返回 undefined。 */
  bool(keyword: string): boolean | undefined {
    const value = this.get(keyword)?.value
    return typeof value === 'boolean' ? value : undefined
  }
}

/** 判断一张卡片是否为头部结束标记。 */
export function isEndCard(text: string): boolean {
  return text.slice(0, 8).trim() === 'END'
}

/** 解析单张 80 字符卡片；空白卡返回 null。 */
export function parseFitsCard(text: string): FitsCard | null {
  if (!text.trim()) return null
  const keyword = text.slice(0, 8).trim()
  if (!keyword) return null
  // 第 9 列（下标 8）不是 '=' 即无值卡。
  if (text[8] !== '=') {
    const comment = text.slice(8).trim()
    return { keyword, comment: comment || undefined, raw: text }
  }
  const { value, comment } = parseValueAndComment(text.slice(9))
  return { keyword, value, comment, raw: text }
}

/** 解析 `= ` 之后的 `value / comment`。 */
function parseValueAndComment(body: string): { value?: FitsValue; comment?: string } {
  let index = 0
  while (index < body.length && body[index] === ' ') index += 1

  if (body[index] === "'") {
    // 字符串：到下一个未转义单引号；`''` 表示一个单引号。
    let out = ''
    index += 1
    while (index < body.length) {
      const ch = body[index]!
      if (ch === "'") {
        if (body[index + 1] === "'") {
          out += "'"
          index += 2
          continue
        }
        index += 1
        break
      }
      out += ch
      index += 1
    }
    const value = out.replace(/ *$/, '')
    const comment = commentAfter(body.slice(index))
    return { value, comment }
  }

  const slash = body.indexOf('/')
  const token = (slash >= 0 ? body.slice(0, slash) : body).trim()
  return { value: parseScalar(token), comment: commentAfter(slash >= 0 ? body.slice(slash) : '') }
}

function commentAfter(rest: string): string | undefined {
  const slash = rest.indexOf('/')
  if (slash < 0) return undefined
  return rest.slice(slash + 1).trim() || undefined
}

/** 标量：逻辑 T/F、数字，其余原样保留为字符串（如复数表示）。 */
function parseScalar(token: string): FitsValue | undefined {
  if (token === 'T') return true
  if (token === 'F') return false
  if (!token) return undefined
  const numeric = Number(token)
  return Number.isFinite(numeric) ? numeric : token
}
