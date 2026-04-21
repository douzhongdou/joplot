import { useEffect, useMemo, useState } from 'react'
import { useCsvData } from './hooks/useCsvData'
import { FileUploader } from './components/FileUploader'
import { FilterBar } from './components/FilterBar'
import { WorkbenchToolbar } from './components/WorkbenchToolbar'
import { ChartCard } from './components/ChartCard'
import {
  applyFilters,
  createCard,
  createDefaultCard,
  sanitizeCardsForDataset,
} from './lib/workbench'
import type { ChartCard as ChartCardConfig, CsvData, FilterRule } from './types'

const STORAGE_KEY = 'csv-workbench-mvp'

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

  const filteredRows = useMemo(
    () => (csv ? applyFilters(csv.rows, filters.filter((filter) => filter.column)) : []),
    [csv, filters],
  )

  useEffect(() => {
    if (!csv) {
      return
    }

    const persistedRaw = window.localStorage.getItem(STORAGE_KEY)

    if (!persistedRaw) {
      setCards([createDefaultCard(csv)])
      setFilters([])
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
    } catch {
      setCards([createDefaultCard(csv)])
      setFilters([])
    }
  }, [csv])

  useEffect(() => {
    if (!csv || cards.length === 0) {
      return
    }

    const payload: PersistedState = { cards, filters }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [cards, csv, filters])

  function addCard(kind: ChartCardConfig['kind']) {
    if (!csv) {
      return
    }

    setCards((prev) => [...prev, createCard(kind, csv, { color: `var(--card-accent-${(prev.length % 4) + 1})` })])
  }

  function updateCard(cardId: string, patch: Partial<ChartCardConfig>) {
    setCards((prev) => prev.map((card) => (card.id === cardId ? { ...card, ...patch } : card)))
  }

  function duplicateCard(cardId: string) {
    const target = cards.find((card) => card.id === cardId)

    if (!target || !csv) {
      return
    }

    setCards((prev) => [
      ...prev,
      createCard(target.kind, csv, {
        ...target,
        id: `card-${Math.random().toString(36).slice(2, 10)}`,
        title: `${target.title}（副本）`,
      }),
    ])
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
    <div className="page-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">CSV Workbench MVP</p>
          <h1>面向演示场景的通用 CSV 可视化工作台</h1>
          <p className="hero-copy">
            上传规整 CSV 后自动成图，再用多图卡工作台继续比较、筛选和统计。
          </p>
        </div>
      </header>

      <section className="panel">
        <FileUploader onFile={parse} csv={csv} />
      </section>

      {!csv && (
        <section className="panel empty-state">
          <h2>先上传一个 CSV 开始</h2>
          <p>首版支持带表头、结构较规整的数据。默认会用第一列做 X 轴、第二列做 Y 轴生成折线图。</p>
        </section>
      )}

      {csv && csv.rowCount === 0 && (
        <section className="panel empty-state">
          <h2>没有可展示的数据</h2>
          <p>这个文件没有解析出有效行，请换一个带表头的 CSV 再试。</p>
        </section>
      )}

      {csv && csv.rowCount > 0 && (
        <>
          <section className="panel workbench-summary">
            <div>
              <div className="summary-label">当前数据集</div>
              <div className="summary-value">{csv.rowCount.toLocaleString()} 行</div>
            </div>
            <div>
              <div className="summary-label">筛选后</div>
              <div className="summary-value">{filteredRows.length.toLocaleString()} 行</div>
            </div>
            <div>
              <div className="summary-label">字段数</div>
              <div className="summary-value">{csv.headers.length}</div>
            </div>
            <div>
              <div className="summary-label">数值列</div>
              <div className="summary-value">{csv.numericColumns.length}</div>
            </div>
          </section>

          <section className="panel">
            <FilterBar
              headers={csv.headers}
              filters={filters}
              onAdd={addFilter}
              onChange={updateFilter}
              onRemove={removeFilter}
            />
          </section>

          <section className="panel">
            <WorkbenchToolbar onAdd={addCard} />
          </section>

          <section className="card-grid">
            {cards.map((card) => (
              <ChartCard
                key={card.id}
                card={card}
                csv={csv}
                filteredRows={filteredRows}
                onChange={(patch) => updateCard(card.id, patch)}
                onDuplicate={() => duplicateCard(card.id)}
                onRemove={() => removeCard(card.id)}
              />
            ))}
          </section>
        </>
      )}
    </div>
  )
}
