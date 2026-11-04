import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineHost } from '../src/imagej/engine/worker/host.ts'
import { createRecipe, makeStep } from '../src/imagej/engine/recipe.ts'
import { importMemory } from '../src/imagej/engine/importer.ts'
import { projectFrames } from '../src/imagej/engine/stackProject.ts'
import { encodeTiffStack } from '../src/imagej/engine/tiff.ts'
import { rasterizeViewport } from '../src/imagej/engine/render/raster.ts'
import { displayBlock } from '../src/imagej/engine/render/display.ts'
import { computeWindowLevel } from '../src/imagej/engine/render/rgba.ts'
import { SharedStorage, MemoryStorage } from '../src/imagej/engine/storage.ts'
import { TiffPageSource } from '../src/imagej/engine/tiff/source.ts'
import { buildTiffBytes } from './helpers/tiffBuilder.ts'
import type { ImageBlock } from '../src/imagej/engine/types.ts'

function frame(values: number[], rgb = false, width = 2): ImageBlock {
  const shape = rgb ? [3, values.length / 3 / width, width] : [values.length / width, width]
  return { dtype: 'uint8', axes: rgb ? ['c', 'y', 'x'] : ['y', 'x'], shape, region: { start: shape.map(() => 0), shape }, data: Uint8Array.from(values) }
}

async function importFrames(host: EngineHost, blocks: ImageBlock[]) {
  const blob = await encodeTiffStack((async function* () { yield* blocks })(), blocks.length)
  return host.import(new File([blob], 'audit.tif'))
}

async function read(host: EngineHost, id: string, z = 0) {
  const dataset = host.dataset(id)!
  const result = await host.run({ datasetId: id, recipe: createRecipe(id, dataset.revision), selection: { z } })
  assert.equal(result.results.some((step) => step.status === 'error'), false)
  return result.image!
}

test('int16 全值域的视口亮度与 PNG 显示块一致，RGB 和灰度显示也一致', () => {
  const values = Int16Array.from({ length: 65536 }, (_, i) => i - 32768)
  const gray: ImageBlock = { dtype: 'int16', axes: ['y', 'x'], shape: [1, values.length], region: { start: [0, 0], shape: [1, values.length] }, data: values }
  const rgb: ImageBlock = { ...gray, axes: ['c', 'y', 'x'], shape: [3, 1, 3], region: { start: [0, 0, 0], shape: [3, 1, 3] }, data: Int16Array.from([-1000, 0, 1000, 32767, -32768, 256, 0, 1000, -1000]) }
  for (const [block, options] of [[gray, {}], [rgb, {}], [rgb, { gray: true }]] as const) {
    const width = block.shape[block.axes.indexOf('x')]!
    const settings = computeWindowLevel(block)
    const rgba = rasterizeViewport(block, { zoom: 1, panX: 0, panY: 0, devicePixelRatio: 1, viewportWidth: width, viewportHeight: 1 }, settings, options)
    const display = displayBlock(block, settings, options)
    const planes = display.axes.includes('c') ? 3 : 1
    for (let i = 0; i < width; i++) for (let c = 0; c < 3; c++) {
      assert.equal(rgba[i * 4 + c], display.data[(planes === 3 ? c * width : 0) + i], `像素 ${i} 通道 ${c}`)
    }
  }
  const sample = { ...gray, shape: [1, 3], data: Int16Array.from([-1000, 0, 1000]) }
  const rgba = rasterizeViewport(sample, { zoom: 1, panX: 0, panY: 0, devicePixelRatio: 1, viewportWidth: 3, viewportHeight: 1 }, computeWindowLevel(sample))
  assert.deepEqual([rgba[0], rgba[4], rgba[8]], [0, 128, 255])
})

test('debayer 后 Z 投影保留三个通道，分组投影保留处理后的布局', async () => {
  const host = new EngineHost()
  const imported = await importFrames(host, Array.from({ length: 4 }, () => frame([10, 40, 40, 90])))
  const recipe = createRecipe(imported.dataset.id, 0, [makeStep('debayer', { pattern: 'rggb', algorithm: 'bilinear' }, { kind: 'stack' })])
  for (const groupSize of [undefined, 2]) {
    const dataset = await host.project({ datasetId: imported.dataset.id, recipe, selection: {}, method: 'average', groupSize })
    assert.ok(dataset)
    assert.equal(dataset.componentKind, 'rgb')
    assert.deepEqual([...dataset.axes], groupSize ? ['c', 'z', 'y', 'x'] : ['c', 'y', 'x'])
    assert.deepEqual([...dataset.shape], groupSize ? [3, 2, 2, 2] : [3, 2, 2])
    assert.deepEqual([...(await read(host, dataset.id)).data], [10, 10, 10, 10, 40, 40, 40, 40, 90, 90, 90, 90])
    assert.equal(dataset.channels.length, 3)
  }
  host.dispose()
})

