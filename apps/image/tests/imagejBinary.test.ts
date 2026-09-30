import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeParticles, closeBinary, dilate, erode, fillHoles, openBinary } from '../src/imagej/lib/binary.ts'
import type { GrayImage } from '../src/imagej/lib/processor.ts'

function mask(rows: string[]): GrayImage {
  const width = rows[0].length
  return { width, height: rows.length, data: Uint8Array.from(rows.join('').split('').map((pixel) => pixel === '#' ? 255 : 0)) }
}

function rows(image: GrayImage): string[] {
  return Array.from({ length: image.height }, (_, y) =>
    [...image.data.subarray(y * image.width, (y + 1) * image.width)].map((pixel) => pixel ? '#' : '.').join(''))
}

test('腐蚀和膨胀以白色为前景，并保持输入不变', () => {
  const source = mask(['.....', '.....', '..#..', '.....', '.....'])
  assert.deepEqual(rows(dilate(source)), ['.....', '.###.', '.###.', '.###.', '.....'])
  assert.deepEqual(rows(erode(dilate(source))), ['.....', '.....', '..#..', '.....', '.....'])
  assert.deepEqual(rows(source), ['.....', '.....', '..#..', '.....', '.....'])
})

test('开运算消除孤立白点，闭运算修补小孔', () => {
  const spot = mask(['.....', '.....', '..#..', '.....', '.....'])
  assert.deepEqual(rows(openBinary(spot)), ['.....', '.....', '.....', '.....', '.....'])
  const hole = mask(['#####', '#####', '##.##', '#####', '#####'])
  assert.deepEqual(rows(closeBinary(hole)), ['.....', '.###.', '.###.', '.###.', '.....'])
})

test('填孔只填内部黑色区域，保留与边界连通的背景', () => {
  const source = mask(['.......', '.#####.', '.#...#.', '.#...#.', '.#####.', '.......'])
  assert.deepEqual(rows(fillHoles(source)), ['.......', '.#####.', '.#####.', '.#####.', '.#####.', '.......'])
})

test('粒子分析使用 8 连通并计算面积、边界与质心', () => {
  const source = mask(['#.....', '.#....', '......', '...##.', '...##.'])
  const result = analyzeParticles(source)
  assert.equal(result.length, 2)
  assert.deepEqual(result.map((particle) => particle.area), [2, 4])
  assert.deepEqual(result.map((particle) => particle.perimeter), [8, 8])
  assert.deepEqual(result[0].bounds, { x: 0, y: 0, width: 2, height: 2 })
  assert.deepEqual([result[1].centroidX, result[1].centroidY], [4, 4])
  assert.deepEqual(analyzeParticles(source, 3).map((particle) => particle.area), [4])
})
