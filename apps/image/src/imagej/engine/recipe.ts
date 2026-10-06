/**
 * P0 数据契约：Recipe（操作记录）与撤销。
 *
 * Recipe 保存源 Dataset 引用、步骤列表、每步算子与参数、作用范围和版本。
 * 第一版用线性链；参数拖动属于临时编辑，提交后才形成一次撤销单位。
 * 撤销恢复上一版 Recipe；是否命中缓存只影响速度，不影响正确性。
 */
import type { Region } from './types.ts'
import type { SliceSelection } from './dataset.ts'

/** 步骤作用范围。 */
export type StepScope =
  | { kind: 'image' }
  | { kind: 'stack' }
  | { kind: 'pages'; from: number; to: number }
  | { kind: 'roi'; region: Region }
  | { kind: 'frame'; selection: SliceSelection; region?: Region }

/** 步骤参数：数值、字符串或枚举，保持可序列化。 */
export type StepParamValue = number | string

export interface RecipeStep {
  id: string
  /** 算子 kind，对应 OperatorRegistry。 */
  op: string
  params: Record<string, StepParamValue>
  /** 作用范围；缺省为整图。 */
  scope?: StepScope
  /** 算法版本；影响缓存键与结果追溯。 */
  algorithmVersion?: string
}

export interface Recipe {
  /** 源 Dataset id。 */
  sourceId: string
  /** 源 Dataset revision；源内容变化会使旧 Recipe 失效。 */
  sourceRevision: number
  /** Recipe 自身的版本，每提交一次递增。 */
  revision: number
  steps: readonly RecipeStep[]
}

let stepCounter = 0

export function nextStepId(): string {
  stepCounter += 1
  return `step_${Date.now().toString(36)}_${stepCounter.toString(36)}`
}

export function createRecipe(sourceId: string, sourceRevision: number, steps: readonly RecipeStep[] = []): Recipe {
  return { sourceId, sourceRevision, revision: 0, steps: [...steps] }
}

/** 创建一个新步骤，缺省参数由调用方从算子能力声明补齐。 */
export function makeStep(op: string, params: Record<string, StepParamValue> = {}, scope?: StepScope): RecipeStep {
  return { id: nextStepId(), op, params, scope }
}

/** 追加一步，返回新 Recipe（不修改入参）。 */
export function appendStep(recipe: Recipe, step: RecipeStep): Recipe {
  return { ...recipe, revision: recipe.revision + 1, steps: [...recipe.steps, step] }
}

/** 删除某一步及其后所有步骤（线性链语义），返回新 Recipe。 */
export function truncateAt(recipe: Recipe, stepId: string): Recipe {
  const index = recipe.steps.findIndex((step) => step.id === stepId)
  if (index < 0) return recipe
  return { ...recipe, revision: recipe.revision + 1, steps: recipe.steps.slice(0, index) }
}

/** 删除指定步。 */
export function removeStep(recipe: Recipe, stepId: string): Recipe {
  const steps = recipe.steps.filter((step) => step.id !== stepId)
  if (steps.length === recipe.steps.length) return recipe
  return { ...recipe, revision: recipe.revision + 1, steps }
}

/** 修改某一步的参数，返回新 Recipe。 */
export function updateStepParams(
  recipe: Recipe,
  stepId: string,
  params: Record<string, StepParamValue>,
): Recipe {
  let changed = false
  const steps = recipe.steps.map((step) => {
    if (step.id !== stepId) return step
    changed = true
    return { ...step, params: { ...step.params, ...params } }
  })
  return changed ? { ...recipe, revision: recipe.revision + 1, steps } : recipe
}

/**
 * 修改某一步的作用域（用于滤镜预览跟随视口）。
 *
 * 与 remove + append 相比只产生一次修订、一次渲染；作用域没变时原样返回，
 * 避免平移到余量内也触发重算。
 */
export function updateStepScope(recipe: Recipe, stepId: string, scope: StepScope): Recipe {
  let changed = false
  const steps = recipe.steps.map((step) => {
    if (step.id !== stepId) return step
    if (sameScope(step.scope, scope)) return step
    changed = true
    return { ...step, scope }
  })
  return changed ? { ...recipe, revision: recipe.revision + 1, steps } : recipe
}

