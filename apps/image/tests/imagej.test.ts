import test from 'node:test'
import assert from 'node:assert/strict'

import { createImagejCopy, type ImagejCopy } from '../src/imagej/lib/i18n.ts'
import {
  ImageHistory,
  ImagejError,
  MAX_IMAGE_PIXELS,
  applyLevels,
  applyThreshold,
  applyWithinRoi,
  bilevelThreshold,
  clampRect,
  convolve3x3,
  createImage,
  cropImage,
  flipHorizontal,
  flipVertical,
  histogram,
  invert,
  levelsRange,
  mean3x3,
  median3x3,
  measure,
  otsuThreshold,
  profileLine,
  rotate90,
  sharpen3x3,
  sobelEdges,
  toGrayFromRgba,
  toRgba,
  type GrayImage,
} from '../src/imagej/lib/processor.ts'
import { IMAGEJ_PATH } from '../src/i18n/config.ts'

/** 按行优先数值创建测试图。 */
function image(width: number, height: number, values: number[]): GrayImage {
  const data = Uint8Array.from(values)
  assert.equal(data.length, width * height, 'fixture 尺寸不匹配')
  return { width, height, data }
}

/** 3×2 基准图：1 2 3 / 4 5 6。 */
function fixture2x3(): GrayImage {
  return image(3, 2, [1, 2, 3, 4, 5, 6])
}

test('createImage 校验尺寸并拒绝超大图', () => {
  const filled = createImage(3, 2, 300)
  assert.equal(filled.data.length, 6)
  assert.equal(filled.data[0], 255, 'fill 会被夹到 0..255')

  assert.throws(() => createImage(0, 5), (error: unknown) => error instanceof ImagejError && error.code === 'invalid-size')
  assert.throws(() => createImage(10, -1), (error: unknown) => error instanceof ImagejError && error.code === 'invalid-size')
  assert.throws(
    () => createImage(MAX_IMAGE_PIXELS + 1, 1),
    (error: unknown) => error instanceof ImagejError && error.code === 'too-large',
  )
  assert.throws(() => createImage(2.5, 2), (error: unknown) => error instanceof ImagejError && error.code === 'invalid-size')
})

test('clampRect 把 ROI 夹取到图像范围内', () => {
  const source = image(4, 4, Array.from({ length: 16 }, (_, index) => index))

  assert.deepEqual(clampRect({ x: -2, y: -2, width: 4, height: 4 }, source), { x: 0, y: 0, width: 2, height: 2 })
  assert.deepEqual(clampRect({ x: 3, y: 3, width: 10, height: 10 }, source), { x: 3, y: 3, width: 1, height: 1 })
  assert.equal(clampRect({ x: 9, y: 9, width: 2, height: 2 }, source), null)
  assert.equal(clampRect({ x: Number.NaN, y: 0, width: 2, height: 2 }, source), null)
})

test('cropImage 按 ROI 复制像素', () => {
  const source = image(4, 4, Array.from({ length: 16 }, (_, index) => index))
  const cropped = cropImage(source, { x: 1, y: 1, width: 2, height: 2 })

  assert.equal(cropped.width, 2)
  assert.equal(cropped.height, 2)
  assert.deepEqual([...cropped.data], [5, 6, 9, 10])
  // 原图不被修改
  assert.deepEqual([...source.data], Array.from({ length: 16 }, (_, index) => index))
})

test('水平 / 垂直翻转与 90 度旋转的像素排布', () => {
  const source = fixture2x3()

  assert.deepEqual([...flipHorizontal(source).data], [3, 2, 1, 6, 5, 4])
  assert.deepEqual([...flipVertical(source).data], [4, 5, 6, 1, 2, 3])

  const clockwise = rotate90(source, 'cw')
  assert.equal(clockwise.width, 2)
  assert.equal(clockwise.height, 3)
  assert.deepEqual([...clockwise.data], [4, 1, 5, 2, 6, 3])

  const counterClockwise = rotate90(source, 'ccw')
  assert.equal(counterClockwise.width, 2)
  assert.equal(counterClockwise.height, 3)
  assert.deepEqual([...counterClockwise.data], [3, 6, 2, 5, 1, 4])

  // 连续四次顺时针回到原图
  const roundTrip = rotate90(rotate90(rotate90(rotate90(source, 'cw'), 'cw'), 'cw'), 'cw')
  assert.deepEqual([...roundTrip.data], [...source.data])
})

