import test from 'node:test'
import assert from 'node:assert/strict'
import {
  autoLevelBounds,
  blockLayout,
  channelHistograms,
  channelStatistics,
  equalizationLut,
  gradeColors,
  gradingCeiling,
  whiteBalanceGains,
} from '../src/imagej/engine/colorGrading.ts'
import { getOperator } from '../src/imagej/engine/operators.ts'
import type { AxisName, Dtype, ImageBlock, PixelArray } from '../src/imagej/engine/types.ts'

function makeBlock(dtype: Dtype, shape: readonly number[], axes: readonly AxisName[], values: readonly number[]): ImageBlock {
  const data = ({
    uint8: () => Uint8Array.from(values),
    uint16: () => Uint16Array.from(values),
    int16: () => Int16Array.from(values),
    float32: () => Float32Array.from(values),
  }[dtype]()) as PixelArray
  return {
    dtype,
    axes: axes as ImageBlock['axes'],
    shape: [...shape],
    region: { start: axes.map(() => 0), shape: [...shape] },
    data,
  }
}

function close(actual: number, expected: number, tolerance = 1e-6, message?: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `${actual} !≈ ${expected}`)
}

/* ---------------- 通道统计 ---------------- */

test('blockLayout 与 gradingCeiling 反映 dtype 与通道数', () => {
  const rgb = makeBlock('uint8', [3, 1, 2], ['c', 'y', 'x'], [1, 2, 3, 4, 5, 6])
  assert.deepEqual(blockLayout(rgb), { width: 2, height: 1, channels: 3, pixels: 2 })
  assert.equal(gradingCeiling('uint8'), 255)
  assert.equal(gradingCeiling('uint16'), 65535)
})

test('channelStatistics 按平面分离统计均值与最大值', () => {
  // R=[10,20] G=[30,40] B=[50,60]
  const rgb = makeBlock('uint8', [3, 1, 2], ['c', 'y', 'x'], [10, 20, 30, 40, 50, 60])
  assert.deepEqual(channelStatistics(rgb), { means: [15, 35, 55], maxima: [20, 40, 60] })
})

/* ---------------- 白平衡 ---------------- */

test('whiteBalanceGains 灰度世界以平均亮度为参考', () => {
  const gains = whiteBalanceGains([100, 50, 200], [0, 0, 0], 'grayWorld')
  close(gains[0]!, 350 / 3 / 100)
  close(gains[1]!, 350 / 3 / 50)
  close(gains[2]!, 350 / 3 / 200)
  // 三个增益都作用后，通道均值会被拉到同一个值。
  close(100 * gains[0]!, 50 * gains[1]!)
  close(50 * gains[1]!, 200 * gains[2]!)
})

test('whiteBalanceGains 白点以全局最大值为参考', () => {
  assert.deepEqual(whiteBalanceGains([0, 0, 0], [200, 100, 50], 'whitePatch'), [1, 2, 4])
})

test('whiteBalanceGains 对全零通道不做放大', () => {
  assert.deepEqual(whiteBalanceGains([0, 0, 0], [0, 0, 0], 'grayWorld'), [1, 1, 1])
  assert.deepEqual(whiteBalanceGains([0, 0, 0], [0, 0, 0], 'whitePatch'), [1, 1, 1])
})

/* ---------------- 均衡化 ---------------- */

test('equalizationLut 用标准 CDF 把最暗有效灰度映到 0、最亮映到满量程', () => {
  const lut = equalizationLut([1, 1, 1, 1], 255)
  assert.deepEqual(Array.from(lut), [0, 85, 170, 255])
})

test('equalizationLut 忽略前面的空桶，空直方图返回全 0', () => {
  const lut = equalizationLut([0, 2, 2], 255)
  assert.deepEqual(Array.from(lut), [0, 0, 255])
  assert.deepEqual(Array.from(equalizationLut([0, 0, 0], 255)), [0, 0, 0])
})

/* ---------------- 自动色阶 ---------------- */

test('autoLevelBounds 按比例裁掉两端像素', () => {
  // 6 个桶、共 20 个像素、裁 10% → 两端各允许 2 个像素。
  const histograms = [Uint32Array.from([1, 1, 8, 8, 1, 1])]
  assert.deepEqual(autoLevelBounds(histograms, [20], 10), [{ min: 2, max: 3 }])
})

