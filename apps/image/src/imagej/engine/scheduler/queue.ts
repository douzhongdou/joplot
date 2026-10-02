/**
 * P2：任务优先级与合并（对应架构方案第 5 节）。
 *
 * - 优先级：当前页/ROI/探查 > 翻页方向邻页 > 反向邻页 > 后台批处理。
 * - 合并：同一 coalesceKey 的新任务淘汰尚未执行的旧任务。
 * - 过期：任务执行前与结果提交前都要检查版本，过期结果不得覆盖当前画面。
 */

export const TASK_PRIORITY = {
  /** 当前目标页、当前 ROI、像素探查。 */
  critical: 3,
  /** 翻页方向上的下一页及附近页面。 */
  prefetchForward: 2,
  /** 反方向邻页。 */
  prefetchBackward: 1,
  /** 整组统计、批量导出。 */
  background: 0,
} as const

export type TaskPriority = (typeof TASK_PRIORITY)[keyof typeof TASK_PRIORITY]

export interface SchedulerTask<T> {
  id: string
  priority: TaskPriority
  /** 相同 key 的任务只保留最新一个；缺省表示不合并。 */
  coalesceKey?: string
  /** 结果提交前的过期检查；返回 true 表示放弃。 */
  isStale(): boolean
  run(): Promise<T>
  /** 被合并淘汰或取消时回调。 */
  onDiscard?(reason: 'coalesced' | 'cancelled' | 'stale'): void
}

export class TaskQueue<T = unknown> {
  private readonly pending = new Map<string, SchedulerTask<T>>()
  private sequence = 0

  size(): number {
    return this.pending.size
  }

  /**
   * 入队一个任务。返回 false 表示任务在入队时已被判定过期。
   * 相同 coalesceKey 的旧任务会被淘汰。
   */
  push(task: SchedulerTask<T>): boolean {
    if (task.isStale()) return false
    if (task.coalesceKey) {
      for (const [id, existing] of this.pending) {
        if (existing.coalesceKey === task.coalesceKey) {
          this.pending.delete(id)
          existing.onDiscard?.('coalesced')
        }
      }
    }
    this.pending.set(task.id, task)
    this.sequence += 1
    return true
  }

  /** 移除指定任务。 */
  cancel(id: string): boolean {
    const task = this.pending.get(id)
    if (!task) return false
    this.pending.delete(id)
    task.onDiscard?.('cancelled')
    return true
  }

  /** 移除所有满足条件的任务。 */
  cancelWhere(predicate: (task: SchedulerTask<T>) => boolean): number {
    let removed = 0
    for (const [id, task] of this.pending) {
      if (predicate(task)) {
        this.pending.delete(id)
        task.onDiscard?.('cancelled')
        removed += 1
      }
    }
    return removed
  }

  /** 取出优先级最高且未过期的任务；过期任务被丢弃。 */
  next(): SchedulerTask<T> | undefined {
    let best: SchedulerTask<T> | undefined
    for (const task of this.pending.values()) {
      if (task.isStale()) {
        this.pending.delete(task.id)
        task.onDiscard?.('stale')
        continue
      }
      if (!best || task.priority > best.priority) best = task
    }
    if (best) this.pending.delete(best.id)
    return best
  }

  clear(): void {
    this.pending.clear()
  }
}

/**
 * 版本守卫：任务入队时记录版本，结果提交前比对当前版本。
 * 用于防止过期结果覆盖当前 Dataset/步骤/请求。
 */
export class VersionGuard {
  private current: string

  constructor(initial = '') {
    this.current = initial
  }

  /** 更新当前版本；旧守卫即视为过期。 */
  update(version: string): void {
    this.current = version
  }

  version(): string {
    return this.current
  }

  /** 生成一个绑定当前版本的快照守卫。 */
  snapshot(): { version: string; isStale: () => boolean } {
    const version = this.current
    return { version, isStale: () => version !== this.current }
  }
}
