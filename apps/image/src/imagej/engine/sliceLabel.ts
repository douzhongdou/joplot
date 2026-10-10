/**
 * 切片标签的文本生成（Image ▸ Stacks ▸ Label... 的 Format 部分）。
 *
 * 对应 ImageJ 的 `ij/plugin/filter/StackLabeler.java:253-302` 的六种格式：
 *
 * | 格式 | 输出 |
 * | --- | --- |
 * | `0` | 数值（可选小数位）+ 空格 + 自定义文本 |
 * | `0000` | 自定义文本 + 空格 + 零填充的整数 |
 * | `00:00` | `分:秒` |
 * | `00:00:00` | `时:分:秒` |
 * | `Text` | 只用自定义文本 |
 * | `Label` | 该切片自己的标签（没有则为空） |
 *
 * 时间值 = `start + index * interval`，与 ImageJ 的 `time = start + (n+1-firstFrame)*interval`
 * 在默认 `firstFrame = 1` 时一致（`n` 为 0-based 页下标）。
 */
export type SliceLabelFormat = 'number' | 'zero-padded' | 'mm:ss' | 'hh:mm:ss' | 'text' | 'label'

export const SLICE_LABEL_FORMATS: readonly SliceLabelFormat[] = ['number', 'zero-padded', 'mm:ss', 'hh:mm:ss', 'text', 'label']

export interface SliceLabelOptions {
  format: SliceLabelFormat
  /** 0-based 页下标。 */
  index: number
  /** 起始值（ImageJ 的 Starting value）。 */
  start: number
  /** 步长（ImageJ 的 Interval）。 */
  interval: number
  /** 自定义文本（ImageJ 的 Text 字段）。 */
  text?: string
  /** 零填充宽度；缺省取末帧序号的位数（ImageJ 的做法）。 */
  pad?: number
  /** `format = 'label'` 时该页的标签。 */
  sliceLabel?: string
  /** 数值格式保留的小数位。 */
  decimalPlaces?: number
}

function padNumber(value: number, width: number): string {
  return String(Math.trunc(Math.abs(value))).padStart(width, '0')
}

function formatValue(value: number, decimals: number): string {
  if (decimals > 0) return value.toFixed(decimals)
  return String(Math.trunc(value))
}

/** 生成某一页的标签文本。 */
export function formatSliceLabel(options: SliceLabelOptions): string {
  const text = options.text ?? ''
  const time = options.start + options.index * options.interval
  switch (options.format) {
    case 'number': {
      const value = formatValue(time, options.decimalPlaces ?? 0)
      return text ? `${value} ${text}` : value
    }
    case 'zero-padded': {
      const width = Math.max(1, options.pad ?? 4)
      const value = padNumber(time, width)
      return text ? `${text} ${value}` : value
    }
    case 'mm:ss': {
      const total = Math.max(0, Math.trunc(time))
      return `${padNumber(Math.floor(total / 60), 2)}:${padNumber(total % 60, 2)}`
    }
    case 'hh:mm:ss': {
      const total = Math.max(0, Math.trunc(time))
      return `${padNumber(Math.floor(total / 3600), 2)}:${padNumber(Math.floor(total / 60) % 60, 2)}:${padNumber(total % 60, 2)}`
    }
    case 'text':
      return text
    case 'label':
      return options.sliceLabel ?? ''
  }
}

/** `0000` 格式的默认零填充宽度（末帧序号的位数）。 */
export function padWidthFor(count: number): number {
  return Math.max(1, String(Math.max(1, Math.trunc(count))).length)
}