test('invert 执行 255 - v', () => {
  const source = image(3, 1, [0, 100, 255])
  assert.deepEqual([...invert(source).data], [255, 155, 0])
  assert.deepEqual([...source.data], [0, 100, 255], '入参不被修改')
})

test('ROI 处理只写回选区，滤波可读取选区外像素，局部翻转在选区内进行', () => {
  const source = image(4, 2, [10, 20, 30, 40, 50, 60, 70, 80])
  const roi = { x: 1, y: 0, width: 2, height: 2 }
  assert.deepEqual([...applyWithinRoi(source, roi, invert).data], [10, 235, 225, 40, 50, 195, 185, 80])
  assert.deepEqual([...applyWithinRoi(source, roi, flipHorizontal, true).data], [10, 30, 20, 40, 50, 70, 60, 80])
  assert.deepEqual([...applyWithinRoi(source, null, invert).data], [...invert(source).data])
  assert.throws(() => applyWithinRoi(source, roi, (value) => rotate90(value, 'cw')),
    (error: unknown) => error instanceof ImagejError && error.code === 'invalid-size')
})

test('levelsRange 默认为全范围，亮度/对比度夹取非法输入', () => {
  assert.deepEqual(levelsRange(0, 50), { min: 0, max: 255 })

  const brighter = levelsRange(50, 50)
  assert.ok(brighter.min < 0)
  assert.ok(brighter.max < 255)
  assert.ok(applyLevels(image(1, 1, [100]), brighter.min, brighter.max).data[0] > 100)

  const clamped = levelsRange(9999, 0)
  const baseline = levelsRange(0, 1)
  assert.equal(baseline.min, 127.5 - 6375, 'contrast 下限为 1，窗口宽度被拉到 ±6375')
  assert.ok(clamped.min < baseline.min, 'brightness 被夹到 127 后显示窗口左移')
  assert.ok(clamped.max - clamped.min === baseline.max - baseline.min)

  // 非法输入回退到默认档位，不抛异常
  assert.deepEqual(levelsRange(Number.NaN, Number.NaN), { min: 0, max: 255 })
})

test('applyLevels 重映射像素并拒绝退化范围', () => {
  const source = image(4, 1, [0, 64, 192, 255])
  assert.deepEqual([...applyLevels(source, 0, 255).data], [0, 64, 192, 255])

  // 窗口 [64, 192] → 64 变 0、192 变 255、两端被夹取
  assert.deepEqual([...applyLevels(source, 64, 192).data], [0, 0, 255, 255])

  assert.throws(
    () => applyLevels(source, 10, 10),
    (error: unknown) => error instanceof ImagejError && error.code === 'invalid-value',
  )
  assert.throws(
    () => applyLevels(source, Number.NaN, 200),
    (error: unknown) => error instanceof ImagejError && error.code === 'invalid-value',
  )
})

test('手动阈值：≤ level 归 0，> level 归 255', () => {
  const source = image(5, 1, [0, 127, 128, 200, 255])
  assert.deepEqual([...applyThreshold(source, 127).data], [0, 0, 255, 255, 255])
  assert.deepEqual([...applyThreshold(source, 200).data], [0, 0, 0, 0, 255])
  // 越界 level 被夹取而不是崩溃（0 不大于 0，仍归背景）
  assert.deepEqual([...applyThreshold(source, -50).data], [0, 255, 255, 255, 255])
  assert.deepEqual([...applyThreshold(source, 999).data], [0, 0, 0, 0, 0])
  assert.throws(
    () => applyThreshold(source, Number.NaN),
    (error: unknown) => error instanceof ImagejError && error.code === 'invalid-value',
  )
})

