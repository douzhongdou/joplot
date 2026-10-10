import test from 'node:test'
import assert from 'node:assert/strict'
import {
  rectangleRoi,
  ovalRoi,
  lineRoi,
  pointsRoi,
  rectangleFromCorners,
  roiBounds,
  roiContains,
  roiMask,
  roiArea,
  roiHit,
  roiTranslate,
  roiHandles,
  roiWithHandle,
  roiInsertVertex,
  roiRemoveVertex,
  clampRoi,
  roiIsFilled,
  roiIsStroke,
  pointInPolygon,
  roiLineMetrics,
  roiAngleDegrees,
  describeRoi,
} from '../src/imagej/lib/roi.ts'

test('矩形：包围盒、面积与掩码全覆盖', () => {
  const roi = rectangleRoi(2, 3, 4, 5)
  assert.deepEqual(roiBounds(roi), { x: 2, y: 3, width: 4, height: 5 })
  assert.equal(roiArea(roi, 20, 20), 20)
  assert.equal(roiContains(roi, 2, 3), true)
  assert.equal(roiContains(roi, 5, 7), true)
  assert.equal(roiContains(roi, 6, 7), false)
  assert.equal(roiContains(roi, 1, 3), false)
  assert.equal(roiIsFilled(roi), true)
  assert.equal(roiIsStroke(roi), false)
})

test('由拖拽两角构造的矩形自动归一化方向', () => {
  const roi = rectangleFromCorners(10, 8, 4, 2)
  assert.deepEqual(roiBounds(roi), { x: 4, y: 2, width: 6, height: 6 })
  const flipped = rectangleFromCorners(4, 2, 10, 8)
  assert.deepEqual(roiBounds(flipped), { x: 4, y: 2, width: 6, height: 6 })
})

test('椭圆：掩码面积接近 πab 且不覆盖四角', () => {
  const roi = ovalRoi(0, 0, 40, 20)
  const area = roiArea(roi, 40, 20)
  const expected = Math.PI * 20 * 10
  assert.ok(Math.abs(area - expected) / expected < 0.03, `椭圆面积 ${area} 与 πab=${expected.toFixed(0)} 偏差过大`)
  // 四角必须在椭圆外（这正是矩形近似会算错的地方）
  assert.equal(roiContains(roi, 0, 0), false)
  assert.equal(roiContains(roi, 39, 19), false)
  // 中心与左右顶点在内
  assert.equal(roiContains(roi, 20, 10), true)
  assert.equal(roiContains(roi, 1, 10), true)
})

test('掩码与逐像素判定在所有类型上一致', () => {
  const width = 60, height = 40
  const cases = [
    rectangleRoi(5, 4, 20, 15),
    ovalRoi(8, 6, 25, 18),
    lineRoi(3, 3, 50, 30),
    pointsRoi('polyline', [2, 2, 20, 35, 45, 8]),
    pointsRoi('polygon', [10, 5, 40, 10, 45, 30, 20, 36, 6, 20]),
    pointsRoi('freehand', [12, 8, 30, 6, 44, 18, 38, 34, 16, 32, 8, 20]),
    pointsRoi('angle', [5, 30, 25, 5, 50, 28]),
    pointsRoi('point', [7, 9, 30, 20]),
  ]
  for (const roi of cases) {
    const raster = roiMask(roi, width, height)
    assert.ok(raster, `${roi.kind} 应产生掩码`)
    const { bounds, mask } = raster!
    let mismatches = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const inMask = x >= bounds.x && y >= bounds.y && x < bounds.x + bounds.width && y < bounds.y + bounds.height
          ? mask[(y - bounds.y) * bounds.width + (x - bounds.x)] !== 0
          : false
        if (inMask !== roiContains(roi, x, y)) mismatches += 1
      }
    }
    const area = roiArea(roi, width, height)
    assert.ok(area > 0, `${roi.kind} 面积应大于 0`)
    assert.ok(mismatches / (width * height) < 0.005, `${roi.kind} 掩码与判定不一致：${mismatches} 像素`)
  }
})

test('凹多边形：扫描线填充不会填掉凹口', () => {
  // 一个 C 形：右侧开口的凹多边形
  const roi = pointsRoi('polygon', [10, 5, 50, 5, 50, 15, 20, 15, 20, 25, 50, 25, 50, 35, 10, 35])
  assert.equal(pointInPolygon(30, 10, roi.points), true)
  assert.equal(pointInPolygon(30, 20, roi.points), false, '凹口内部不应被填充')
  assert.equal(pointInPolygon(30, 30, roi.points), true)
  const raster = roiMask(roi, 60, 40)!
  const rowHole = 20 - raster.bounds.y
  const column = 30 - raster.bounds.x
  assert.equal(raster.mask[rowHole * raster.bounds.width + column], 0)
})

test('直线与折线：掩码是笔画而非包围盒', () => {
  const diagon = lineRoi(0, 0, 20, 20)
  const raster = roiMask(diagon, 30, 30)!
  const area = roiArea(diagon, 30, 30)
  assert.ok(area < 40, `斜线面积应接近线长而非包围盒（实际 ${area}）`)
  assert.equal(raster.mask[(10 - raster.bounds.y) * raster.bounds.width + (10 - raster.bounds.x)], 255, '对角线中点应点亮')
  assert.equal(raster.mask[(10 - raster.bounds.y) * raster.bounds.width + (18 - raster.bounds.x)], 0, '包围盒内但远离线的像素不应点亮')
  assert.equal(roiIsStroke(diagon), true)
  assert.equal(roiIsFilled(diagon), false)
})

