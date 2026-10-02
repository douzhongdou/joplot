import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTiffIndex, indexTiff } from '../src/imagej/engine/tiff/indexer.ts'
import { segmentsInRegion, totalFrames, type TiffPage } from '../src/imagej/engine/tiff/index.ts'

/**
 * 测试用的 TIFF 构造器。
 *
 * 布局固定为「头部 → 各页 IFD → 各页行外数组 → 全部像素数据」，即 IFD 全部前置、
 * 像素数据后置。这是科学 TIFF 的常见形态，也让「索引阶段是否读取像素」可以被精确断言：
 * 只要所有读取区间都落在 pixelStart 之前，就证明索引没有触碰像素数据。
 *
 * 构造分两阶段：先按 spec 定出每页的 tag 计划（决定 IFD 与数组的字节数），
 * 再据此排布位置并填入依赖像素位置的偏移值。
 */
interface PageSpec {
  width: number
  height: number
  bits?: number
  components?: number
  layout?: 'strip' | 'tile'
  rowsPerStrip?: number
  tileWidth?: number
  tileHeight?: number
  /** 强制写入的像素分段偏移，用于验证 BigTIFF 的 64 位偏移不被截断。 */
  pixelOffset?: number
  /** 省略 StripOffsets，用于构造非法样本。 */
  omitStripOffsets?: boolean
  /** 省略 TileOffsets，用于构造非法样本。 */
  omitTileOffsets?: boolean
}

interface EntryPlan {
  tag: number
  type: number
  count: number
}

function segmentCount(spec: PageSpec): number {
  if (spec.layout === 'tile') {
    const tw = spec.tileWidth ?? 16
    const th = spec.tileHeight ?? 16
    return Math.ceil(spec.width / tw) * Math.ceil(spec.height / th)
  }
  return Math.ceil(spec.height / (spec.rowsPerStrip ?? spec.height))
}

const OFFSET_TAGS = new Set([273, 279, 324, 325])

function planEntries(spec: PageSpec, big: boolean): EntryPlan[] {
  const bits = spec.bits ?? 16
  const components = spec.components ?? 1
  const count = segmentCount(spec)
  const list: EntryPlan[] = []
  // 单值且不超过 16 位时用 SHORT，多值或大值用 LONG；这决定该值是内联还是行外。
  // BigTIFF 的偏移类 tag 必须用 LONG8（8 字节），否则 >4 GiB 的偏移无法表达。
  const add = (tag: number, values: number[]): void => {
    const type = big && OFFSET_TAGS.has(tag)
      ? 16
      : values.length === 1 && values[0]! >= 0 && values[0]! <= 0xffff ? 3 : 4
    list.push({ tag, type, count: values.length })
  }
  add(256, [spec.width])
  add(257, [spec.height])
  add(258, [bits])
  add(259, [1])
  if (spec.layout === 'tile') {
    add(277, [components])
    add(284, [1])
    add(322, [spec.tileWidth ?? 16])
    add(323, [spec.tileHeight ?? 16])
    if (!spec.omitTileOffsets) {
      add(324, new Array<number>(count).fill(0))
      add(325, new Array<number>(count).fill(0))
    }
  } else {
    if (!spec.omitStripOffsets) add(273, new Array<number>(count).fill(0))
    add(277, [components])
    add(278, [spec.rowsPerStrip ?? spec.height])
    add(279, new Array<number>(count).fill(0))
    add(284, [1])
  }
  return list
}

// 经典 TIFF 的字段宽度：SHORT 2 字节，其余按 LONG 4 字节；
  // BigTIFF 下 LONG8(16) 占 8 字节。
  const fieldSize = (type: number): number => (type === 3 ? 2 : type === 16 ? 8 : 4)

