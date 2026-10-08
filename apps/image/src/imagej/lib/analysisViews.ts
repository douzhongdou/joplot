/**
 * 分析面板（右栏卡片）的状态。
 *
 * 为什么放在组件之外：图片标签页每个都是一个 `ImageDocumentView` 实例，而卡片列表原先定义在
 * 它内部，于是每张图各有一套分析面板——切标签页时面板就"变成另一个"，也就没法冻住一张图的
 * 直方图去和另一张对比。
 *
 * 现在改成模块级单例：面板跨图片标签页共享，每个卡片各自的 Live/冻结值按卡片 id 记录。
 * Live 的卡片显示当前图的直方图，冻结的卡片保留它被冻结时那一张——这正是并排对比要的语义。
 */

export type ViewType = 'measurement' | 'histogram' | 'profile' | 'particles' | 'zprofile' | 'stackMeasure' | 'stackStatistics' | 'xyProfile'

export interface ViewCard {
  id: number
  type: ViewType
}

/** 冻结的直方图：counts 与值域。 */
export interface FrozenHistogram {
  counts: Uint32Array
  min: number
  max: number
  /** 冻结时的来源（图名 · 切片位置）：对照时才知道看的是哪一张。 */
  source: string
}

interface AnalysisViewsState {
  cards: ViewCard[]
  nextId: number
  /** 缺省视为 Live；显式 false 表示冻住。 */
  live: Record<number, boolean>
  frozen: Record<number, FrozenHistogram>
}

let state: AnalysisViewsState = { cards: [], nextId: 1, live: {}, frozen: {} }
const listeners = new Set<() => void>()

function commit(next: AnalysisViewsState) {
  state = next
  for (const listener of listeners) listener()
}

/** 初次打开图像时填入默认卡片；已有卡片则不动（切标签页不会重置）。 */
const DEFAULT_CARDS: readonly ViewType[] = ['measurement', 'histogram']

export const analysisViews = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  /** 服务端与客户端首帧都用同一个引用，避免 hydration 不一致。 */
  snapshot: () => state,
  add(type: ViewType) {
    commit({ ...state, cards: [...state.cards, { id: state.nextId, type }], nextId: state.nextId + 1 })
  },
  remove(id: number) {
    commit({ ...state, cards: state.cards.filter((card) => card.id !== id) })
  },
  seed() {
    if (state.cards.length) return
    const cards = DEFAULT_CARDS.map((type) => ({ id: state.nextId + DEFAULT_CARDS.indexOf(type), type }))
    commit({ ...state, cards, nextId: state.nextId + DEFAULT_CARDS.length })
  },
  isLive(id: number) {
    return state.live[id] !== false
  },
  setLive(id: number, on: boolean, freeze: FrozenHistogram | null) {
    commit({
      ...state,
      live: { ...state.live, [id]: on },
      frozen: !on && freeze ? { ...state.frozen, [id]: freeze } : state.frozen,
    })
  },
  freeze(id: number, value: FrozenHistogram | null) {
    if (!value) return
    commit({ ...state, frozen: { ...state.frozen, [id]: value } })
  },
}