/** 作用域是否等价（都是小对象，直接结构化比较）。 */
function sameScope(a: StepScope | undefined, b: StepScope | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.kind !== b.kind) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 单步的稳定版本键，用于缓存。 */
export function stepVersionKey(step: RecipeStep): string {
  const params = Object.entries(step.params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(',')
  const scope = step.scope ? JSON.stringify(step.scope) : 'image'
  return `${step.op}@${step.algorithmVersion ?? 'v1'}[${params}](${scope})`
}

/** 从源到某一步（含）的累计版本键。 */
export function recipeVersionKey(recipe: Recipe, throughStepId?: string): string {
  const parts: string[] = [`${recipe.sourceId}@${recipe.sourceRevision}`]
  for (const step of recipe.steps) {
    parts.push(stepVersionKey(step))
    if (throughStepId && step.id === throughStepId) break
  }
  return parts.join('|')
}

/** 找到某一步在链中的下标，找不到返回 -1。 */
export function stepIndex(recipe: Recipe, stepId: string): number {
  return recipe.steps.findIndex((step) => step.id === stepId)
}

/** 截取从源到指定步骤（含）的步骤序列；不传则返回全部。 */
export function stepsThrough(recipe: Recipe, throughStepId?: string): readonly RecipeStep[] {
  if (!throughStepId) return recipe.steps
  const index = stepIndex(recipe, throughStepId)
  return index < 0 ? recipe.steps : recipe.steps.slice(0, index + 1)
}

export function stepAppliesToSelection(step: RecipeStep, selection: SliceSelection): boolean {
  if (step.scope?.kind === 'frame') {
    const target = step.scope.selection
    return (['t', 'c', 'z'] as const).every((axis) => (target[axis] ?? 0) === (selection[axis] ?? 0))
  }
  if (step.scope?.kind === 'pages') {
    const index = selection.z ?? 0
    return index >= step.scope.from && index <= step.scope.to
  }
  return true
}

/** 比较两份 Recipe 是否等价（用于判断提交是否真的产生变化）。 */
export function recipeEquals(a: Recipe, b: Recipe): boolean {
  if (a.sourceId !== b.sourceId || a.sourceRevision !== b.sourceRevision) return false
  if (a.steps.length !== b.steps.length) return false
  return a.steps.every((step, i) => stepVersionKey(step) === stepVersionKey(b.steps[i]!))
}

/**
 * 撤销历史：保存 Recipe 快照。
 *
 * 元数据变更很快，因此这里不做全分辨率快照，只保留 Recipe 本身；
 * 画面恢复由引擎按需重算。maxEntries 限制历史深度。
 */
export class RecipeHistory {
  private readonly entries: Recipe[] = []
  private cursor = 0
  private readonly maxEntries: number

  constructor(initial: Recipe, maxEntries = 32) {
    if (maxEntries < 2) throw new RangeError('RecipeHistory maxEntries 至少为 2')
    this.maxEntries = maxEntries
    this.entries.push(initial)
  }

  /** 当前（最新）Recipe。 */
  current(): Recipe {
    return this.entries[this.cursor]!
  }

  /** 已提交的撤销单位数量。 */
  size(): number {
    return this.cursor
  }

  canUndo(): boolean {
    return this.cursor > 0
  }

  canRedo(): boolean { return this.cursor + 1 < this.entries.length }

  /** 提交一份新 Recipe；与当前等价时不产生新历史。 */
  commit(next: Recipe): Recipe {
    if (recipeEquals(this.current(), next)) return this.current()
    this.entries.splice(this.cursor + 1)
    this.entries.push(next)
    if (this.entries.length > this.maxEntries) this.entries.shift()
    this.cursor = this.entries.length - 1
    return next
  }

  /** 撤销一个提交，返回恢复后的 Recipe；无可撤销时返回当前值。 */
  undo(): Recipe {
    if (!this.canUndo()) return this.current()
    this.cursor -= 1
    return this.current()
  }

  redo(): Recipe {
    if (this.canRedo()) this.cursor += 1
    return this.current()
  }

  /** 清空历史并重置为给定 Recipe（例如切换切片或导入新文件）。 */
  reset(recipe: Recipe): void {
    this.entries.length = 0
    this.entries.push(recipe)
    this.cursor = 0
  }
}
