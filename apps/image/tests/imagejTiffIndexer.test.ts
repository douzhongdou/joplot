import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTiffIndex, indexTiff } from '../src/imagej/engine/tiff/indexer.ts'
import { segmentsInRegion, totalFrames, type TiffPage } from '../src/imagej/engine/tiff/index.ts'
import { buildTiffBytes, type BuildPage } from './helpers/tiffBuilder.ts'

/** 带读取记录的 reader，用于断言读取区间与 IO 次数。 */
function spy(source: Uint8Array) {
  const reads: Array<[number, number]> = []
  const read = async (offset: number, length: number): Promise<Uint8Array> => {
    reads.push([offset, offset + length])
    return source.slice(offset, offset + length)
  }
  return { read, reads }
}

test('索引多页 strip TIFF，且全程不读取像素区', async () => {
  const specs: BuildPage[] = [
    { width: 64, height: 64, bits: 16 },
    { width: 64, height: 64, bits: 16 },
    { width: 64, height: 64, bits: 16 },
  ]
  const { bytes, pixelStart } = buildTiffBytes(specs)
  const { read, reads } = spy(bytes)
  const index = await buildTiffIndex(read, bytes.length)

  assert.equal(index.pages.length, 3)
  assert.equal(index.big, false)
  assert.equal(index.littleEndian, true)
  for (const page of index.pages) {
    assert.equal(page.width, 64)
    assert.equal(page.height, 64)
    assert.equal(page.bitsPerSample, 16)
    assert.equal(page.components, 1)
    assert.equal(page.layout, 'strip')
    assert.equal(page.pixelByteLength, 64 * 64 * 2)
    assert.equal(page.segments.length, 1)
  }
  // 地基断言：没有任何一次读取触及像素区。
  assert.deepEqual(reads.filter(([start]) => start >= pixelStart), [], `索引阶段读取了像素区（起始于 ${pixelStart}）`)
})

test('多行条带的分段按行切分且偏移递增', async () => {
  const { bytes, pixelStart } = buildTiffBytes([{ width: 32, height: 20, bits: 16, rowsPerStrip: 8 }])
  const index = await buildTiffIndex(async (o, l) => bytes.slice(o, o + l), bytes.length)
  const page = index.pages[0]!

  assert.equal(page.segments.length, 3)
  assert.deepEqual(page.segments.map((s) => [s.y, s.height]), [[0, 8], [8, 8], [16, 4]])
  for (const segment of page.segments) {
    assert.equal(segment.x, 0)
    assert.equal(segment.width, 32)
    assert.ok(segment.offset >= pixelStart, '条带偏移应落在像素区')
  }
  for (let i = 1; i < page.segments.length; i += 1) {
    assert.ok(page.segments[i]!.offset >= page.segments[i - 1]!.offset, '条带偏移应递增')
  }
})

test('tiled TIFF 的分段按行优先排列（ImageJ 直接拒绝该格式）', async () => {
  const { bytes, pixelStart } = buildTiffBytes([
    { width: 40, height: 40, bits: 16, layout: 'tile', tileWidth: 16, tileHeight: 16 },
  ])
  const { read, reads } = spy(bytes)
  const index = await buildTiffIndex(read, bytes.length)
  const page = index.pages[0]!

  assert.equal(page.layout, 'tile')
  assert.equal(page.tileWidth, 16)
  assert.equal(page.tileHeight, 16)
  // 40x40 / 16x16 => 3x3 = 9 个 tile，边缘 tile 被裁剪。
  assert.equal(page.segments.length, 9)
  assert.deepEqual(page.segments.map((s) => [s.x, s.y, s.width, s.height]), [
    [0, 0, 16, 16], [16, 0, 16, 16], [32, 0, 8, 16],
    [0, 16, 16, 16], [16, 16, 16, 16], [32, 16, 8, 16],
    [0, 32, 16, 8], [16, 32, 16, 8], [32, 32, 8, 8],
  ])
  assert.deepEqual(reads.filter(([start]) => start >= pixelStart), [])
})

test('BigTIFF 索引正确，且 64 位像素偏移不被截断', async () => {
  const { bytes } = buildTiffBytes(
    [{ width: 64, height: 64, bits: 16, rowsPerStrip: 32, pixelOffset: 0x100000000 }],
    { big: true },
  )
  const index = await buildTiffIndex(async (o, l) => bytes.slice(o, o + l), bytes.length)

  assert.equal(index.big, true)
  const page = index.pages[0]!
  assert.equal(page.segments.length, 2)
  // 0x100000000 需要 64 位才能表示，若按 32 位读取会变成 0。
  assert.equal(page.segments[0]!.offset, 0x100000000)
  assert.equal(page.segments[1]!.offset, 0x100000000)
})

test('索引 IO 次数被压到最小，可内联的 tag 不产生额外读取', async () => {
  // 单条带：StripOffsets 与 StripByteCounts 的 count 均为 1，可内联进 tag 条目，
  // 因此只有「文件头 1 次 + IFD 1 次」共 2 次读取。
  const single = buildTiffBytes([{ width: 64, height: 64, bits: 16 }]).bytes
  const a = spy(single)
  await buildTiffIndex(a.read, single.length)
  assert.equal(a.reads.length, 2, `单条带实际读取 ${JSON.stringify(a.reads)}`)

  // 多条带：两个偏移数组落在 IFD 之外，合并为 1 次读取，总计 3 次。
  const multi = buildTiffBytes([{ width: 64, height: 64, bits: 16, rowsPerStrip: 8 }]).bytes
  const b = spy(multi)
  await buildTiffIndex(b.read, multi.length)
  assert.equal(b.reads.length, 3, `多条带实际读取 ${JSON.stringify(b.reads)}`)

  // 多页共享行外数组合并：每页各 2 次，不因页数增长而退化。
  const many = buildTiffBytes([
    { width: 64, height: 64, bits: 16, rowsPerStrip: 8 },
    { width: 64, height: 64, bits: 16, rowsPerStrip: 8 },
    { width: 64, height: 64, bits: 16, rowsPerStrip: 8 },
  ]).bytes
  const c = spy(many)
  await buildTiffIndex(c.read, many.length)
  assert.equal(c.reads.length, 1 + 3 * 2, `三页实际读取 ${JSON.stringify(c.reads)}`)
})