test('RGB 整栈 grayscale 后投影成为单通道，不保留空 RGB 平面', async () => {
  const host = new EngineHost()
  const imported = await importFrames(host, [frame([30, 60, 60, 90, 90, 120], true), frame([30, 60, 60, 90, 90, 120], true)])
  const recipe = createRecipe(imported.dataset.id, 0, [makeStep('grayscale', {}, { kind: 'stack' })])
  const dataset = await host.project({ datasetId: imported.dataset.id, recipe, selection: {}, method: 'average' })
  assert.ok(dataset)
  assert.deepEqual([...dataset.axes], ['y', 'x'])
  assert.deepEqual([...dataset.shape], [1, 2])
  assert.equal(dataset.componentKind, 'scalar')
  assert.equal(dataset.channels.length, 1)
  assert.deepEqual([...(await read(host, dataset.id)).data], [60, 90])
  host.dispose()
})

test('投影拒绝帧级 debayer 的混合灰度/RGB，也拒绝元素数相同但尺寸不同的帧', async () => {
  const host = new EngineHost()
  const imported = await importFrames(host, [frame([10, 40, 40, 90]), frame([10, 40, 40, 90])])
  const recipe = createRecipe(imported.dataset.id, 0, [makeStep('debayer', { pattern: 'rggb', algorithm: 'bilinear' }, { kind: 'frame', selection: { z: 0 } })])
  await assert.rejects(host.project({ datasetId: imported.dataset.id, recipe, selection: {}, method: 'average' }), /处理后的各页.*通道数/)
  await assert.rejects(projectFrames({ method: 'average', frames: [0, 1], readFrame: async (i) => i ? frame([1, 2, 3, 4], false, 4) : frame([1, 2, 3, 4]) }), /同尺寸/)
  host.dispose()
})

test('所有结构编辑保留整栈和帧级 Recipe；页作用域随原页移动，插入页保持空白', async () => {
  const host = new EngineHost()
  const imported = await importFrames(host, [frame([10, 20]), frame([30, 40]), frame([50, 60])])
  const recipe = createRecipe(imported.dataset.id, 0, [makeStep('invert', {}, { kind: 'stack' }), makeStep('invert', {}, { kind: 'frame', selection: { z: 1 } })])
  const cases = [
    { op: 'reverse', expected: [[205, 195], [30, 40], [245, 235]] },
    { op: 'reduce', factor: 2, expected: [[245, 235], [205, 195]] },
    { op: 'substack', pages: [2, 1, 1], expected: [[205, 195], [30, 40], [30, 40]] },
    { op: 'delete', pages: [0], expected: [[30, 40], [205, 195]] },
    { op: 'add', at: 1, count: 1, expected: [[245, 235], [0, 0], [30, 40], [205, 195]] },
  ] as const
  for (const entry of cases) {
    const dataset = await host.restructure({ datasetId: imported.dataset.id, recipe, ...entry, pages: 'pages' in entry ? [...entry.pages] : undefined })
    assert.ok(dataset)
    for (let z = 0; z < entry.expected.length; z++) assert.deepEqual([...(await read(host, dataset.id, z)).data], entry.expected[z])
  }
  const pagesRecipe = createRecipe(imported.dataset.id, 0, [makeStep('invert', {}, { kind: 'pages', from: 1, to: 1 })])
  const reversed = await host.restructure({ datasetId: imported.dataset.id, recipe: pagesRecipe, op: 'reverse' })
  assert.deepEqual([...(await read(host, reversed!.id, 1)).data], [225, 215])
  host.dispose()
})

