import test from 'node:test'
import assert from 'node:assert/strict'
import { importFile, importImageStack } from '../src/imagej/engine/importer.ts'
import {
  decodeRawSensor,
  guessSensorGeometry,
  inferFrames,
  inferHeight,
  needsSensorOptions,
  normalizeSensorOptions,
  probeRawContainer,
  rowByteLength,
  type RawSensorOptions,
} from '../src/imagej/engine/raw/sensor.ts'

/** 默认参数：紧凑排列、无偏移、单帧、RGGB。 */
const base = (over: Partial<RawSensorOptions> = {}): RawSensorOptions => ({
  width: 1,
  height: 1,
  type: 'uint16-le',
  offset: 0,
  stride: 0,
  frames: 1,
  pattern: 'rggb',
  ...over,
})

/* Node 的 BlobPart 类型不接受泛型化的 Uint8Array，这里统一收口。 */
const fileOf = (bytes: Uint8Array, name: string): File => new File([bytes as unknown as BlobPart], name)
const blobOf = (bytes: Uint8Array): Blob => new Blob([bytes as unknown as BlobPart])

function u16le(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setUint16(index * 2, value, true))
  return bytes
}

test('无头裸数据：按宽高与像素类型读出 CFA 马赛克灰度', async () => {
  const values = Array.from({ length: 8 }, (_, i) => 100 + i)
  const file = fileOf(u16le(values), 'sensor.raw')

  const { decoded, metadata } = await decodeRawSensor(file, base({ width: 4, height: 2 }))
  assert.equal(decoded.dtype, 'uint16')
  assert.deepEqual(decoded.axes, ['y', 'x'])
  assert.deepEqual(decoded.shape, [2, 4])
  assert.equal(decoded.componentKind, 'scalar')
  assert.equal(decoded.channels[0]?.name, 'CFA')
  assert.deepEqual([...decoded.data], values)
  assert.equal(metadata.cfaPattern, 'rggb')
  assert.equal(metadata.rawSensor, true)
})

test('字节序按参数解释，而不是按平台', async () => {
  const bytes = Uint8Array.from([0x12, 0x34, 0x56, 0x78])

  const little = await decodeRawSensor(fileOf(bytes, 'a.raw'), base({ width: 2, height: 1, type: 'uint16-le' }))
  assert.deepEqual([...little.decoded.data], [0x3412, 0x7856])

  const big = await decodeRawSensor(fileOf(bytes, 'a.raw'), base({ width: 2, height: 1, type: 'uint16-be' }))
  assert.deepEqual([...big.decoded.data], [0x1234, 0x5678])
})

test('数据偏移与行填充被跳过', async () => {
  // 4 字节文件头 + 每行 3 个 uint8 像素 + 1 字节填充
  const bytes = Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd, 1, 2, 3, 0xff, 4, 5, 6, 0xff])
  const file = fileOf(bytes, 'padded.raw')

  const { decoded } = await decodeRawSensor(file, base({ width: 3, height: 2, type: 'uint8', offset: 4, stride: 4 }))
  assert.deepEqual([...decoded.data], [1, 2, 3, 4, 5, 6])
  assert.equal(decoded.warnings.some((text: string) => text.includes('填充')), true)
})

test('uint8 与 float32 容器同样支持', async () => {
  const float = new Float32Array([1.5, -2.25])
  const { decoded } = await decodeRawSensor(fileOf(new Uint8Array(float.buffer), 'f.raw'), base({ width: 2, height: 1, type: 'float32-le' }))
  assert.equal(decoded.dtype, 'float32')
  assert.deepEqual([...decoded.data], [1.5, -2.25])
})

test('多帧载入为 z 栈', async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4])
  const { decoded, metadata } = await decodeRawSensor(fileOf(bytes, 'burst.raw'), base({ width: 2, height: 1, type: 'uint8', frames: 2 }))
  assert.deepEqual(decoded.axes, ['z', 'y', 'x'])
  assert.deepEqual(decoded.shape, [2, 1, 2])
  assert.deepEqual([...decoded.data], [1, 2, 3, 4])
  assert.equal(metadata.rawFrames, 2)
  assert.equal(decoded.warnings.some((text: string) => text.includes('z 栈')), true)
})

test('单色（不选滤镜序列）时写入 Channel 1 并给出提示', async () => {
  const { decoded, metadata } = await decodeRawSensor(fileOf(Uint8Array.from([7]), 'mono.raw'), base({ width: 1, height: 1, type: 'uint8', pattern: 'none' }))
  assert.equal(decoded.channels[0]?.name, 'Channel 1')
  assert.equal(metadata.cfaPattern, undefined)
  assert.equal(decoded.warnings.some((text: string) => text.includes('滤镜序列')), true)
})

test('参数要的字节数超过文件大小就报错，不分配缓冲', async () => {
  await assert.rejects(
    () => decodeRawSensor(fileOf(u16le([1, 2]), 'short.raw'), base({ width: 100, height: 100 })),
    /文件数据不足/,
  )
})

