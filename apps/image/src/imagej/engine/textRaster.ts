/**
 * 极简文本光栅器：给「Label...」与 Make Montage 的切片标签用。
 *
 * 为什么不用 Canvas 文本：引擎跑在 Worker 里，浏览器的 `OffscreenCanvas` 能画字，
 * 但 Node 测试环境没有它 —— 一旦依赖 Canvas，标签这条路径就只能手测。
 * 这里内置一套 3×5 点阵、按字号整数倍放大，浏览器与测试环境的行为完全一致。
 *
 * 字符集覆盖 Label 自身会生成的全部文本（数字、冒号、小数点、负号、斜杠、空格）。
 * 用户自定义的 Text 若含其它字符，一律以 `?` 呈现（见移植文档 §4.17）。
 */
import type { Dtype, PixelArray } from './types.ts'

/** 点阵字形的宽 / 高与字间距（单位：点阵像素）。 */
export const GLYPH_WIDTH = 3
export const GLYPH_HEIGHT = 5
const GLYPH_SPACING = 1

/** 每个字形用 5 行 3 列的 `#` / `.` 描述。 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  ' ': ['...', '...', '...', '...', '...'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['..#', '..#', '..#', '..#', '..#'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  '/': ['..#', '..#', '...', '#..', '#..'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '?': ['###', '..#', '.##', '...', '.#.'],
}

/** 放大倍数：字号越高，点阵按整数倍放大（最小 1 倍）。 */
export function glyphScale(fontSize: number): number {
  if (!Number.isFinite(fontSize) || fontSize <= 0) return 1
  return Math.max(1, Math.round(fontSize / GLYPH_HEIGHT))
}

/** 文本按给定字号渲染后的像素宽度（用于右对齐）。 */
export function textWidth(text: string, fontSize: number): number {
  if (text.length === 0) return 0
  const scale = glyphScale(fontSize)
  return (text.length * (GLYPH_WIDTH + GLYPH_SPACING) - GLYPH_SPACING) * scale
}

/** 文本按给定字号渲染后的像素高度。 */
export function textHeight(fontSize: number): number {
  return GLYPH_HEIGHT * glyphScale(fontSize)
}

/** 标签的缺省前景值：取 dtype 的最大值（白），在深色科学图像上可见。 */
export function defaultLabelColor(dtype: Dtype): number {
  switch (dtype) {
    case 'uint8': return 255
    case 'uint16': return 65535
    case 'int16': return 32767
    case 'float32': return 1
  }
}

export interface DrawTextTarget {
  data: PixelArray
  width: number
  height: number
  /** 平面数：RGB 为 3，灰度标量为 1（每个平面都写同样的字形）。 */
  planes: number
}

/**
 * 把文本画进页缓冲；越界像素按 ImageJ 的 `drawString` 语义直接裁掉。
 *
 * `y` 是文本**顶部**（ImageJ 的 `drawString` 用的是基线，这里统一成顶部更便于布局，
 * 调用方在需要时自行减去字号）。
 */
export function drawText(
  target: DrawTextTarget,
  text: string,
  x: number,
  y: number,
  options: { fontSize: number; color: number },
): void {
  if (text.length === 0) return
  const scale = glyphScale(options.fontSize)
  const view = target.data as unknown as { [index: number]: number }
  const planeLength = target.width * target.height
  const originX = Math.round(x)
  const originY = Math.round(y)
  let cursor = originX
  for (const character of text) {
    const glyph = GLYPHS[character] ?? GLYPHS['?']!
    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      const pattern = glyph[row]!
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        if (pattern[column] !== '#') continue
        for (let offsetY = 0; offsetY < scale; offsetY += 1) {
          const targetY = originY + row * scale + offsetY
          if (targetY < 0 || targetY >= target.height) continue
          for (let offsetX = 0; offsetX < scale; offsetX += 1) {
            const targetX = cursor + column * scale + offsetX
            if (targetX < 0 || targetX >= target.width) continue
            for (let plane = 0; plane < target.planes; plane += 1) {
              view[plane * planeLength + targetY * target.width + targetX] = options.color
            }
          }
        }
      }
    }
    cursor += (GLYPH_WIDTH + GLYPH_SPACING) * scale
  }
}
