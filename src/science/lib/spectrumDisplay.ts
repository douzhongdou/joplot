/** Plot-only dB conversion. Keep the computed spectrum and CSV export in linear units. */
export function spectrumReference(magnitude: ArrayLike<number>): number {
  let peak = 0
  for (let i = 0; i < magnitude.length; i += 1) {
    if (Number.isFinite(magnitude[i]) && magnitude[i] > peak) peak = magnitude[i]
  }
  return peak > 0 ? peak : 1
}

export function toRelativeDb(magnitude: ArrayLike<number>, reference: number, floorDb = -120): Float64Array {
  const result = new Float64Array(magnitude.length)
  for (let i = 0; i < magnitude.length; i += 1) {
    const value = magnitude[i]
    result[i] = value > 0 && Number.isFinite(value)
      ? Math.max(floorDb, 20 * Math.log10(value / reference))
      : floorDb
  }
  return result
}
