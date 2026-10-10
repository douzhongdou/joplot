import test from 'node:test'
import assert from 'node:assert/strict'
import { importImageStack } from '../src/imagej/engine/importer.ts'
import { encodeTiffStack } from '../src/imagej/engine/tiff.ts'
import type { ImageBlock } from '../src/imagej/engine/types.ts'

function page(value: number, w = 32, h = 32): ImageBlock {
  const data = new Uint8Array(w * h).fill(value)
  return { dtype: 'uint8', axes: ['y', 'x'], shape: [h, w], region: { start: [0, 0], shape: [h, w] }, data }
}

async function fileFrom(block: ImageBlock, name: string): Promise<File> {
  const blob = await encodeTiffStack((async function* () { yield block })(), 1)
  return new File([blob], name)
}

test('importImageStack 惰性合成 z 轴 Stack 并按页读取', async () => {
  const files = [await fileFrom(page(10), 'a.tif'), await fileFrom(page(200), 'b.tif')]
  const result = await importImageStack(files)
  assert.deepEqual([...result.dataset.axes], ['z', 'y', 'x'])
  assert.deepEqual([...result.dataset.shape], [2, 32, 32])
  assert.equal(result.dataset.componentKind, 'scalar')

  const first = await result.storage.readRegion({ start: [0, 0, 0], shape: [1, 32, 32] })
  const second = await result.storage.readRegion({ start: [1, 0, 0], shape: [1, 32, 32] })
  assert.equal(first.data[0], 10)
  assert.equal(second.data[0], 200)
  // 返回块的轴必须与 dataset 对齐，否则下游 region 会错位
  assert.deepEqual([...first.axes], ['z', 'y', 'x'])
  assert.deepEqual([...first.shape], [1, 32, 32])

  result.storage.release()
})

test('importImageStack 支持空间子区域读取并按页定位', async () => {
  const files = [await fileFrom(page(30), 'a.tif'), await fileFrom(page(90), 'b.tif')]
  const result = await importImageStack(files)
  const patch = await result.storage.readRegion({ start: [1, 4, 8], shape: [1, 4, 4] })
  assert.deepEqual([...patch.region.start], [1, 4, 8])
  assert.deepEqual([...patch.shape], [1, 4, 4])
  assert.ok([...patch.data].every((value) => value === 90))
  result.storage.release()
})

test('importImageStack 惰性校验：尺寸不一致的页在首次读取时才报错', async () => {
  const files = [await fileFrom(page(10, 32, 32), 'a.tif'), await fileFrom(page(200, 16, 16), 'b.tif')]
  // 导入只解码第一页，因此这里不会失败
  const result = await importImageStack(files)
  assert.deepEqual([...result.dataset.shape], [2, 32, 32])
  // 翻到第二页（尺寸不符）时才拒绝
  await assert.rejects(() => result.storage.readRegion({ start: [1, 0, 0], shape: [1, 32, 32] }), /不一致|无法/)
})

test('importImageStack 少于两张时拒绝', async () => {
  const files = [await fileFrom(page(10), 'a.tif')]
  await assert.rejects(() => importImageStack(files), /至少需要两张/)
})