test('荒谬宽高被上限挡下（拖死浏览器的最短路径）', async () => {
  await assert.rejects(
    () => decodeRawSensor(fileOf(u16le([1]), 'huge.raw'), base({ width: 100_000, height: 100_000 })),
    /上限/,
  )
})

test('行字节数不得小于每行像素字节数', () => {
  assert.throws(() => normalizeSensorOptions(base({ width: 4, height: 1, stride: 4 }), 1024), /行字节数/)
})

test('probeRawContainer 按文件头区分容器与无头裸数据', async () => {
  assert.equal(await probeRawContainer(blobOf(Uint8Array.from([0x49, 0x49, 0x2a, 0x00, 9, 9]))), 'tiff')
  assert.equal(await probeRawContainer(blobOf(Uint8Array.from([0x4d, 0x4d, 0x00, 0x2a]))), 'tiff')
  assert.equal(await probeRawContainer(blobOf(Uint8Array.from([1, 2, 3, 4]))), 'headless')
  assert.equal(await probeRawContainer(blobOf(Uint8Array.from([1, 2]))), 'headless')
})

test('needsSensorOptions 只对「像 RAW 且没有容器头」的文件为真', async () => {
  // 无头裸数据：要问参数
  assert.equal(await needsSensorOptions(fileOf(new Uint8Array(64), 'sensor.raw')), true)
  assert.equal(await needsSensorOptions(fileOf(new Uint8Array(64), 'IMX477.RAW')), true)
  // 带 TIFF 容器：头部自带宽高位深，不用问
  assert.equal(await needsSensorOptions(fileOf(Uint8Array.from([0x49, 0x49, 0x2a, 0x00, 1, 2, 3, 4]), 'shot.dng')), false)
  // 非 RAW 后缀：JPEG / PNG 同样不是 TIFF，但绝不能因此弹参数框
  assert.equal(await needsSensorOptions(fileOf(new Uint8Array(64), 'photo.jpg')), false)
  assert.equal(await needsSensorOptions(fileOf(new Uint8Array(64), 'photo.png')), false)
})

test('inferHeight / inferFrames 按文件大小推算几何', () => {
  assert.equal(inferHeight(8, 2, 'uint16-le'), 2)
  // 尾部多余字节按填充处理，行数向下取整；不足一整行才是 undefined。
  assert.equal(inferHeight(9, 2, 'uint16-le'), 2)
  assert.equal(inferHeight(8, 2, 'uint16-le', 4), 1)
  assert.equal(inferHeight(3, 2, 'uint16-le'), undefined)
  assert.equal(inferFrames(8, 2, 1, 'uint16-le'), 2)
  assert.equal(inferFrames(7, 2, 1, 'uint16-le'), 1)
})

test('经 importFile 导入 .raw：标注 raw、携带 CFA 图案', async () => {
  const values = Array.from({ length: 9 }, (_, i) => 300 + i)
  const file = fileOf(u16le(values), 'frame.raw')

  const { dataset } = await importFile(file, undefined, base({ width: 3, height: 3, pattern: 'bggr' }))
  assert.equal(dataset.source.format, 'raw')
  assert.equal(dataset.dtype, 'uint16')
  assert.deepEqual(dataset.shape, [3, 3])
  assert.equal(dataset.channels[0]?.name, 'CFA')
  assert.equal(dataset.metadata?.cfaPattern, 'bggr')
  assert.equal(dataset.metadata?.decodedWith, 'raw-sensor')
})

test('无参数打开无头 .raw：明确要求先给参数，而不是丢给兜底解码器', async () => {
  await assert.rejects(() => importFile(fileOf(new Uint8Array(64), 'mystery.raw')), /无头|参数/)
})

/* ------------------------------------------------------------------ *
 * MIPI 位打包
 * ------------------------------------------------------------------ */

test('RAW10：5 字节解出 4 个 10 位像素', async () => {
  // [1023, 0, 512, 4]：b0..b3 是各像素的高 8 位，b4 塞 4 个低 2 位。
  const bytes = Uint8Array.from([0xff, 0x00, 0x80, 0x01, 0x03])
  const { decoded, metadata } = await decodeRawSensor(fileOf(bytes, 'packed10.raw'), base({ width: 4, height: 1, type: 'raw10' }))
  assert.equal(decoded.dtype, 'uint16')
  assert.deepEqual([...decoded.data], [1023, 0, 512, 4])
  assert.equal(metadata.rawType, 'raw10')
  assert.equal(decoded.warnings.some((text: string) => text.includes('RAW10')), true)
})

test('RAW12：3 字节解出 2 个 12 位像素', async () => {
  // [4095, 2730]：b0/b1 是高 8 位，b2 的高低半字节各是低 4 位。
  const bytes = Uint8Array.from([0xff, 0xaa, 0xaf])
  const { decoded } = await decodeRawSensor(fileOf(bytes, 'packed12.raw'), base({ width: 2, height: 1, type: 'raw12' }))
  assert.deepEqual([...decoded.data], [4095, 2730])
})

test('位打包的行字节数按位组推进', () => {
  assert.equal(rowByteLength(4, 'raw10'), 5)
  assert.equal(rowByteLength(4056, 'raw10'), 5070)
  assert.equal(rowByteLength(2, 'raw12'), 3)
  assert.equal(rowByteLength(1280, 'raw12'), 1920)
})