/* ---------------- 主入口 ---------------- */

test('gradeColors 的灰度世界校正把偏色拉回中性', () => {
  // 1×1 RGB：R=200 G=100 B=50（均值 116.67 的参考）。
  const rgb = makeBlock('uint8', [3, 1, 1], ['c', 'y', 'x'], [200, 100, 50])
  const graded = gradeColors(rgb, { method: 'grayWorld' })
  const values = Array.from(graded.data as Uint8Array)
  assert.equal(values.length, 3)
  // 三通道被拉到同一水平（各自 round，允许 1 的差）。
  assert.ok(Math.max(...values) - Math.min(...values) <= 1, `通道应被拉平，得到 ${values.join(',')}`)
  close(values[0]!, 116.67, 1)
})

test('gradeColors 对灰度图的灰度世界是无操作', () => {
  const gray = makeBlock('uint8', [1, 3], ['y', 'x'], [10, 20, 30])
  const graded = gradeColors(gray, { method: 'grayWorld' })
  assert.deepEqual(Array.from(graded.data as Uint8Array), [10, 20, 30])
})

test('gradeColors 的 manual 按增益缩放并钳位', () => {
  const rgb = makeBlock('uint8', [3, 1, 1], ['c', 'y', 'x'], [100, 100, 100])
  const graded = gradeColors(rgb, { method: 'manual', gains: [2, 0.5, 0] })
  assert.deepEqual(Array.from(graded.data as Uint8Array), [200, 50, 0])
})

test('gradeColors 的 equalize 强度为 0 时保持原样、为 100 时铺满量程', () => {
  // 2×1 灰度：一半 0、一半 100 → 均衡后 0 与 255。
  const gray = makeBlock('uint8', [1, 2], ['y', 'x'], [0, 100])
  const untouched = gradeColors(gray, { method: 'equalize', strength: 0 })
  assert.deepEqual(Array.from(untouched.data as Uint8Array), [0, 100])
  const full = gradeColors(gray, { method: 'equalize', strength: 100 })
  assert.deepEqual(Array.from(full.data as Uint8Array), [0, 255])
})

test('gradeColors 的 autoLevels 按通道拉伸到满量程', () => {
  // R 只有 10..60，G 已铺满 → 各自拉伸后都到 0..255。
  const rgb = makeBlock('uint8', [3, 1, 2], ['c', 'y', 'x'], [10, 60, 0, 255, 0, 0])
  const graded = gradeColors(rgb, { method: 'autoLevels', clipPercent: 0 })
  const values = Array.from(graded.data as Uint8Array)
  assert.deepEqual(values.slice(0, 2), [0, 255])
  assert.deepEqual(values.slice(2, 4), [0, 255])
})

test('channelHistograms 按 dtype 满量程分桶', () => {
  const gray = makeBlock('uint8', [1, 2], ['y', 'x'], [0, 255])
  const histograms = channelHistograms(gray, 8)
  assert.equal(histograms.length, 1)
  assert.deepEqual(Array.from(histograms[0]!), [1, 0, 0, 0, 0, 0, 0, 1])
})

/* ---------------- 算子注册 ---------------- */

test('colorGrading 已在算子表注册并声明为全局依赖', () => {
  // 没注册的话 `runtime.addStep` 会静默 return undefined：步骤不加、画面不变，
  // 表现为「点了应用什么也没发生」——这条断言就是防这个回归的。
  const capability = getOperator('colorGrading')
  assert.ok(capability, 'colorGrading 必须注册，否则 addStep 会静默忽略')
  assert.equal(capability!.regionDependency.kind, 'global')
  assert.equal(capability!.outputImage?.dtype, 'same')
  // 面板传的参数都要在算子声明里，否则会被 validateOperatorParams 丢掉。
  const keys = capability!.params.map((param) => param.key)
  for (const key of ['method', 'clipPercent', 'strength', 'gainR', 'gainG', 'gainB']) {
    assert.ok(keys.includes(key), `算子参数缺少 ${key}`)
  }
})