test('重排保留 debayer 后 RGB 形状和 dtype 变换，拒绝异形帧', async () => {
  const host = new EngineHost()
  const imported = await importFrames(host, [frame([10, 40, 40, 90]), frame([10, 40, 40, 90])])
  const recipe = createRecipe(imported.dataset.id, 0, [makeStep('debayer', { pattern: 'rggb', algorithm: 'bilinear' }, { kind: 'stack' })])
  const reversed = await host.restructure({ datasetId: imported.dataset.id, recipe, op: 'reverse' })
  assert.equal(reversed!.componentKind, 'rgb')
  assert.deepEqual([...reversed!.shape], [3, 2, 2, 2])
  const result = await read(host, reversed!.id)
  assert.deepEqual([...result.data], [10, 10, 10, 10, 40, 40, 40, 40, 90, 90, 90, 90])
  const mixed = createRecipe(imported.dataset.id, 0, [makeStep('debayer', { pattern: 'rggb', algorithm: 'bilinear' }, { kind: 'frame', selection: { z: 0 } })])
  await assert.rejects(host.restructure({ datasetId: imported.dataset.id, recipe: mixed, op: 'reverse' }), /处理后的各页/)
  const subset = await host.restructure({ datasetId: imported.dataset.id, recipe: mixed, op: 'substack', pages: [0] })
  assert.equal(subset!.componentKind, 'rgb')
  assert.deepEqual([...(await read(host, subset!.id)).data], [...result.data])

  const floatPages = [frame([10, 20]), frame([30, 40])].map((page): ImageBlock => ({ ...page, dtype: 'float32', data: Float32Array.from(page.data) }))
  const floats = await importFrames(host, floatPages)
  const convertedRecipe = createRecipe(floats.dataset.id, 0, [makeStep('threshold', { level: 25 }, { kind: 'stack' })])
  const converted = await host.restructure({ datasetId: floats.dataset.id, recipe: convertedRecipe, op: 'reverse' })
  assert.equal(converted!.dtype, 'uint8')
  assert.deepEqual([...(await read(host, converted!.id)).data], [255, 255])
  assert.deepEqual([...(await read(host, converted!.id, 1)).data], [0, 0])
  host.dispose()
})

test('派生页冻结 Recipe 及预览截止步骤，空间裁剪按处理后尺寸读取', async () => {
  const host = new EngineHost()
  const imported = await importFrames(host, [frame([10, 20, 30, 40]), frame([50, 60, 70, 80])])
  const inverted = makeStep('invert', {}, { kind: 'stack' })
  const recipe = createRecipe(imported.dataset.id, 0, [inverted, makeStep('invert', {}, { kind: 'stack' })])
  const dataset = (await host.restructure({ datasetId: imported.dataset.id, recipe, throughStepId: inverted.id, op: 'reverse' }))!
  inverted.op = 'threshold'
  const result = await host.run({ datasetId: dataset.id, recipe: createRecipe(dataset.id, 0), selection: { z: 0 }, roi: { start: [0, 0, 1], shape: [1, 2, 1] } })
  assert.deepEqual([...result.image!.data], [195, 175])
  assert.deepEqual(result.image!.region.start, [0, 0, 1])
  host.dispose()
})

test('关闭源 TIFF 和中间派生栈后，链式及兄弟派生栈仍能计算、导出', async () => {
  const host = new EngineHost()
  const imported = await importFrames(host, [frame([10, 20]), frame([30, 40])])
  const recipe = createRecipe(imported.dataset.id, 0, [makeStep('invert', {}, { kind: 'stack' })])
  const first = (await host.restructure({ datasetId: imported.dataset.id, recipe, op: 'reverse' }))!
  const sibling = (await host.restructure({ datasetId: imported.dataset.id, op: 'reverse' }))!
  const child = (await host.restructure({ datasetId: first.id, op: 'reverse' }))!
  host.dispose(imported.dataset.id)
  host.dispose(first.id)
  assert.deepEqual([...(await read(host, child.id)).data], [245, 235])
  assert.deepEqual([...(await read(host, sibling.id)).data], [30, 40])
  const blob = await encodeTiffStack((async function* () { for (let z = 0; z < 2; z++) yield await read(host, child.id, z) })(), 2)
  const source = await TiffPageSource.open(blob)
  assert.deepEqual([...(await source.readPage(1)).block.data], [225, 215])
  host.dispose(sibling.id)
  assert.deepEqual([...(await read(host, child.id, 1)).data], [225, 215])
  host.dispose()
  host.dispose()
})

