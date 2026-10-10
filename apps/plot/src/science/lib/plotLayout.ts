/**
 * /science 图表的高度与图例布局换算。
 *
 * 单独抽出来是因为「图例钉在绘图区下方固定像素处」这条不变量容易被归一化坐标悄悄破坏：
 * Plotly 的 legend.y 是相对绘图区的归一化值，直接写死负数时图表越高、图例离绘图区越远，
 * 高度拖到一定程度就会跑出画布。换算成固定像素偏移后，高度怎么变图例都停在原处。
 */

/** 拖拽可调的高度范围：太矮图例与坐标轴会互相挤压，太高在分栏里已没有意义。 */
export const SCIENCE_PLOT_MIN_HEIGHT = 180
export const SCIENCE_PLOT_MAX_HEIGHT = 900

/** 上边距，以及「图例在下方 / 不在下方」两种下边距。 */
export const SCIENCE_PLOT_MARGIN_TOP = 14
export const SCIENCE_PLOT_MARGIN_BOTTOM_WITH_LEGEND = 88
export const SCIENCE_PLOT_MARGIN_BOTTOM = 48

/** 图例顶边距绘图区底边的固定像素距离，用来容纳 x 轴刻度和轴标题。 */
export const SCIENCE_PLOT_LEGEND_OFFSET_PX = 46

/** 分隔条聚焦后按上下方向键时每次调整的高度。 */
export const SCIENCE_PLOT_KEYBOARD_STEP = 24

export function clampPlotHeight(height: number): number {
  return Math.min(SCIENCE_PLOT_MAX_HEIGHT, Math.max(SCIENCE_PLOT_MIN_HEIGHT, Math.round(height)))
}

export function resolvePlotMarginBottom(showLegend: boolean): number {
  return showLegend ? SCIENCE_PLOT_MARGIN_BOTTOM_WITH_LEGEND : SCIENCE_PLOT_MARGIN_BOTTOM
}

/** 把「距绘图区底边固定像素」换算成 Plotly 需要的归一化 legend.y。 */
export function resolveLegendY(height: number, showLegend: boolean): number {
  const plotAreaHeight = Math.max(
    1,
    height - SCIENCE_PLOT_MARGIN_TOP - resolvePlotMarginBottom(showLegend),
  )

  return -(SCIENCE_PLOT_LEGEND_OFFSET_PX / plotAreaHeight)
}

/** 图例顶边的像素位置（相对容器顶边），用于断言换算后距容器底边恒定。 */
export function resolveLegendTop(height: number, showLegend: boolean): number {
  return height - resolvePlotMarginBottom(showLegend) + SCIENCE_PLOT_LEGEND_OFFSET_PX
}
