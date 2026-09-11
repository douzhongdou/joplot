const CHART_FALLBACKS = ['#155eef', '#dd6b20', '#0f766e', '#b93815', '#3b3f98', '#7a3e9d']
const generatedChartColors = [...CHART_FALLBACKS]

function readCssVariable(name: string) {
  if (typeof window === 'undefined') {
    return ''
  }

  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export const CHART_GRID_FALLBACK = 'rgba(15, 23, 42, 0.1)'
export const CHART_AXIS_FALLBACK = 'rgba(15, 23, 42, 0.7)'

export function resolveThemeColor(name: string, fallback: string) {
  return readCssVariable(name) || fallback
}

export function withAlpha(color: string, alpha: number): string {
  const match = /^#(?:([0-9a-fA-F]{3})|([0-9a-fA-F]{6}))$/.exec(color.trim())

  if (!match) {
    return color
  }

  const hex = match[1]
    ? match[1].split('').map((ch) => ch + ch).join('')
    : match[2]
  const red = parseInt(hex.slice(0, 2), 16)
  const green = parseInt(hex.slice(2, 4), 16)
  const blue = parseInt(hex.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const normalizedHue = ((hue % 360) + 360) % 360
  const s = saturation / 100
  const l = lightness / 100
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const segment = normalizedHue / 60
  const x = chroma * (1 - Math.abs((segment % 2) - 1))

  let red = 0
  let green = 0
  let blue = 0

  if (segment >= 0 && segment < 1) {
    red = chroma
    green = x
  } else if (segment < 2) {
    red = x
    green = chroma
  } else if (segment < 3) {
    green = chroma
    blue = x
  } else if (segment < 4) {
    green = x
    blue = chroma
  } else if (segment < 5) {
    red = x
    blue = chroma
  } else {
    red = chroma
    blue = x
  }

  const matchLightness = l - chroma / 2
  const toHex = (value: number) =>
    Math.round((value + matchLightness) * 255)
      .toString(16)
      .padStart(2, '0')

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function buildGeneratedChartColor(index: number) {
  const hue = (index * 137.508 + 24) % 360
  const saturationSteps = [74, 68, 80, 62]
  const lightnessSteps = [48, 56, 42]
  const saturation = saturationSteps[Math.floor(index / 24) % saturationSteps.length]
  const lightness = lightnessSteps[Math.floor(index / (24 * saturationSteps.length)) % lightnessSteps.length]

  return hslToHex(hue, saturation, lightness)
}

export function getChartColor(index: number) {
  while (generatedChartColors.length <= index) {
    let attempt = generatedChartColors.length - CHART_FALLBACKS.length
    let candidate = buildGeneratedChartColor(attempt)

    while (generatedChartColors.includes(candidate)) {
      attempt += 1
      candidate = buildGeneratedChartColor(attempt)
    }

    generatedChartColors.push(candidate)
  }

  return generatedChartColors[index]
}

export function isHexChartColor(value: string | null | undefined) {
  if (!value) {
    return false
  }

  return /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(value.trim())
}