test('共享存储只在最后一个引用和在途读取结束后释放一次', async () => {
  const meta = { dtype: 'uint8' as const, axes: ['y', 'x'] as const, shape: [1, 1], source: { kind: 'memory' as const, name: 'shared', format: 'memory' as const, fingerprint: 'shared' } }
  const source = new MemoryStorage('shared', meta, Uint8Array.of(10))
  let releases = 0
  let unblock!: () => void
  const gate = new Promise<void>((resolve) => { unblock = resolve })
  const shared = new SharedStorage({ ...source, id: source.id, metadata: () => meta, capabilities: () => source.capabilities(), async readRegion(region) { await gate; return source.readRegion(region) }, release() { releases++; source.release() } })
  const other = shared.retain()
  const pending = other.readRegion({ start: [0, 0], shape: [1, 1] })
  shared.release(); other.release(); other.release()
  assert.equal(releases, 0)
  unblock()
  assert.deepEqual([...(await pending).data], [10])
  assert.equal(releases, 1)
})

test('重排创建期间关闭源文档或整个宿主，不登记迟到的派生栈且释放源', async () => {
  for (const closeAll of [false, true]) {
    const host = new EngineHost()
    const imported = await importFrames(host, [frame([10, 20]), frame([30, 40])])
    const original = imported.storage
    let unblock!: () => void, notify!: () => void, releases = 0, reads = 0
    const gate = new Promise<void>((resolve) => { unblock = resolve })
    const started = new Promise<void>((resolve) => { notify = resolve })
    const source = new SharedStorage({
      id: original.id, metadata: () => original.metadata(), capabilities: () => original.capabilities(),
      async readRegion(region, options) { if (++reads === 2) notify(); await gate; return original.readRegion(region, options) },
      release() { releases++; original.release() },
    })
    const entries = (host as unknown as { entries: Map<string, { storage: import('../src/imagej/engine/storage.ts').Storage }> }).entries
    entries.get(imported.dataset.id)!.storage = source
    const recipe = createRecipe(imported.dataset.id, 0, [makeStep('invert', {}, { kind: 'stack' })])
    const pending = [host.restructure({ datasetId: imported.dataset.id, recipe, op: 'reverse' }), host.restructure({ datasetId: imported.dataset.id, recipe, op: 'reduce' })]
    await started
    host.dispose(closeAll ? undefined : imported.dataset.id)
    unblock()
    const results = await Promise.allSettled(pending)
    const remaining = entries.size, freed = releases
    host.dispose()
    assert.ok(results.every((result) => result.status === 'rejected' && result.reason instanceof Error && result.reason.name === 'AbortError'))
    assert.equal(remaining, 0)
    assert.equal(freed, 1)
  }
})

test('重排创建不会替换正在读取的显示请求的取消句柄', async () => {
  const host = new EngineHost()
  const imported = await importFrames(host, [frame([10, 20]), frame([30, 40])])
  const original = imported.storage
  let unblock!: () => void, notify!: () => void, signal: AbortSignal | undefined
  const gate = new Promise<void>((resolve) => { unblock = resolve })
  const started = new Promise<void>((resolve) => { notify = resolve })
  const entries = (host as unknown as { entries: Map<string, { storage: import('../src/imagej/engine/storage.ts').Storage }> }).entries
  entries.get(imported.dataset.id)!.storage = new SharedStorage({
    id: original.id, metadata: () => original.metadata(), capabilities: () => original.capabilities(),
    async readRegion(region, options) { signal = options?.signal; notify(); await gate; return original.readRegion(region, options) },
    release() { original.release() },
  })
  const pending = host.run({ datasetId: imported.dataset.id, recipe: createRecipe(imported.dataset.id, 0), selection: {} })
  const outcome = Promise.allSettled([pending])
  await started
  await host.restructure({ datasetId: imported.dataset.id, op: 'reverse' })
  host.cancel()
  const cancelled = signal?.aborted
  unblock(); await outcome; host.dispose()
  assert.equal(cancelled, true)
})