test('位打包要求宽度是分组像素数的整数倍', async () => {
  await assert.rejects(
    () => decodeRawSensor(fileOf(new Uint8Array(64), 'x.raw'), base({ width: 6, height: 1, type: 'raw10' })),
    /4 的倍数/,
  )
  await assert.rejects(
    () => decodeRawSensor(fileOf(new Uint8Array(64), 'x.raw'), base({ width: 3, height: 1, type: 'raw12' })),
    /2 的倍数/,
  )
})

/* ------------------------------------------------------------------ *
 * 几何推测
 * ------------------------------------------------------------------ */

test('推测：文件名里的宽高优先命中', () => {
  const guesses = guessSensorGeometry(4056 * 3040 * 2, 'IMX477_4056x3040_16bit.raw')
  const top = guesses[0]
  assert.ok(top, '未给出任何候选')
  assert.equal(top.width, 4056)
  assert.equal(top.height, 3040)
  assert.equal(top.type, 'uint16-le')
  assert.equal(top.source, 'filename')
  assert.equal(top.exact, true)
})

test('推测：没有文件名线索时靠文件大小精确整除命中常见尺寸', () => {
  const guesses = guessSensorGeometry(1920 * 1080 * 2, 'dump.raw')
  const hit = guesses.find((guess) => guess.width === 1920 && guess.height === 1080 && guess.type === 'uint16-le')
  assert.ok(hit, `未推出 1920×1080：${JSON.stringify(guesses)}`)
  assert.equal(hit.exact, true)
  assert.equal(hit.needed, 1920 * 1080 * 2)
})

test('推测：MIPI RAW10 的文件不会被当成 16 位', () => {
  const size = 4056 * 3040 * 10 / 8
  const guesses = guessSensorGeometry(size, 'imx477_raw10.raw')
  const hit = guesses.find((guess) => guess.width === 4056 && guess.height === 3040 && guess.type === 'raw10')
  assert.ok(hit, `未推出 RAW10：${JSON.stringify(guesses.slice(0, 3))}`)
  assert.equal(hit.exact, true)
})

test('推测：RAW12 打包同样能被识别', () => {
  const size = 1280 * 960 * 12 / 8
  const guesses = guessSensorGeometry(size, 'sensor.raw')
  const hit = guesses.find((guess) => guess.width === 1280 && guess.height === 960 && guess.type === 'raw12')
  assert.ok(hit, `未推出 RAW12：${JSON.stringify(guesses.slice(0, 3))}`)
})

test('推测：每条精确候选都正好用完文件', () => {
  const size = 1280 * 960 * 2
  for (const guess of guessSensorGeometry(size, 'x.raw')) {
    if (!guess.exact) continue
    assert.equal(guess.needed, size, `${guess.width}×${guess.height} ${guess.type}`)
  }
})

test('推测：完全没有精确解时给近似候选并标注', () => {
  // 104729 是第 10000 个质数：任何两轴组合都凑不出它，只能给近似值。
  const guesses = guessSensorGeometry(104729, 'weird.raw')
  assert.equal(guesses.length > 0, true)
  assert.equal(guesses.every((guess) => guess.exact === false), true)
  assert.equal(guesses.every((guess) => guess.source === 'aspect'), true)
})

test('推测：字节数非正时不产出候选', () => {
  assert.deepEqual(guessSensorGeometry(0, 'empty.raw'), [])
  assert.deepEqual(guessSensorGeometry(64, 'offset.raw', 64), [])
})

/* ------------------------------------------------------------------ *
 * 文件夹 → Stack（与 jpg 文件夹同样的体验）
 * ------------------------------------------------------------------ */

test('整批裸数据合成 Stack：逐页套用参数并写入 CFA 图案', async () => {
  const page = (name: string, first: number) => fileOf(u16le(Array.from({ length: 16 }, (_, i) => first + i)), name)
  const a = page('f_0001.raw', 100)
  const b = page('f_0002.raw', 200)
  const options = base({ width: 4, height: 4, pattern: 'bggr' })

  const { dataset, storage } = await importImageStack([a, b], undefined, new Map([[a.name, options], [b.name, options]]))
  assert.deepEqual(dataset.axes, ['z', 'y', 'x'])
  assert.deepEqual(dataset.shape, [2, 4, 4])
  assert.equal(dataset.dtype, 'uint16')
  assert.equal(dataset.channels[0]?.name, 'CFA')
  assert.equal(dataset.metadata?.cfaPattern, 'bggr')
  assert.equal(dataset.source.format, 'raw')

  // 第二页也要走同一组参数：读出来应是自己那一份像素。
  const block = await storage.readRegion({ start: [1, 0, 0], shape: [1, 4, 4] })
  assert.equal(block.data[0], 200)
})

test('裸数据 Stack 缺参数时明确报错，而不是丢给兜底解码器', async () => {
  const a = fileOf(new Uint8Array(128), 'a.raw')
  const b = fileOf(new Uint8Array(128), 'b.raw')
  await assert.rejects(() => importImageStack([a, b]), /无头|参数/)
})