test('bilevelThreshold 处理 1 / 2 个非零直方图桶', () => {
  const single = new Uint32Array(256)
  single[42] = 10
  assert.equal(bilevelThreshold(single), 41)

  const pair = new Uint32Array(256)
  pair[10] = 5
  pair[200] = 5
  assert.equal(bilevelThreshold(pair), 199)

  const three = new Uint32Array(256)
  three[1] = 1
  three[2] = 1
  three[3] = 1
  assert.equal(bilevelThreshold(three), -1)
  assert.equal(bilevelThreshold(new Uint32Array(256)), -1)
})

function bimodalHistogram(): Uint32Array {
  const bins = new Uint32Array(256)
  for (let value = 16; value <= 64; value += 1) bins[value] = 4
  for (let value = 192; value <= 240; value += 1) bins[value] = 4
  bins[120] = 2 // 第三个非零桶：跳过 bilevel 快捷路径，真正执行 Otsu
  return bins
}

test('otsuThreshold 落在双峰之间', () => {
  const bins = bimodalHistogram()
  const level = otsuThreshold(bins)

  assert.ok(level >= 64 && level < 192, `Otsu 阈值应在两个峰之间，实际为 ${level}`)
})

test('otsuThreshold 与类间方差极大值一致', () => {
  const bins = bimodalHistogram()

  // 独立实现：BCV(t) = w0 * w1 * (mu0 - mu1)^2（按计数直接计算）
  const total = bins.reduce((sum, value) => sum + value, 0)
  let bestLevel = -1
  let bestBcv = -1
  let runningCount = 0
  let runningSum = 0
  const sums: number[] = []
  const counts: number[] = []
  for (let value = 0; value < bins.length; value += 1) {
    runningCount += bins[value]
    runningSum += value * bins[value]
    counts.push(runningCount)
    sums.push(runningSum)
  }

  for (let level = 0; level < bins.length - 1; level += 1) {
    const count0 = counts[level]
    const count1 = total - count0
    if (count0 === 0 || count1 === 0) continue
    const mean0 = sums[level] / count0
    const mean1 = (sums[bins.length - 1] - sums[level]) / count1
    const bcv = (count0 / total) * (count1 / total) * (mean0 - mean1) ** 2
    if (bcv > bestBcv) {
      bestBcv = bcv
      bestLevel = level
    }
  }

  const level = otsuThreshold(bins)
  assert.equal(level, bestLevel, `Otsu=${level} 与独立实现=${bestLevel} 不一致`)

  // 空直方图要给出可解释的错误
  assert.throws(
    () => otsuThreshold(new Uint32Array(256)),
    (error: unknown) => error instanceof ImagejError && error.code === 'invalid-value',
  )
})

test('均值滤波使用 (sum + 4) / 9 的整数口径', () => {
  const source = image(3, 3, [
    0, 0, 0,
    0, 9, 0,
    0, 0, 0,
  ])
  const smoothed = mean3x3(source)
  assert.equal(smoothed.data[4], Math.floor((9 + 4) / 9))

  // 边界复制：1×1 图像保持不变
  const single = image(1, 1, [77])
  assert.deepEqual([...mean3x3(single).data], [77])

  // 常量图保持不变
  const flat = image(4, 4, new Array(16).fill(200))
  assert.deepEqual([...mean3x3(flat).data], new Array(16).fill(200))
})

test('中值滤波取 3x3 邻域的中位数', () => {
  const source = image(3, 3, [
    10, 10, 10,
    10, 200, 10,
    10, 10, 10,
  ])
  const filtered = median3x3(source)
  assert.equal(filtered.data[4], 10, '单个亮点被中值滤波抑制')

  const ordered = image(3, 3, [
    1, 2, 3,
    4, 5, 6,
    7, 8, 9,
  ])
  assert.equal(median3x3(ordered).data[4], 5)
})

test('锐化核对常量图无副作用', () => {
  const flat = image(3, 3, new Array(9).fill(90))
  assert.deepEqual([...sharpen3x3(flat).data], new Array(9).fill(90))

  const step = image(3, 3, [
    0, 0, 0,
    0, 0, 255,
    0, 0, 0,
  ])
  const sharpened = sharpen3x3(step)
  // 中心：-8*0 + 12*0 - 255 = -255 → 夹取 0；右侧亮点被邻域拉高
  assert.equal(sharpened.data[4], 0)
  assert.equal(sharpened.data[5], 255)
})

