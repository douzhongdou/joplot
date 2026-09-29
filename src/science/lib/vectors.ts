import type { DenseArray, ScienceValue, Series } from '../types.ts'
import { createDense } from './dense.ts'

export type VectorField = 'x' | 'y' | 'frequency' | 'magnitude' | 'phase' | 'fitted' | 'residual'

const separator = '::'

export function vectorFields(value: ScienceValue): VectorField[] {
  if (value.kind === 'series') return ['x', 'y']
  if (value.kind === 'spectrum') return value.phase ? ['frequency', 'magnitude', 'phase'] : ['frequency', 'magnitude']
  if (value.kind === 'fit') return ['x', 'y', 'fitted', 'residual']
  return []
}

export function vectorId(valueId: string, field: VectorField): string {
  return `${valueId}${separator}${field}`
}

export function vectorParentId(id: string): string {
  const boundary = id.lastIndexOf(separator)
  return boundary < 0 ? id : id.slice(0, boundary)
}

export function vectorData(value: ScienceValue, field: VectorField): DenseArray | undefined {
  if (value.kind === 'series') return field === 'x' ? value.x : field === 'y' ? value.y : undefined
  if (value.kind === 'spectrum') return field === 'frequency' ? value.frequency : field === 'magnitude' ? value.magnitude : field === 'phase' ? value.phase ?? undefined : undefined
  if (value.kind === 'fit') {
    if (field === 'x') return value.x
    if (field === 'y') return value.y
    if (field === 'fitted') return value.fitted
    if (field === 'residual') return value.residual
  }
  return undefined
}

function indices(length: number): DenseArray {
  const data = new Float64Array(length)
  for (let index = 0; index < length; index += 1) data[index] = index
  return createDense(data)
}

/** A vector view shares its data with the parent result; it is never a separate cached output. */
export function projectVector(value: ScienceValue, field: VectorField): Series | undefined {
  const data = vectorData(value, field)
  if (!data || value.kind === 'stats') return undefined
  const x = field === 'x' || field === 'frequency'
    ? indices(data.shape[0])
    : value.kind === 'spectrum' ? value.frequency : value.x

  return {
    id: vectorId(value.id, field),
    name: `${value.name}.${field}`,
    kind: 'series',
    x,
    y: data,
    pointCount: value.pointCount ?? data.shape[0],
    provenance: `${value.provenance} · ${field}`,
  }
}

export function resolveValue(values: ScienceValue[], id: string): ScienceValue | undefined {
  const direct = values.find((value) => value.id === id)
  if (direct) return direct
  const parentId = vectorParentId(id)
  if (parentId === id) return undefined
  const parent = values.find((value) => value.id === parentId)
  return parent ? projectVector(parent, id.slice(parentId.length + separator.length) as VectorField) : undefined
}
