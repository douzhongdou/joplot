/** 可分离高斯：只缓存垂直核覆盖的水平行，临时内存为 O(width × radius)。 */
export function gaussianInto(
  source: ArrayLike<number>, destination: { [index: number]: number },
  width: number, height: number, sigma: number,
  options: { sourceStride?: number; sourceOffset?: number; destinationStride?: number; destinationOffset?: number; convert: (value: number) => number },
): void {
  const radius = Math.ceil(3 * sigma)
  const taps = radius * 2 + 1
  const kernel = new Float64Array(taps)
  let total = 0
  for (let k = -radius; k <= radius; k++) {
    const value = Math.exp(-(k * k) / (2 * sigma * sigma))
    kernel[k + radius] = value
    total += value
  }
  for (let k = 0; k < taps; k++) kernel[k] /= total
  const rows = new Float32Array(width * Math.min(height, taps))
  const slots = Math.min(height, taps)
  const loaded = new Int32Array(slots).fill(-1)
  const stride = options.sourceStride ?? 1
  const offset = options.sourceOffset ?? 0
  const dstStride = options.destinationStride ?? 1
  const dstOffset = options.destinationOffset ?? 0
  for (let y = 0; y < height; y++) {
    // 按递增行号加载，环形缓存中最旧的行已不再被当前垂直核使用。
    for (let row = Math.max(0, y - radius); row <= Math.min(height - 1, y + radius); row++) {
      const slot = row % slots
      if (loaded[slot] === row) continue
      const start = row * width * stride + offset
      for (let x = 0; x < width; x++) {
        let sum = 0
        for (let k = -radius; k <= radius; k++) {
          const nx = Math.max(0, Math.min(width - 1, x + k))
          sum += source[start + nx * stride]! * kernel[k + radius]!
        }
        rows[slot * width + x] = sum
      }
      loaded[slot] = row
    }
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) {
        const row = Math.max(0, Math.min(height - 1, y + k))
        sum += rows[(row % slots) * width + x]! * kernel[k + radius]!
      }
      destination[(y * width + x) * dstStride + dstOffset] = options.convert(sum)
    }
  }
}