test('Sobel 边缘在阶跃处饱和到 255，常量图为 0', () => {
  const flat = image(3, 3, new Array(9).fill(128))
  assert.deepEqual([...sobelEdges(flat).data], new Array(9).fill(0))

  const edge = image(3, 3, [
    0, 0, 255,
    0, 0, 255,
    0, 0, 255,
  ])
  const edges = sobelEdges(edge)
  assert.equal(edges.data[4], 255, '垂直边缘处梯度饱和')
  assert.equal(edges.data[0], 0, '同侧角落无梯度')
})

test('convolve3x3 校验卷积核', () => {
  const source = image(3, 3, new Array(9).fill(10))
  assert.throws(
    () => convolve3x3(source, [1, 2, 3]),
    (error: unknown) => error instanceof ImagejError && error.code === 'invalid-value',
  )
  assert.throws(
    () => convolve3x3(source, [1, 1, 1, 1, Number.NaN, 1, 1, 1, 1]),
    (error: unknown) => error instanceof ImagejError && error.code === 'invalid-value',
  )
})

test('直方图支持整图与 ROI', () => {
  const source = image(4, 4, Array.from({ length: 16 }, (_, index) => index))

  const whole = histogram(source)
  assert.equal(whole.length, 256)
  assert.equal(whole.reduce((sum, value) => sum + value, 0), 16)
  assert.equal(whole[5], 1)

  const roi = histogram(source, { x: 1, y: 1, width: 2, height: 2 })
  assert.equal(roi.reduce((sum, value) => sum + value, 0), 4)
  assert.equal(roi[5], 1)
  assert.equal(roi[0], 0)
})

test('measure 给出面积、均值、极值与样本标准差', () => {
  const source = image(4, 4, Array.from({ length: 16 }, (_, index) => index))
  const whole = measure(source)

  assert.equal(whole.count, 16)
  assert.equal(whole.area, 16)
  assert.equal(whole.mean, 7.5)
  assert.equal(whole.min, 0)
  assert.equal(whole.max, 15)
  // 样本标准差 sqrt(sum((x-mean)^2)/(n-1)) = sqrt(340/15)
  assert.ok(Math.abs(whole.stdDev - Math.sqrt(340 / 15)) < 1e-9)

  const roi = measure(source, { x: 1, y: 1, width: 2, height: 2 }) // 5,6,9,10
  assert.equal(roi.count, 4)
  assert.equal(roi.area, 4)
  assert.equal(roi.mean, 7.5)
  assert.equal(roi.min, 5)
  assert.equal(roi.max, 10)
  assert.ok(Math.abs(roi.stdDev - Math.sqrt(17 / 3)) < 1e-9)

  assert.throws(
    () => measure(source, { x: 50, y: 50, width: 2, height: 2 }),
    (error: unknown) => error instanceof ImagejError && error.code === 'empty-roi',
  )
})

test('单像素 / 常量图的标准差为 0', () => {
  const flat = image(3, 3, new Array(9).fill(77))
  assert.equal(measure(flat).stdDev, 0)
  assert.equal(measure(flat).mean, 77)
})

test('profileLine 沿水平线逐像素采样，越界端点钳制在图内', () => {
  const image = createImage(4, 3)
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      image.data[y * 4 + x] = y * 10 + x
    }
  }
  // 长度 3 → 3 步 → 4 个采样点，逐像素取值
  assert.deepEqual(profileLine(image, 0, 1, 3, 1), [10, 11, 12, 13])
  // 端点越界：首尾都钳制在图像范围内
  const clamped = profileLine(image, -5, 1, 10, 1)
  assert.equal(clamped[0], 10)
  assert.equal(clamped[clamped.length - 1], 13)
  // 零长度线至少返回 2 个采样
  assert.equal(profileLine(image, 2, 2, 2, 2).length, 2)
})

