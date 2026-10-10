import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PROJECTION_3D_BUDGET,
  project3d,
  projection3dAngles,
  projection3dSize,
  projectionWorkload,
} from '../src/imagej/engine/project3d.ts'
import type { Dtype, ImageBlock, PixelArray } from '../src/imagej/engine/types.ts'

function frame(dtype: Dtype, shape: readonly number[], values: readonly number[]): ImageBlock {
  const data = ({
    uint8: () => Uint8Array.from(values),
    uint16: () => Uint16Array.from(values),
    int16: () => Int16Array.from(values),
    float32: () => Float32Array.from(values),
  }[dtype]()) as PixelArray
  return { dtype, axes: ['y', 'x'] as const, shape, region: { start: [0, 0], shape: [...shape] }, data }
}

/* ---------------- 角度序列 ---------------- */

test('projection3dAngles 与 ImageJ 的 floor(总旋转/增量)+1 一致', () => {
  assert.deepEqual(projection3dAngles(0, 360, 90), [0, 90, 180, 270, 360])
  assert.equal(projection3dAngles(0, 360, 10).length, 37)
  // 总旋转为 0 时只有一帧。
  assert.deepEqual(projection3dAngles(0, 0, 10), [0])
  assert.deepEqual(projection3dAngles(45, 180, 90), [45, 135, 225])
  // 负增量反向步进。
  assert.deepEqual(projection3dAngles(90, 180, -90), [90, 0, -90])
  // 增量为 0 时退回默认 10 度。
  assert.equal(projection3dAngles(0, 20, 0).length, 3)
})

/* ---------------- 画布尺寸 ---------------- */

test('projection3dSize 按旋转轴取对角包络', () => {
  // 深度 = 3 片 × 间距 1。
  assert.deepEqual(projection3dSize('y', 4, 3, 3, 1), { width: 5, height: 3 })
  assert.deepEqual(projection3dSize('x', 4, 3, 3, 1), { width: 4, height: 4 })
  // 绕 Z 轴时宽度取偶数。
  assert.deepEqual(projection3dSize('z', 4, 3, 3, 1), { width: 6, height: 4 })
})

test('projectionWorkload 是角度 × 切片 × 单页像素', () => {
  assert.equal(projectionWorkload(37, 100, 512, 512), 37 * 100 * 512 * 512)
  assert.equal(PROJECTION_3D_BUDGET, 4e8)
})

/* ---------------- 旋转投影 ---------------- */

test('0 度时 3D Project 退化为「沿深度取最近点」', async () => {
  const pages = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]]
  const projected = await project3d({
    method: 'nearest',
    axis: 'y',
    initialAngle: 0,
    totalRotation: 0,
    angleIncrement: 10,
    sliceInterval: 1,
    opacity: 100,
    surfaceCueing: 0,
    interiorCueing: 0,
    frames: [0, 1, 2],
    readFrame: async (index) => frame('uint8', [2, 2], pages[index]!),
  })
  assert.equal(projected.length, 1)
  // 画布 4×2；x 方向居中平移后落在第 2、3 列。
  assert.deepEqual([...projected[0]!.shape], [2, 4])
  assert.deepEqual(Array.from(projected[0]!.data as Uint8Array), [0, 1, 2, 0, 0, 3, 4, 0])
})

test('mean 与 brightest 分别给出均值与最亮值', async () => {
  const options = {
    axis: 'y' as const,
    initialAngle: 0,
    totalRotation: 0,
    angleIncrement: 10,
    sliceInterval: 1,
    opacity: 0,
    surfaceCueing: 0,
    interiorCueing: 0,
    frames: [0, 1, 2],
    readFrame: async (index: number) => frame('uint8', [1, 1], [[3], [9], [6]][index]!),
  }
  const mean = await project3d({ ...options, method: 'mean' })
  // 1×1 的页、3 片 → 画布宽 3、高 1；居中落在第 3 列（下标 2）。
  assert.deepEqual([...mean[0]!.shape], [1, 3])
  assert.equal((mean[0]!.data as Uint8Array)[1], 6)

  const brightest = await project3d({ ...options, method: 'brightest' })
  assert.equal((brightest[0]!.data as Uint8Array)[1], 9)
})

test('depth cueing 让远处的采样值变暗', async () => {
  const projected = await project3d({
    method: 'mean',
    axis: 'y',
    initialAngle: 0,
    totalRotation: 0,
    angleIncrement: 10,
    sliceInterval: 1,
    opacity: 0,
    surfaceCueing: 0,
    // 内部深度提示拉满：最远的切片被压到 0。
    interiorCueing: 100,
    frames: [0, 1, 2],
    readFrame: async () => frame('uint8', [1, 1], [100]),
  })
  // z=0 最远 → 系数 0；z=1 在中间 → 0.5；z=2 最近 → 1。
  assert.equal((projected[0]!.data as Uint8Array)[1], Math.round((0 + 50 + 100) / 3))
})

test('绕 Z 轴旋转会改变横向布局', async () => {
  const pages = [[1, 2, 3, 4]]
  const projected = await project3d({
    method: 'nearest',
    axis: 'z',
    initialAngle: 0,
    totalRotation: 0,
    angleIncrement: 10,
    sliceInterval: 1,
    opacity: 100,
    surfaceCueing: 0,
    interiorCueing: 0,
    frames: [0],
    readFrame: async (index) => frame('uint8', [2, 2], pages[index]!),
  })
  // 单切片绕 Z 轴：画布为正方形（宽取偶数）。
  assert.deepEqual([...projected[0]!.shape], [2, 2])
  assert.deepEqual(Array.from(projected[0]!.data as Uint8Array), [1, 2, 3, 4])
})

test('计算量超过预算时明确报错', async () => {
  await assert.rejects(() => project3d({
    method: 'mean',
    axis: 'y',
    initialAngle: 0,
    totalRotation: 360,
    angleIncrement: 1,
    sliceInterval: 1,
    opacity: 0,
    surfaceCueing: 0,
    interiorCueing: 0,
    frames: [0, 1, 2, 3],
    readFrame: async () => frame('uint8', [64, 64], new Array(4096).fill(1)),
    budget: 1000,
  }), /计算量过大/)
})

test('多通道数据被明确拒绝', async () => {
  await assert.rejects(() => project3d({
    method: 'mean',
    axis: 'y',
    initialAngle: 0,
    totalRotation: 0,
    angleIncrement: 10,
    sliceInterval: 1,
    opacity: 0,
    surfaceCueing: 0,
    interiorCueing: 0,
    frames: [0],
    readFrame: async () => ({
      dtype: 'uint8',
      axes: ['c', 'y', 'x'] as const,
      shape: [3, 2, 2],
      region: { start: [0, 0, 0], shape: [3, 2, 2] },
      data: new Uint8Array(12),
    }),
  }), /多通道/)
})
