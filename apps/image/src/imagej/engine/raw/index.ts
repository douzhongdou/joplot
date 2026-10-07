/**
 * 相机 RAW 导入（自研，不引入第三方二进制依赖）。
 *
 * 绝大多数 RAW（DNG、CR2、NEF、ARW、ORF、RW2 等）都是 TIFF 容器：
 * 主 IFD 是预览 / 缩略图，真正的一次性 CFA（Bayer 马赛克）数据在主 IFD 或 SubIFD 中，
 * 且 PhotometricInterpretation 为 CFA(32803) / LinearRaw(34892)。
 *
 * 本模块复用 `tiff/` 的索引与按页读取（含 SubIFD、Deflate、Predictor），
 * 输出「单通道马赛克灰度 + CFA 元数据」。彩色还原交给 debayer 算子，
 * 因此用户可以先把 RAW 当灰度图查看，再按需选择滤镜序列与算法。
 *
 * 未覆盖：JPEG / LZW / 私有压缩（Sony ARW 压缩、Nikon 压缩等）、CR3/X3F/RAF 等非 TIFF 容器。
 */

import { dtypeOf, TiffPageSource } from '../tiff/source.ts'
import { PHOTOMETRIC_CFA, PHOTOMETRIC_LINEAR_RAW, type TiffPage } from '../tiff/index.ts'
import { patternName } from '../debayer.ts'
import { MAX_IMPORT_PIXELS } from './sensor.ts'
import type { DecodedImage } from '../importer.ts'

export interface RawDecode {
  decoded: DecodedImage
  /** 写入 dataset.metadata 的 CFA 信息，供 debayer 算子默认取值。 */
  metadata: Record<string, string | number | boolean>
}

/** 解码 RAW 文件的主 CFA 页。 */
export async function decodeRawFile(blob: Blob): Promise<RawDecode> {
  const source = await TiffPageSource.open(blob, { subIfds: true })
  const pages = source.index.pages
  const pageNumber = pickRawPageIndex(pages)
  const meta = pages[pageNumber]!
  const warnings: string[] = []

  if (meta.components !== 1) throw new Error(`RAW 数据页为 ${meta.components} 通道，不是单通道 CFA`)
  if (meta.layout !== 'strip') throw new Error('RAW 暂只支持 strip 布局的 CFA 数据（tile 布局后续支持）')
  if (dtypeOf(meta) === undefined) throw new Error(`RAW 位深 ${meta.bitsPerSample} 位 SampleFormat=${meta.sampleFormat} 暂不支持`)
  // 畸形头部能声明出任意尺寸，分配前先按像素上限挡掉，避免把 Worker 拖死。
  const pixels = meta.width * meta.height
  if (pixels > MAX_IMPORT_PIXELS) {
    throw new Error(`RAW 数据页尺寸 ${meta.width}×${meta.height} 超过单次导入上限 ${MAX_IMPORT_PIXELS} 像素`)
  }

  const frame = await source.readPage(pageNumber)
  const isCfa = meta.photometric === PHOTOMETRIC_CFA || meta.photometric === PHOTOMETRIC_LINEAR_RAW

  const metadata: Record<string, string | number | boolean> = { rawPage: pageNumber }
  if (isCfa && meta.cfa) {
    const name = patternName(meta.cfa.pattern)
    if (name) metadata.cfaPattern = name
    else warnings.push(`CFA 图案 [${meta.cfa.pattern.join(', ')}] 不是标准 2×2 图案，debayer 需手动选择滤镜序列`)
  } else {
    if (!isCfa) warnings.push('该页未标记为 CFA / LinearRaw，按单通道灰度载入')
    warnings.push('文件未声明 CFA 图案，debayer 默认按 RGGB，可在算子参数中修改')
  }
  if (meta.blackLevel !== undefined) metadata.blackLevel = meta.blackLevel
  if (meta.whiteLevel !== undefined) metadata.whiteLevel = meta.whiteLevel
  if (meta.defaultCropSize && (meta.defaultCropSize[0] !== meta.width || meta.defaultCropSize[1] !== meta.height)) {
    warnings.push('文件带默认裁剪区域，当前保留完整传感器尺寸')
  }

  const decoded: DecodedImage = {
    dtype: frame.block.dtype,
    axes: ['y', 'x'],
    shape: [meta.height, meta.width],
    channels: [{ index: 0, name: 'CFA', kind: 'other' }],
    componentKind: 'scalar',
    data: frame.block.data,
    spacing: [1, 1, 1],
    origin: [0, 0, 0],
    warnings,
  }
  return { decoded, metadata }
}

/**
 * 在全部页中挑选 CFA 数据页。
 *
 * 优先 CFA / LinearRaw 标记，其次更大的图像；只考虑单通道页，避免把 RGB 预览当成 RAW。
 */
export function pickRawPageIndex(pages: readonly TiffPage[]): number {
  let best = -1
  let bestScore = -1
  let bestPixels = -1
  pages.forEach((page, index) => {
    if (page.components !== 1) return
    const cfa = page.photometric === PHOTOMETRIC_CFA || page.photometric === PHOTOMETRIC_LINEAR_RAW
    const score = cfa ? 2 : 1
    const pixels = page.width * page.height
    if (score > bestScore || (score === bestScore && pixels > bestPixels)) {
      bestScore = score
      bestPixels = pixels
      best = index
    }
  })
  if (best < 0) throw new Error('未找到 RAW 的 CFA 数据页（可能只含预览图，或相机格式暂不支持）')
  return best
}
