/**
 * 工具栏工具注册表。
 *
 * 对齐 ImageJ 的工具栏（`ij/gui/Toolbar.java` 的工具常量与 `getName` 的子类型机制），
 * 但按我们的架构落成"注册表 + 交互模型"：`interaction` 决定 `ImageViewport`
 * 如何解释指针事件，`roiKind` 决定产出的 ROI 类型。
 *
 * 子类型（双击工具图标切换）来自 ImageJ 的 `Toolbar.getName()`：
 * 一个图标位置其实是"工具族"，例如直线在 `line` / `arrow` 之间切换、
 * 点在 `point` / `multipoint` 之间切换。这样 11 个图标能覆盖 13 种行为。
 */
import { Circle, Dot, Hand, Minus, MoveRight, Pencil, Pentagon, Pipette, Spline, Square, Triangle, ZoomIn, type LucideIcon } from 'lucide-react'
import type { RoiKind } from './roi.ts'

export type ToolId =
  | 'hand' | 'zoom' | 'dropper'
  | 'rectangle' | 'oval'
  | 'line' | 'polyline' | 'polygon' | 'freehand'
  | 'point' | 'angle'

/**
 * 指针交互模型。
 *
 * - `pan` / `zoom` / `pick`：不改选区，分别用于平移、缩放、取色；
 * - `drag`：按下拖出两个角/两端（矩形、椭圆、直线）；
 * - `freehand`：按下持续采样，松开成封闭区域；
 * - `multi`：逐点点击构造（折线、多边形、角度），双击或回车结束；
 * - `dot`：单击落点，可连续落多个（多点工具）。
 */
export type ToolInteraction = 'pan' | 'zoom' | 'pick' | 'drag' | 'freehand' | 'multi' | 'dot'

export interface ToolVariant {
  readonly id: string
  /** 子类型的 i18n key 后缀，例如 `arrow`。 */
  readonly labelKey: string
}

export interface ToolDefinition {
  readonly id: ToolId
  readonly icon: LucideIcon
  readonly interaction: ToolInteraction
  /** 该工具产出的 ROI 类型（视图类工具为 null）。 */
  readonly roiKind: RoiKind | null
  /** 双击图标可切换的子类型；缺省表示无子类型。 */
  readonly variants?: readonly ToolVariant[]
  /** 单键快捷键。 */
  readonly shortcut: string
}

export const TOOLS: readonly ToolDefinition[] = [
  { id: 'hand', icon: Hand, interaction: 'pan', roiKind: null, shortcut: 'h' },
  { id: 'zoom', icon: ZoomIn, interaction: 'zoom', roiKind: null, shortcut: 'z' },
  { id: 'dropper', icon: Pipette, interaction: 'pick', roiKind: null, shortcut: 'i' },
  { id: 'rectangle', icon: Square, interaction: 'drag', roiKind: 'rectangle', shortcut: 'r' },
  { id: 'oval', icon: Circle, interaction: 'drag', roiKind: 'oval', shortcut: 'o' },
  {
    id: 'line', icon: Minus, interaction: 'drag', roiKind: 'line', shortcut: 'l',
    variants: [{ id: 'line', labelKey: 'line' }, { id: 'arrow', labelKey: 'arrow' }],
  },
  { id: 'polyline', icon: Spline, interaction: 'multi', roiKind: 'polyline', shortcut: 'p' },
  { id: 'polygon', icon: Pentagon, interaction: 'multi', roiKind: 'polygon', shortcut: 'g' },
  { id: 'freehand', icon: Pencil, interaction: 'freehand', roiKind: 'freehand', shortcut: 'f' },
  {
    id: 'point', icon: Dot, interaction: 'dot', roiKind: 'point', shortcut: 't',
    variants: [{ id: 'point', labelKey: 'point' }, { id: 'multipoint', labelKey: 'multipoint' }],
  },
  { id: 'angle', icon: Triangle, interaction: 'multi', roiKind: 'angle', shortcut: 'a' },
]

/** 箭头变体（直线工具的第二种形态）的图标，供工具栏按变体切换显示。 */
export const VARIANT_ICONS: Readonly<Record<string, LucideIcon>> = { arrow: MoveRight }

export function findTool(id: ToolId): ToolDefinition {
  return TOOLS.find((tool) => tool.id === id) ?? TOOLS[0]!
}

export function toolByShortcut(key: string): ToolDefinition | undefined {
  const lower = key.toLowerCase()
  return TOOLS.find((tool) => tool.shortcut === lower)
}

/** 需要"多步构造"的工具（双击或回车结束）——用于提示文案与 Esc 取消逻辑。 */
export function isMultiStepTool(tool: ToolDefinition): boolean {
  return tool.interaction === 'multi'
}
