import { useEffect, useMemo, useState } from 'react'
import { useCsvData } from './hooks/useCsvData'
import { FileUploader } from './components/FileUploader'
import { FilterBar } from './components/FilterBar'
import { WorkbenchToolbar } from './components/WorkbenchToolbar'
import { CardInspector } from './components/CardInspector'
import { ChartCard } from './components/ChartCard'
import { DashboardCanvas } from './components/DashboardCanvas'
import {
  appendCardWithLayout,
  applyFilters,
  createCard,
  createDefaultCard,
  moveCardToLayout,
  sanitizeCardsForDataset,
} from './lib/workbench'
import type { ChartCard as ChartCardConfig, CsvData, FilterRule } from './types'

const STORAGE_KEY = 'csv-workbench-dashboard'
const CARD_ACCENTS = ['#155eef', '#dd6b20', '#0f766e', '#7a3e9d']

interface PersistedState {
  cards: ChartCardConfig[]
  filters: FilterRule[]
}

function createFilterRule(csv: CsvData | null): FilterRule {
  return {
    id: `filter-${Math.random().toString(36).slice(2, 10)}`,
    column: csv?.headers[0] ?? '',
    operator: 'contains',
    value: '',
  }
}

export default function App() {
  const { csv, parse } = useCsvData()
  const [cards, setCards] = useState<ChartCardConfig[]>([])
  const [filters, setFilters] = useState<FilterRule[]>([])
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)

  const filteredRows = useMemo(
    () => (csv ? applyFilters(csv.rows, filters.filter((filter) => filter.column)) : []),
    [csv, filters],
  )

  const selectedCard = useMemo(
    () => cards.find((card) => card.id === selectedCardId) ?? null,
    [cards, selectedCardId],
  )

  useEffect(() => {
    if (!csv) {
      setCards([])
      setFilters([])
      setSelectedCardId(null)
      return
    }

    const persistedRaw = window.localStorage.getItem(STORAGE_KEY)

    if (!persistedRaw) {
      const defaultCard = createDefaultCard(csv)
      setCards([defaultCard])
      setFilters([])
      setSelectedCardId(defaultCard.id)
      return
    }

    try {
      const persisted = JSON.parse(persistedRaw) as PersistedState
      const nextCards = persisted.cards.length > 0
        ? sanitizeCardsForDataset(persisted.cards, csv)
        : [createDefaultCard(csv)]
      const nextFilters = persisted.filters.map((filter) => ({
        ...filter,
        column: csv.headers.includes(filter.column) ? filter.column : csv.headers[0] ?? '',
      }))

      setCards(nextCards)
      setFilters(nextFilters)
      setSelectedCardId(nextCards[0]?.id ?? null)
    } catch {
      const defaultCard = createDefaultCard(csv)
      setCards([defaultCard])
      setFilters([])
      setSelectedCardId(defaultCard.id)
    }
  }, [csv])

  useEffect(() => {
    if (!csv) {
      return
    }

    const payload: PersistedState = { cards, filters }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [cards, csv, filters])

  useEffect(() => {
    if (cards.length === 0) {
      setSelectedCardId(null)
      return
    }

    if (!selectedCardId || !cards.some((card) => card.id === selectedCardId)) {
      setSelectedCardId(cards[0].id)
    }
  }, [cards, selectedCardId])

  function addCard(kind: ChartCardConfig['kind']) {
    if (!csv) {
      return
    }

    const nextCard = createCard(kind, csv, {
      color: CARD_ACCENTS[cards.length % CARD_ACCENTS.length],
    })

    setCards((prev) => appendCardWithLayout(prev, nextCard))
    setSelectedCardId(nextCard.id)
  }

  function updateCard(cardId: string, patch: Partial<ChartCardConfig>) {
    setCards((prev) => prev.map((card) => (card.id === cardId ? { ...card, ...patch } : card)))
  }

  function duplicateCard(cardId: string) {
    const target = cards.find((card) => card.id === cardId)
    if (!target || !csv) {
      return
    }

    const nextCard = createCard(target.kind, csv, {
      ...target,
      id: `card-${Math.random().toString(36).slice(2, 10)}`,
      title: `${target.title} 副本`,
      layout: {
        ...target.layout,
        x: target.layout.x + 1,
        y: target.layout.y + 1,
      },
    })

    setCards((prev) => appendCardWithLayout(prev, nextCard))
    setSelectedCardId(nextCard.id)
  }

  function removeCard(cardId: string) {
    setCards((prev) => prev.filter((card) => card.id !== cardId))
  }

  function addFilter() {
    setFilters((prev) => [...prev, createFilterRule(csv)])
  }

  function updateFilter(filterId: string, patch: Partial<FilterRule>) {
    setFilters((prev) => prev.map((filter) => (filter.id === filterId ? { ...filter, ...patch } : filter)))
  }

  function removeFilter(filterId: string) {
    setFilters((prev) => prev.filter((filter) => filter.id !== filterId))
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">PN</div>
          <div className="brand-copy">
            <p className="brand-eyebrow">PlotNow Dashboard</p>
            <h1>CSV 分析工作台</h1>
            <p className="brand-file">{csv?.fileName ?? '未加载文件'}</p>
          </div>
        </div>
        <FileUploader onFile={parse} csv={csv} />
      </header>

      {!csv && (
        <main className="empty-state-shell">
          <section className="empty-state-panel">
            <p className="empty-eyebrow">专业分析台</p>
            <h2>先加载一份 CSV，再把注意力交给图表本身。</h2>
            <p>主画布会给可视化留出最大空间，右侧边栏承接新增图卡、筛选和当前图卡配置。</p>
          </section>
        </main>
      )}

      {csv && csv.rowCount === 0 && (
        <main className="empty-state-shell">
          <section className="empty-state-panel">
            <p className="empty-eyebrow">无有效数据</p>
            <h2>文件已读取，但没有解析出可展示的行。</h2>
            <p>请换一份带表头、结构规整的 CSV 再试。</p>
          </section>
        </main>
      )}

      {csv && csv.rowCount > 0 && (
        <main className="workspace-shell workspace-shell-sidebar">
          <section className="canvas-column">
            <DashboardCanvas
              cards={cards}
              selectedCardId={selectedCardId}
              onSelectCard={setSelectedCardId}
              onLayoutChange={(cardId, layout) => setCards((prev) => moveCardToLayout(prev, cardId, layout))}
              renderCard={(card, controls) => (
                <ChartCard
                  key={card.id}
                  card={card}
                  filteredRows={filteredRows}
                  selected={controls.selected}
                  onSelect={controls.onSelect}
                  onDragStart={controls.onDragStart}
                  onResizeStart={controls.onResizeStart}
                />
              )}
            />
          </section>

          <aside className="sidebar-column">
            <WorkbenchToolbar csv={csv} filteredCount={filteredRows.length} onAdd={addCard} />

            <FilterBar
              headers={csv.headers}
              filters={filters}
              onAdd={addFilter}
              onChange={updateFilter}
              onRemove={removeFilter}
            />

            <CardInspector
              card={selectedCard}
              csv={csv}
              onChange={(patch) => selectedCard && updateCard(selectedCard.id, patch)}
              onDuplicate={() => selectedCard && duplicateCard(selectedCard.id)}
              onRemove={() => selectedCard && removeCard(selectedCard.id)}
            />
          </aside>
        </main>
      )}
    </div>
  )
}