test('ImageHistory 支持撤销 / 重做与内存预算淘汰', () => {
  const history = new ImageHistory({ maxEntries: 3, maxBytes: 1024 * 1024 })
  const base = image(2, 1, [1, 1])
  const step1 = image(2, 1, [2, 2])
  const step2 = image(2, 1, [3, 3])
  const step3 = image(2, 1, [4, 4])
  const step4 = image(2, 1, [5, 5])

  assert.equal(history.canUndo, false)
  history.push(base)
  history.push(step1)
  history.push(step2)
  history.push(step3)
  assert.equal(history.depth, 3, '条目数上限生效')

  const undone = history.undo(step4)
  assert.ok(undone, '应当能撤销一步')
  assert.deepEqual([...undone.data], [...step3.data])
  assert.equal(history.canRedo, true)

  const redone = history.redo(undone)
  assert.ok(redone, '应当能重做一步')
  assert.deepEqual([...redone.data], [...step4.data])

  // 无可撤销 / 无重做时返回 null 而不是抛错
  assert.equal(new ImageHistory().undo(step4), null)
  assert.equal(new ImageHistory().redo(step4), null)

  history.clear()
  assert.equal(history.canUndo, false)
  assert.equal(history.canRedo, false)
  assert.equal(history.usedBytes, 0)
})

test('ImageHistory 按字节预算淘汰最旧快照', () => {
  const imageBytes = 64
  const history = new ImageHistory({ maxEntries: 100, maxBytes: imageBytes * 2 })
  for (let index = 0; index < 10; index += 1) {
    history.push(image(8, 8, new Array(imageBytes).fill(index)))
  }
  assert.ok(history.usedBytes <= imageBytes * 2, `实际使用 ${history.usedBytes} 字节`)
  assert.ok(history.depth >= 1, '至少保留一个可撤销快照')
})

test('裁剪后重做按撤销快照的实际字节数计费', () => {
  const history = new ImageHistory({ maxEntries: 4, maxBytes: 100 })
  const beforeCrop = image(10, 10, new Array(100).fill(1))
  const afterCrop = image(2, 2, [1, 1, 1, 1])
  history.push(beforeCrop)
  const undone = history.undo(afterCrop)
  assert.ok(undone)
  assert.equal(history.usedBytes, 0)
  const redone = history.redo(undone)
  assert.ok(redone)
  assert.equal(history.usedBytes, 100)
})

test('toRgba 输出不透明的灰度 RGBA', () => {
  const source = image(2, 1, [0, 255])
  assert.deepEqual([...toRgba(source)], [0, 0, 0, 255, 255, 255, 255, 255])
})

test('toGrayFromRgba 使用 ImageJ 默认的等权重', () => {
  const rgba = Uint8ClampedArray.from([
    255, 0, 0, 255,
    0, 0, 0, 255,
    30, 60, 90, 128,
  ])
  const gray = toGrayFromRgba(3, 1, rgba)
  assert.deepEqual([...gray.data], [85, 0, 60])

  const weighted = toGrayFromRgba(3, 1, rgba, [0.299, 0.587, 0.114])
  assert.equal(weighted.data[2], Math.round(30 * 0.299 + 60 * 0.587 + 90 * 0.114))

  assert.throws(
    () => toGrayFromRgba(2, 2, rgba),
    (error: unknown) => error instanceof ImagejError && error.code === 'invalid-size',
  )
})

function collectKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) {
    return [prefix]
  }
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => collectKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort()
}

test('中英日文案结构完全一致', () => {
  const zh = createImagejCopy('zh-CN')
  const en = createImagejCopy('en')
  const ja = createImagejCopy('ja-JP')

  assert.deepEqual(collectKeys(zh), collectKeys(en))
  assert.deepEqual(collectKeys(zh), collectKeys(ja))

  for (const copy of [zh, en, ja] as ImagejCopy[]) {
    assert.ok(copy.title.length > 0)
    assert.ok(copy.localNote.length > 0, '必须说明本地处理不上传')
  }

  // 未知语言回退到英文
  assert.equal(createImagejCopy('fr-FR' as unknown as Parameters<typeof createImagejCopy>[0]).title, en.title)
})

test('图像工作台使用不含语言的静态路径', () => {
  assert.equal(IMAGEJ_PATH, '/imagej')
})
