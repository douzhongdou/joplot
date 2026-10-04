/**
 * 动画播放的步进逻辑（Image ▸ Stacks ▸ Animation 的 Start / Stop / Options）。
 *
 * 对应 ImageJ 的 `ij/plugin/Animator.java:99-211`：按固定帧率推进当前切片，
 * 到端点后要么回到起点（`Loop Back and Forth` 关闭），要么折返（打开）。
 * ImageJ 的有效帧率被夹在 `[0.1, 1000]`（`Animator.java:99-105`、`:257`）。
 *
 * 与 ImageJ 的差别：ImageJ 折返时会**跳过端点那一帧**（先 `slice += inc` 再判越界，
 * 翻向后取 `last-1` / `first+1`）；这里不跳帧 —— 端点播完再反向。
 */
export interface AnimationStep {
  /** 当前页（0-based）。 */
  current: number
  /** 播放区间（1-based，含两端），对应 ImageJ 的 First / Last Frame。 */
  first: number
  last: number
  /** 当前方向：true 表示朝 `last` 走。 */
  forward: boolean
  /** 折返（ImageJ 的 Loop Back and Forth）。 */
  loop: boolean
}

export interface AnimationStepResult {
  index: number
  forward: boolean
}

/** 帧率（fps）→ 定时器间隔（毫秒）。 */
export function animationInterval(fps: number): number {
  const rate = Number.isFinite(fps) && fps > 0 ? Math.min(1000, Math.max(0.1, fps)) : 7
  return 1000 / rate
}

/**
 * 推进一帧，返回新的页下标与方向。
 *
 * 区间与当前页都会先夹到有效范围，因此调用方不必自己保证参数合法。
 */
export function nextAnimationStep(step: AnimationStep, pageCount: number): AnimationStepResult {
  const total = Math.max(1, Math.floor(pageCount))
  const first = Math.max(1, Math.min(total, Math.floor(step.first)))
  const last = Math.max(first, Math.min(total, Math.floor(step.last)))
  const start = first - 1
  const end = last - 1
  const current = Math.max(start, Math.min(end, Math.floor(step.current)))
  if (start === end) return { index: start, forward: step.forward }

  if (step.forward) {
    if (current + 1 <= end) return { index: current + 1, forward: true }
    // 走到末页：折返播前一页，否则回到起点。
    return step.loop ? { index: end - 1, forward: false } : { index: start, forward: true }
  }
  if (current - 1 >= start) return { index: current - 1, forward: false }
  return step.loop ? { index: start + 1, forward: true } : { index: end, forward: false }
}