test('区域裁剪只选出与视口相交的分段', async () => {
  const { bytes } = buildTiffBytes([{ width: 64, height: 64, bits: 16, layout: 'tile', tileWidth: 16, tileHeight: 16 }])
  const index = await buildTiffIndex(async (o, l) => bytes.slice(o, o + l), bytes.length)
  const page = index.pages[0]!

  assert.equal(segmentsInRegion(page).length, 16)
  assert.equal(segmentsInRegion(page, { x: 0, y: 0, width: 16, height: 16 }).length, 1)
  // 视口跨 3x3 网格中心，命中全部 9 个 tile。
  assert.equal(segmentsInRegion(page, { x: 8, y: 8, width: 32, height: 32 }).length, 9)
  // 只覆盖第一行 tile 的高度。
  assert.equal(segmentsInRegion(page, { x: 0, y: 0, width: 64, height: 8 }).length, 4)
  assert.equal(segmentsInRegion(page, { x: 100, y: 100, width: 8, height: 8 }).length, 0)
})

test('RGB 与 32 位浮点的分量和位深被正确索引', async () => {
  const rgb = buildTiffBytes([{ width: 32, height: 32, bits: 8, components: 3 }])
  const rgbIndex = await buildTiffIndex(async (o, l) => rgb.bytes.slice(o, o + l), rgb.bytes.length)
  assert.equal(rgbIndex.pages[0]!.components, 3)
  assert.equal(rgbIndex.pages[0]!.pixelByteLength, 32 * 32 * 3)

  const float = buildTiffBytes([{ width: 16, height: 16, bits: 32 }])
  const floatIndex = await buildTiffIndex(async (o, l) => float.bytes.slice(o, o + l), float.bytes.length)
  assert.equal(floatIndex.pages[0]!.bitsPerSample, 32)
  assert.equal(floatIndex.pages[0]!.pixelByteLength, 16 * 16 * 4)
})

test('索引出全部页并累计帧数', async () => {
  const { bytes } = buildTiffBytes([
    { width: 16, height: 16, bits: 8 },
    { width: 16, height: 16, bits: 8 },
  ])
  const index = await buildTiffIndex(async (o, l) => bytes.slice(o, o + l), bytes.length)
  assert.equal(totalFrames(index), 2)
})

test('每页记录自己的字节序', async () => {
  const little = buildTiffBytes([{ width: 8, height: 8, bits: 16 }])
  const littleIndex = await buildTiffIndex(async (o, l) => little.bytes.slice(o, o + l), little.bytes.length)
  assert.equal(littleIndex.pages[0]!.littleEndian, true)

  const big = buildTiffBytes([{ width: 8, height: 8, bits: 16 }], { bigEndian: true })
  const bigIndex = await buildTiffIndex(async (o, l) => big.bytes.slice(o, o + l), big.bytes.length)
  assert.equal(bigIndex.littleEndian, false)
  assert.equal(bigIndex.pages[0]!.littleEndian, false)
})

test('拒绝损坏的输入而不是静默产出错误索引', async () => {
  const good = buildTiffBytes([{ width: 16, height: 16, bits: 8 }]).bytes
  const run = (source: Uint8Array) => buildTiffIndex(async (o, l) => source.slice(o, o + l), source.length)

  const badOrder = good.slice()
  badOrder[1] = 0x58
  await assert.rejects(() => run(badOrder), /字节序标记非法/)
  await assert.rejects(() => run(good.slice(0, 4)), /文件过小/)

  const badMagic = good.slice()
  new DataView(badMagic.buffer).setUint16(2, 7, true)
  await assert.rejects(() => run(badMagic), /不是 TIFF 文件/)

  const noStrip = buildTiffBytes([{ width: 16, height: 16, bits: 8, omitStripOffsets: true }]).bytes
  await assert.rejects(() => run(noStrip), /StripOffsets/)

  const noTiles = buildTiffBytes([{ width: 40, height: 40, layout: 'tile', omitTileOffsets: true }]).bytes
  await assert.rejects(() => run(noTiles), /像素数据偏移/)
})

test('IFD 链成环时终止而不是无限循环', async () => {
  const { bytes } = buildTiffBytes([
    { width: 16, height: 16, bits: 8 },
    { width: 16, height: 16, bits: 8 },
  ])
  // 让第一页的 next 指回自己。
  const view = new DataView(bytes.buffer)
  const ifd0 = 8
  const entryCount = view.getUint16(ifd0, true)
  view.setUint32(ifd0 + 2 + entryCount * 12, ifd0, true)
  await assert.rejects(
    () => buildTiffIndex(async (o, l) => bytes.slice(o, o + l), bytes.length),
    /IFD 链出现环/,
  )
})

test('indexTiff 包装 Blob 句柄', async () => {
  const { bytes } = buildTiffBytes([{ width: 8, height: 8, bits: 16 }])
  const handle = await indexTiff(new Blob([bytes]))
  assert.equal(handle.index.pages.length, 1)
  const page: TiffPage = handle.index.pages[0]!
  assert.equal(page.bitsPerSample, 16)
  assert.equal(page.segments.length, 1)
})