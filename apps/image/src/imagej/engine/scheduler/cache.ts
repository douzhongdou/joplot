/**
 * P0/P2：按字节预算的 LRU 缓存（对应架构方案第 9 节内存预算）。
 *
 * 活跃数据在使用期间固定（pinned），其他条目按最近访问顺序淘汰。缓存键至少包含
 * 源版本、步骤版本、区域、输出类型与算法版本；缓存命中只用于加速，不决定撤销是否可用。
 */

export interface CacheStats {
  entries: number
  bytes: number
  pinnedBytes: number
  hits: number
  misses: number
  evictions: number
}

interface CacheEntry<T> {
  value: T
  bytes: number
  pinned: number
  lastAccess: number
}

export interface CacheKeyParts {
  sourceId: string
  sourceRevision: number
  /** 从源到该步骤的累计版本键。 */
  recipeKey: string
  /** 切片 / 区域描述。 */
  slice: string
  /** 输出语义，例如 result、display、stats。 */
  output: string
}

/** 结构化缓存键，避免手工拼接出错。 */
export function cacheKey(parts: CacheKeyParts): string {
  return [parts.sourceId, parts.sourceRevision, parts.recipeKey, parts.slice, parts.output].join('\u0001')
}

export class ByteCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()
  private readonly maxBytes: number
  private clock = 0
  private bytes = 0
  private hits = 0
  private misses = 0
  private evictions = 0

  constructor(maxBytes: number) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new RangeError('ByteCache maxBytes 必须为正数')
    this.maxBytes = maxBytes
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) {
      this.misses += 1
      return undefined
    }
    this.clock += 1
    entry.lastAccess = this.clock
    this.hits += 1
    return entry.value
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  /** 写入一个条目；若超预算则先淘汰。pin 表示活跃期间不允许淘汰。 */
  set(key: string, value: T, bytes: number, pinned = false): void {
    if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError('ByteCache 条目字节数非法')
    const previous = this.entries.get(key)
    if (previous) {
      this.bytes -= previous.bytes
      this.entries.delete(key)
    }
    // 单条超过整个预算时仍保留，但会立刻把其它条目挤出去。
    this.clock += 1
    this.entries.set(key, { value, bytes, pinned: pinned ? 1 : 0, lastAccess: this.clock })
    this.bytes += bytes
    this.evictIfNeeded()
  }

  /** 引用计数式固定 / 取消固定；固定为 0 后条目可被淘汰。 */
  pin(key: string): void {
    const entry = this.entries.get(key)
    if (entry) entry.pinned += 1
  }

  unpin(key: string): void {
    const entry = this.entries.get(key)
    if (entry) entry.pinned = Math.max(0, entry.pinned - 1)
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key)
    if (!entry) return false
    this.bytes -= entry.bytes
    this.entries.delete(key)
    return true
  }

  clear(): void {
    this.entries.clear()
    this.bytes = 0
  }

  private evictIfNeeded(): void {
    if (this.bytes <= this.maxBytes) return
    const candidates = [...this.entries.entries()]
      .filter(([, entry]) => entry.pinned === 0)
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    for (const [key] of candidates) {
      if (this.bytes <= this.maxBytes) break
      const entry = this.entries.get(key)!
      this.bytes -= entry.bytes
      this.entries.delete(key)
      this.evictions += 1
    }
  }

  stats(): CacheStats {
    let pinnedBytes = 0
    for (const entry of this.entries.values()) if (entry.pinned > 0) pinnedBytes += entry.bytes
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      pinnedBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    }
  }
}