function buildTiff(specs: PageSpec[], options: { big?: boolean } = {}) {
  const big = options.big ?? false
  const little = true
  const entrySize = big ? 20 : 12
  const countSize = big ? 8 : 2
  const nextSize = big ? 8 : 4
  const stride = big ? 8 : 4

  const plans = specs.map((spec) => planEntries(spec, big))
  const ifdAt: number[] = []
  const arraysAt: number[] = []
  // 经典 TIFF 头占 0..7（首个 IFD 偏移为 4 字节）；BigTIFF 头占 0..19
  // （LengthOfOffsetField 4、保留 2、条目长度 2、首个 IFD 偏移 8 字节）。
  let cursor = big ? 20 : 8
  plans.forEach((plan) => {
    ifdAt.push(cursor)
    cursor += countSize + plan.length * entrySize + nextSize
    arraysAt.push(cursor)
    cursor += plan.reduce((sum, item) => {
      const size = item.count * fieldSize(item.type)
      return size <= stride ? sum : sum + size
    }, 0)
  })
  const pixelStart = cursor

  const bytesPerPage = specs.map((spec) =>
    (spec.width * spec.height * (spec.bits ?? 16) * (spec.components ?? 1)) / 8)
  const bytes = new Uint8Array(pixelStart + bytesPerPage.reduce((a, b) => a + b, 0))
  const view = new DataView(bytes.buffer)

  bytes[0] = 0x49
  bytes[1] = 0x49
  view.setUint16(2, big ? 43 : 42, little)
  if (big) {
    view.setUint16(4, 8, little)   // LengthOfOffsetField
    view.setUint16(6, 0, little)   // reserved
    view.setUint16(8, 20, little)  // tag 条目字节数
    view.setBigUint64(12, BigInt(ifdAt[0]!), little)
  } else {
    view.setUint32(4, ifdAt[0]!, little)
  }

  const pixelCursor = pixelStart
  specs.forEach((spec, page) => {
    const bits = spec.bits ?? 16
    const components = spec.components ?? 1
    const count = segmentCount(spec)
    const perSegment = Math.floor(bytesPerPage[page]! / count)
    const offsets = Array.from({ length: count }, (_, i) =>
      spec.pixelOffset ?? pixelCursor + i * perSegment)

    // tag 值表：与 planEntries 的 tag 顺序一一对应。
    const values = new Map<number, number[]>()
    values.set(256, [spec.width])
    values.set(257, [spec.height])
    values.set(258, [bits])
    values.set(259, [1])
    values.set(277, [components])
    values.set(284, [1])
    if (spec.layout === 'tile') {
      values.set(322, [spec.tileWidth ?? 16])
      values.set(323, [spec.tileHeight ?? 16])
      if (!spec.omitTileOffsets) {
        values.set(324, offsets)
        values.set(325, new Array<number>(count).fill(perSegment))
      }
    } else {
      if (!spec.omitStripOffsets) values.set(273, offsets)
      values.set(278, [spec.rowsPerStrip ?? spec.height])
      values.set(279, new Array<number>(count).fill(perSegment))
    }

    const at = ifdAt[page]!
    if (big) view.setBigUint64(at, BigInt(plans[page]!.length), little)
    else view.setUint16(at, plans[page]!.length, little)

    let arrayCursor = arraysAt[page]!
    plans[page]!.forEach((item, index) => {
      const at2 = at + countSize + index * entrySize
      const data = values.get(item.tag)!
      view.setUint16(at2, item.tag, little)
      view.setUint16(at2 + 2, item.type, little)
      if (big) view.setBigUint64(at2 + 4, BigInt(item.count), little)
      else view.setUint32(at2 + 4, item.count, little)
      const size = item.count * fieldSize(item.type)
      const writeAt = size <= stride ? at2 + (big ? 12 : 8) : arrayCursor
      data.forEach((value, i) => {
        if (item.type === 3) view.setUint16(writeAt + i * 2, value, little)
        else if (item.type === 16) view.setBigUint64(writeAt + i * 8, BigInt(value), little)
        else view.setUint32(writeAt + i * 4, value, little)
      })
      if (size > stride) {
        arrayCursor += size
        if (big) view.setBigUint64(at2 + 12, BigInt(writeAt), little)
        else view.setUint32(at2 + 8, writeAt, little)
      }
    })
    const nextAt = at + countSize + plans[page]!.length * entrySize
    const next = page + 1 < specs.length ? ifdAt[page + 1]! : 0
    if (big) view.setBigUint64(nextAt, BigInt(next), little)
    else view.setUint32(nextAt, next, little)
  })

  return { bytes, pixelStart }
}

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
  const specs: PageSpec[] = [
    { width: 64, height: 64, bits: 16 },
    { width: 64, height: 64, bits: 16 },
    { width: 64, height: 64, bits: 16 },
  ]
  const { bytes, pixelStart } = buildTiff(specs)
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
  const { bytes, pixelStart } = buildTiff([{ width: 32, height: 20, bits: 16, rowsPerStrip: 8 }])
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
  const { bytes, pixelStart } = buildTiff([
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
  const { bytes } = buildTiff(
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
  const single = buildTiff([{ width: 64, height: 64, bits: 16 }]).bytes
  const a = spy(single)
  await buildTiffIndex(a.read, single.length)
  assert.equal(a.reads.length, 2, `单条带实际读取 ${JSON.stringify(a.reads)}`)

  // 多条带：两个偏移数组落在 IFD 之外，合并为 1 次读取，总计 3 次。
  const multi = buildTiff([{ width: 64, height: 64, bits: 16, rowsPerStrip: 8 }]).bytes
  const b = spy(multi)
  await buildTiffIndex(b.read, multi.length)
  assert.equal(b.reads.length, 3, `多条带实际读取 ${JSON.stringify(b.reads)}`)

  // 多页共享行外数组合并：每页各 2 次，不因页数增长而退化。
  const many = buildTiff([
    { width: 64, height: 64, bits: 16, rowsPerStrip: 8 },
    { width: 64, height: 64, bits: 16, rowsPerStrip: 8 },
    { width: 64, height: 64, bits: 16, rowsPerStrip: 8 },
  ]).bytes
  const c = spy(many)
  await buildTiffIndex(c.read, many.length)
  assert.equal(c.reads.length, 1 + 3 * 2, `三页实际读取 ${JSON.stringify(c.reads)}`)
})

test('区域裁剪只选出与视口相交的分段', async () => {
  const { bytes } = buildTiff([{ width: 64, height: 64, bits: 16, layout: 'tile', tileWidth: 16, tileHeight: 16 }])
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
  const rgb = buildTiff([{ width: 32, height: 32, bits: 8, components: 3 }])
  const rgbIndex = await buildTiffIndex(async (o, l) => rgb.bytes.slice(o, o + l), rgb.bytes.length)
  assert.equal(rgbIndex.pages[0]!.components, 3)
  assert.equal(rgbIndex.pages[0]!.pixelByteLength, 32 * 32 * 3)

  const float = buildTiff([{ width: 16, height: 16, bits: 32 }])
  const floatIndex = await buildTiffIndex(async (o, l) => float.bytes.slice(o, o + l), float.bytes.length)
  assert.equal(floatIndex.pages[0]!.bitsPerSample, 32)
  assert.equal(floatIndex.pages[0]!.pixelByteLength, 16 * 16 * 4)
})

test('索引出全部页并累计帧数', async () => {
  const { bytes } = buildTiff([
    { width: 16, height: 16, bits: 8 },
    { width: 16, height: 16, bits: 8 },
  ])
  const index = await buildTiffIndex(async (o, l) => bytes.slice(o, o + l), bytes.length)
  assert.equal(totalFrames(index), 2)
})

test('拒绝损坏的输入而不是静默产出错误索引', async () => {
  const good = buildTiff([{ width: 16, height: 16, bits: 8 }]).bytes
  const run = (source: Uint8Array) => buildTiffIndex(async (o, l) => source.slice(o, o + l), source.length)

  const badOrder = good.slice()
  badOrder[1] = 0x58
  await assert.rejects(() => run(badOrder), /字节序标记非法/)
  await assert.rejects(() => run(good.slice(0, 4)), /文件过小/)

  const badMagic = good.slice()
  new DataView(badMagic.buffer).setUint16(2, 7, true)
  await assert.rejects(() => run(badMagic), /不是 TIFF 文件/)

  const noStrip = buildTiff([{ width: 16, height: 16, bits: 8, omitStripOffsets: true }]).bytes
  await assert.rejects(() => run(noStrip), /StripOffsets/)

  const noTiles = buildTiff([{ width: 40, height: 40, layout: 'tile', omitTileOffsets: true }]).bytes
  await assert.rejects(() => run(noTiles), /像素数据偏移/)
})

test('IFD 链成环时终止而不是无限循环', async () => {
  const { bytes } = buildTiff([
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
  const { bytes } = buildTiff([{ width: 8, height: 8, bits: 16 }])
  const handle = await indexTiff(new Blob([bytes]))
  assert.equal(handle.index.pages.length, 1)
  const page: TiffPage = handle.index.pages[0]!
  assert.equal(page.bitsPerSample, 16)
  assert.equal(page.segments.length, 1)
})