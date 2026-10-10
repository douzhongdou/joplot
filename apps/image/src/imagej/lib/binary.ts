/** ImageJ BinaryProcessor / ParticleAnalyzer 常用的 8 位二值图操作。白色为前景。 */
import { createImage, ImagejError, type GrayImage } from './processor.ts'

function foreground(image: GrayImage, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < image.width && y < image.height
    && image.data[y * image.width + x] !== 0
}

function morph(image: GrayImage, dilate: boolean): GrayImage {
  const out = createImage(image.width, image.height)
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let hit = !dilate
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const value = foreground(image, x + dx, y + dy)
          hit = dilate ? hit || value : hit && value
        }
      }
      out.data[y * image.width + x] = hit ? 255 : 0
    }
  }
  return out
}

export function dilate(image: GrayImage): GrayImage { return morph(image, true) }
export function erode(image: GrayImage): GrayImage { return morph(image, false) }
export function openBinary(image: GrayImage): GrayImage { return dilate(erode(image)) }
export function closeBinary(image: GrayImage): GrayImage { return erode(dilate(image)) }

/** 从边界泛洪黑色背景，余下的黑色连通域视为孔洞并填白。 */
export function fillHoles(image: GrayImage): GrayImage {
  const { width, height } = image
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0
  const add = (index: number) => {
    if (image.data[index] === 0 && visited[index] === 0) {
      visited[index] = 1
      queue[tail++] = index
    }
  }
  for (let x = 0; x < width; x += 1) { add(x); add((height - 1) * width + x) }
  for (let y = 0; y < height; y += 1) { add(y * width); add(y * width + width - 1) }
  while (head < tail) {
    const index = queue[head++]
    const x = index % width
    if (x > 0) add(index - 1)
    if (x + 1 < width) add(index + 1)
    if (index >= width) add(index - width)
    if (index + width < width * height) add(index + width)
  }
  const out = createImage(width, height)
  for (let i = 0; i < out.data.length; i += 1) {
    out.data[i] = image.data[i] !== 0 || visited[i] === 0 ? 255 : 0
  }
  return out
}

export interface Particle {
  id: number
  area: number
  perimeter: number
  circularity: number
  centroidX: number
  centroidY: number
  bounds: { x: number; y: number; width: number; height: number }
}

/** 8 连通粒子标记；周长按 4 邻边界像素边计数。 */
export function analyzeParticles(image: GrayImage, minArea = 1): Particle[] {
  if (!Number.isInteger(minArea) || minArea < 1) {
    throw new ImagejError('invalid-value', '最小粒子面积必须为正整数')
  }
  const { width, height } = image
  const visited = new Uint8Array(image.data.length)
  const queue = new Int32Array(image.data.length)
  const particles: Particle[] = []
  for (let seed = 0; seed < image.data.length; seed += 1) {
    if (image.data[seed] === 0 || visited[seed] !== 0) continue
    let head = 0
    let tail = 1
    queue[0] = seed
    visited[seed] = 1
    let area = 0
    let perimeter = 0
    let sumX = 0
    let sumY = 0
    let minX = width
    let maxX = 0
    let minY = height
    let maxY = 0
    while (head < tail) {
      const index = queue[head++]
      const x = index % width
      const y = Math.floor(index / width)
      area += 1
      sumX += x + 0.5
      sumY += y + 0.5
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      if (!foreground(image, x - 1, y)) perimeter += 1
      if (!foreground(image, x + 1, y)) perimeter += 1
      if (!foreground(image, x, y - 1)) perimeter += 1
      if (!foreground(image, x, y + 1)) perimeter += 1
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (!foreground(image, nx, ny)) continue
          const neighbor = ny * width + nx
          if (visited[neighbor] === 0) {
            visited[neighbor] = 1
            queue[tail++] = neighbor
          }
        }
      }
    }
    if (area < minArea) continue
    particles.push({
      id: particles.length + 1,
      area,
      perimeter,
      circularity: Math.min(1, (4 * Math.PI * area) / (perimeter * perimeter)),
      centroidX: sumX / area,
      centroidY: sumY / area,
      bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    })
  }
  return particles
}
