import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCIENCE_PLOT_LEGEND_OFFSET_PX,
  SCIENCE_PLOT_MARGIN_BOTTOM,
  SCIENCE_PLOT_MARGIN_BOTTOM_WITH_LEGEND,
  SCIENCE_PLOT_MARGIN_TOP,
  SCIENCE_PLOT_MAX_HEIGHT,
  SCIENCE_PLOT_MIN_HEIGHT,
  clampPlotHeight,
  resolveLegendTop,
  resolveLegendY,
  resolvePlotMarginBottom,
} from '../src/science/lib/plotLayout.ts'

const HEIGHTS = [SCIENCE_PLOT_MIN_HEIGHT, 240, 300, 480, SCIENCE_PLOT_MAX_HEIGHT]

test('图例钉在绘图区下方固定像素处，不随高度漂移', () => {
  const expectedBottomGap = SCIENCE_PLOT_MARGIN_BOTTOM_WITH_LEGEND - SCIENCE_PLOT_LEGEND_OFFSET_PX

  for (const height of HEIGHTS) {
    assert.equal(height - resolveLegendTop(height, true), expectedBottomGap, `height=${height}`)
  }
})

test('归一的 legend.y 换算回像素后仍是同一个偏移', () => {
  for (const height of HEIGHTS) {
    const plotAreaHeight = height - SCIENCE_PLOT_MARGIN_TOP - SCIENCE_PLOT_MARGIN_BOTTOM_WITH_LEGEND
    const offsetPx = -resolveLegendY(height, true) * plotAreaHeight

    assert.ok(Math.abs(offsetPx - SCIENCE_PLOT_LEGEND_OFFSET_PX) < 1e-9, `height=${height}`)
  }
})

test('legend.y 始终位于绘图区下方', () => {
  for (const height of HEIGHTS) {
    assert.ok(resolveLegendY(height, true) < 0, `height=${height}`)
  }
})

test('没有图例时收回多留的下边距', () => {
  assert.equal(resolvePlotMarginBottom(false), SCIENCE_PLOT_MARGIN_BOTTOM)
  assert.equal(resolvePlotMarginBottom(true), SCIENCE_PLOT_MARGIN_BOTTOM_WITH_LEGEND)
})

test('拖拽高度被夹在可读范围内并取整', () => {
  assert.equal(clampPlotHeight(80), SCIENCE_PLOT_MIN_HEIGHT)
  assert.equal(clampPlotHeight(4000), SCIENCE_PLOT_MAX_HEIGHT)
  assert.equal(clampPlotHeight(333.6), 334)
})

test('极矮的图也不会让 legend.y 变成 Infinity', () => {
  assert.ok(Number.isFinite(resolveLegendY(0, true)))
  assert.ok(Number.isFinite(resolveLegendY(SCIENCE_PLOT_MARGIN_TOP, false)))
})
