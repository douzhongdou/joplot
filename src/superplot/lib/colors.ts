/** super-plot 专有的高饱和调色板，用于波形多通道与频谱。 */
const PALETTE = [
  '#2f6bff',
  '#ff8a3d',
  '#00b894',
  '#e84393',
  '#8e44ff',
  '#00b8d4',
  '#f4c430',
  '#ff5252',
]

export function getSuperPlotColor(index: number): string {
  return PALETTE[index % PALETTE.length]
}

export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!match) {
    return hex
  }

  const value = match[1]
  const red = parseInt(value.slice(0, 2), 16)
  const green = parseInt(value.slice(2, 4), 16)
  const blue = parseInt(value.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