test('掩码夹取到图像范围内', () => {
  const roi = rectangleRoi(-5, -5, 20, 20)
  const raster = roiMask(roi, 10, 10)!
  assert.deepEqual(raster.bounds, { x: 0, y: 0, width: 10, height: 10 })
  assert.equal(roiArea(roi, 10, 10), 100)
  assert.equal(roiMask(rectangleRoi(50, 50, 10, 10), 10, 10), null)
})

test('平移保持几何，clampRoi 把它收进图像', () => {
  const roi = rectangleRoi(5, 5, 10, 10)
  const moved = roiTranslate(roi, 3.5, -2)
  assert.deepEqual(roiBounds(moved), { x: 8, y: 3, width: 10, height: 10 })
  const pushed = roiTranslate(roi, -100, 0)
  const clamped = clampRoi(pushed, 40, 40)
  assert.deepEqual(roiBounds(clamped), { x: 0, y: 5, width: 10, height: 10 })
})

test('手柄：八个方向缩放矩形，对角锚点不动', () => {
  const roi = rectangleRoi(10, 10, 20, 20)
  const handles = roiHandles(roi)
  assert.equal(handles.length, 16)
  // 手柄 4 是右下角：拖到 (50, 50) 后左上角不变
  const grown = roiWithHandle(roi, 4, 50, 50)
  assert.deepEqual(roiBounds(grown), { x: 10, y: 10, width: 40, height: 40 })
  // 手柄 0 是左上角：拖到 (0, 0)
  const expanded = roiWithHandle(roi, 0, 0, 0)
  assert.deepEqual(roiBounds(expanded), { x: 0, y: 0, width: 30, height: 30 })
  // 边的中点只改一个方向
  const widened = roiWithHandle(roi, 3, 40, 25)
  assert.deepEqual(roiBounds(widened), { x: 10, y: 10, width: 30, height: 20 })
})

test('点序列编辑：插入与删除顶点', () => {
  const roi = pointsRoi('polygon', [0, 0, 10, 0, 10, 10])
  // 在 (0,10) 附近插入 -> 成为最后一个顶点之前/之后都合法，顶点数 +1
  const inserted = roiInsertVertex(roi, 0, 10)
  assert.equal(inserted.points.length / 2, 4)
  assert.ok(inserted.points.includes(0) && inserted.points.includes(10))
  const removed = roiRemoveVertex(inserted, 1)!
  assert.equal(removed.points.length / 2, 3)
  // 只剩两个顶点时删除 → 该 ROI 应被丢弃
  const flat = pointsRoi('polyline', [0, 0, 5, 5])
  assert.equal(roiRemoveVertex(flat, 1), null)
})

test('命中测试比掩码宽松：细图形也点得中', () => {
  const dot = pointsRoi('point', [10, 10])
  assert.equal(roiContains(dot, 10, 10), true)
  assert.equal(roiContains(dot, 12, 12), false, '掩码语义严格')
  assert.equal(roiHit(dot, 12, 12), true, '交互语义有容差')
  const thin = lineRoi(0, 0, 30, 0)
  assert.equal(roiHit(thin, 15, 2), true)
  assert.equal(roiHit(thin, 15, 8), false)
  const box = rectangleRoi(10, 10, 10, 10)
  assert.equal(roiHit(box, 10, 10), true)
  assert.equal(roiHit(box, 20, 11), true, '轮廓附近算命中，便于抓住选区')
  assert.equal(roiHit(box, 40, 40), false)
})

test('直线测量：长度按像素位移算，倾角以向右上为正', () => {
  const downRight = roiLineMetrics(lineRoi(0, 0, 499, 499))!
  assert.equal(downRight.length.toFixed(1), '705.7', '500×500 的包围盒对应 499 像素对角位移，√2×499')
  assert.equal(downRight.angle.toFixed(1), '-45.0', '图像 y 轴向下，向右下为负角')
  assert.equal(roiLineMetrics(lineRoi(0, 499, 499, 0))!.angle.toFixed(1), '45.0')
  assert.equal(roiLineMetrics(lineRoi(10, 10, 10, 10))!.length, 0)
  assert.equal(roiLineMetrics(rectangleRoi(0, 0, 4, 4)), null, '非直线不产生长度读数')
  assert.equal(roiAngleDegrees(pointsRoi('angle', [0, 100, 0, 0, 100, 0]))!.toFixed(1), '90.0')
  assert.equal(roiAngleDegrees(pointsRoi('polyline', [0, 0, 5, 5])), null, '顶点不足三个没有夹角')
})

test('状态栏读数：直线给长度与倾角，其余类型给包围盒', () => {
  assert.equal(describeRoi(lineRoi(0, 499, 499, 0)), '705.7 px · 45.0°')
  assert.equal(describeRoi(rectangleRoi(2, 3, 4, 5)), '4×5 @ (2, 3)')
  assert.equal(describeRoi(rectangleRoi(2, 3, 4, 5), 20), '4×5 @ (2, 3) · 20 px')
  assert.equal(describeRoi(pointsRoi('polyline', [0, 0, 5, 5]), 7), '6×6 @ (0, 0)', '描边类没有面积可言')
  assert.equal(describeRoi(pointsRoi('angle', [0, 100, 0, 0, 100, 0])), '90.0°')
})