test('多维 RGB 栈重排保留时间轴和帧作用域，源关闭后链式派生仍正确', async () => {
  const host = new EngineHost()
  const imported = importMemory({ name: 'multi-rgb', dtype: 'uint8', componentKind: 'rgb', axes: ['t', 'c', 'z', 'y', 'x'], shape: [2, 3, 2, 1, 2], data: Uint8Array.from({ length: 24 }, (_, i) => i + 1) })
  const entries = (host as unknown as { entries: Map<string, { dataset: typeof imported.dataset; storage: typeof imported.storage; controller: AbortController }> }).entries
  entries.set(imported.dataset.id, { dataset: imported.dataset, storage: new SharedStorage(imported.storage), controller: new AbortController() })
  const invert = makeStep('invert', {}, { kind: 'frame', selection: { t: 1, z: 0 } })
  const reversed = (await host.restructure({ datasetId: imported.dataset.id, recipe: createRecipe(imported.dataset.id, 0, [invert]), op: 'reverse' }))!
  const child = (await host.restructure({ datasetId: reversed.id, op: 'substack', pages: [1, 0] }))!
  host.dispose(imported.dataset.id); host.dispose(reversed.id)
  const result = await host.run({ datasetId: child.id, recipe: createRecipe(child.id, 0), selection: { t: 1, z: 0 } })
  assert.deepEqual([...child.axes], ['t', 'c', 'z', 'y', 'x'])
  assert.deepEqual([...result.image!.data], [242, 241, 238, 237, 234, 233])
  const unaffected = await host.run({ datasetId: child.id, recipe: createRecipe(child.id, 0), selection: { t: 0, z: 0 } })
  assert.deepEqual([...unaffected.image!.data], [1, 2, 5, 6, 9, 10])
  host.dispose()
})

test('取消宿主期间迟到的导入不会重新登记，宿主仍能正常导入新文件', async () => {
  const host = new EngineHost()
  let unblock!: () => void, notify!: () => void
  const gate = new Promise<void>((resolve) => { unblock = resolve })
  const started = new Promise<void>((resolve) => { notify = resolve })
  const decoder = async () => {
    notify(); await gate
    return { imageType: { components: 1, componentType: 'uint8' }, size: [2, 1], spacing: [1, 1], origin: [0, 0], data: Uint8Array.of(10, 20) }
  }
  const pending = host.import(new File([], 'late.bin'), decoder)
  await started; host.dispose(); unblock()
  await assert.rejects(pending, { name: 'AbortError' })
  const entries = (host as unknown as { entries: Map<string, unknown> }).entries
  assert.equal(entries.size, 0)
  const fresh = await importFrames(host, [frame([10, 20])])
  assert.deepEqual([...(await read(host, fresh.dataset.id)).data], [10, 20])
  host.dispose()
})

test('tiled TIFF 按 tile 坐标读取，边缘 padding 不写入图像，RGB/大端 uint16 一致', async () => {
  for (const [width, height, components, bits, bigEndian, predictor] of [[32, 16, 1, 8, false, 1], [19, 17, 1, 8, false, 1], [19, 17, 3, 16, true, 1], [19, 17, 3, 16, true, 2]] as const) {
    const tilesX = Math.ceil(width / 16), tilesY = Math.ceil(height / 16)
    const raw = new Uint8Array(tilesX * tilesY * 16 * 16 * components * bits / 8)
    const view = new DataView(raw.buffer)
    const expected = new Array<number>(width * height * components)
    let sample = 0
    for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) for (let c = 0; c < components; c++) {
      const ix = tx * 16 + x, iy = ty * 16 + y
      const value = ix < width && iy < height ? (iy * width + ix + c * 1000) % (bits === 8 ? 256 : 65536) : bits === 8 ? 255 : 65535
      if (bits === 8) raw[sample] = value
      else view.setUint16(sample * 2, value, !bigEndian)
      sample++
      if (ix < width && iy < height) expected[c * width * height + iy * width + ix] = value
    }
    if (predictor === 2) {
      const rowSamples = 16 * components
      for (let base = 0; base < sample; base += rowSamples) for (let i = rowSamples - 1; i >= components; i--) {
        const at = (base + i) * 2, prev = at - components * 2
        view.setUint16(at, view.getUint16(at, !bigEndian) - view.getUint16(prev, !bigEndian), !bigEndian)
      }
    }
    const { bytes } = buildTiffBytes([{ width, height, bits, components, layout: 'tile', tileWidth: 16, tileHeight: 16, predictor, pixels: raw }], { bigEndian })
    const source = await TiffPageSource.open(new Blob([bytes]))
    assert.equal(source.canRead(0), true)
    assert.deepEqual([...(await source.readPage(0)).block.data], expected)
  }
})
