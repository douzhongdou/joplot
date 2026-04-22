import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ChevronDown,
  Copy,
  MoreHorizontal,
  Palette,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { ChartCard, ChartSeries, CsvData } from '../types'

interface Props {
  card: ChartCard | null
  datasets: CsvData[]
  activeDatasetId: string | null
  onChangeCard: (patch: Partial<ChartCard>) => void
  onAddSeries: (datasetId?: string) => void
  onChangeSeries: (seriesId: string, patch: Partial<ChartSeries>) => void
  onRemoveSeries: (seriesId: string) => void
  onDuplicate: () => void
  onRemove: () => void
}

type InspectorTab = 'base' | 'display'

const KIND_OPTIONS: Array<{ value: ChartCard['kind']; label: string }> = [
  { value: 'line', label: '折线图' },
  { value: 'scatter', label: '散点图' },
  { value: 'bar', label: '柱状图' },
  { value: 'stats', label: '统计卡' },
]

const DRAW_MODE_OPTIONS: Array<{ value: NonNullable<ChartCard['drawMode']>; label: string }> = [
  { value: 'lines', label: '折线' },
  { value: 'lines+markers', label: '线 + 点' },
  { value: 'markers', label: '仅点' },
]

const fieldLabelClass = 'text-xs font-medium uppercase tracking-[0.12em] text-base-content/55'
const inputClass = 'h-12 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-4 text-sm text-base-content outline-none transition placeholder:text-base-content/40 focus:border-primary/35 focus:ring-2 focus:ring-primary/20'
const iconButtonClass = 'inline-grid size-10 place-items-center rounded-[var(--radius-box)] border border-base-300 bg-base-100 text-base-content/60 transition hover:border-primary/25 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25'

function getKindLabel(kind: ChartCard['kind']) {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? '图卡'
}

function SelectShell({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`relative min-w-0 ${className}`.trim()}>
      {children}
      <ChevronDown
        size={16}
        strokeWidth={2.1}
        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-base-content/55"
        aria-hidden="true"
      />
    </div>
  )
}

export function CardInspector({
  card,
  datasets,
  activeDatasetId,
  onChangeCard,
  onAddSeries,
  onChangeSeries,
  onRemoveSeries,
  onDuplicate,
  onRemove,
}: Props) {
  const shellRef = useRef<HTMLElement>(null)
  const [activeTab, setActiveTab] = useState<InspectorTab>('base')
  const [openMenuSeriesId, setOpenMenuSeriesId] = useState<string | null>(null)

  const allHeaders = useMemo(
    () => Array.from(new Set(datasets.flatMap((dataset) => dataset.headers))),
    [datasets],
  )
  const datasetsById = useMemo(
    () => Object.fromEntries(datasets.map((dataset) => [dataset.id, dataset])),
    [datasets],
  )

  useEffect(() => {
    if (!openMenuSeriesId) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement | null
      if (!target) {
        return
      }

      if (target.closest('.inspector-series-actions')) {
        return
      }

      if (shellRef.current?.contains(target)) {
        setOpenMenuSeriesId(null)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenMenuSeriesId(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenuSeriesId])

  if (!card) {
    return (
      <section className="grid min-h-full place-items-center bg-base-100 px-6 py-16 text-center">
        <div className="grid max-w-xs justify-items-center gap-3">
          <div className="inline-grid size-14 place-items-center rounded-[calc(var(--radius-box)+0.25rem)] bg-primary/10 text-primary">
            <Sparkles size={22} strokeWidth={2.2} />
          </div>
          <strong className="text-lg font-semibold text-base-content">先选中一张图卡</strong>
          <p className="text-sm leading-6 text-base-content/60">右侧会显示基础配置和显示设置。</p>
        </div>
      </section>
    )
  }

  const activeDataset = activeDatasetId ? datasetsById[activeDatasetId] : null

  return (
    <section ref={shellRef} className="grid min-h-full content-start bg-base-100">
      <div className="flex items-start justify-between gap-3 border-base-300 px-6 py-5">
        <div className="grid gap-1">
          <h2 className="text-4xl font-semibold tracking-tight text-base-content">{getKindLabel(card.kind)}</h2>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" className={iconButtonClass} onClick={onDuplicate} aria-label="复制图卡" title="复制图卡">
            <Copy size={16} strokeWidth={2.1} />
          </button>
          <button type="button" className={iconButtonClass} onClick={onRemove} aria-label="删除图卡" title="删除图卡">
            <Trash2 size={16} strokeWidth={2.1} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-6 border-b border-base-300 px-6">
        <button
          type="button"
          className={`inline-flex h-14 items-center border-b-2 text-base font-semibold transition ${
            activeTab === 'base'
              ? 'border-primary text-primary'
              : 'border-transparent text-base-content/70 hover:text-base-content'
          }`}
          onClick={() => setActiveTab('base')}
        >
          基础配置
        </button>
        <button
          type="button"
          className={`inline-flex h-14 items-center border-b-2 text-base font-semibold transition ${
            activeTab === 'display'
              ? 'border-primary text-primary'
              : 'border-transparent text-base-content/70 hover:text-base-content'
          }`}
          onClick={() => setActiveTab('display')}
        >
          显示设置
        </button>
      </div>

      <div className="px-6 pb-8">
        {activeTab === 'base' && (
          <>
            <section className="border-b border-base-300 py-6">
              <div className="mb-4 text-lg font-semibold text-base-content">基础设置</div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 md:col-span-2">
                  <span className={fieldLabelClass}>标题</span>
                  <input
                    type="text"
                    value={card.title}
                    onChange={(event) => onChangeCard({ title: event.target.value })}
                    className={inputClass}
                  />
                </label>

                <label className="grid gap-2">
                  <span className={fieldLabelClass}>图表类型</span>
                  <SelectShell>
                    <select
                      value={card.kind}
                      onChange={(event) => onChangeCard({ kind: event.target.value as ChartCard['kind'] })}
                      className={`${inputClass} appearance-none pr-10`}
                    >
                      {KIND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </SelectShell>
                </label>

                <label className="grid gap-2">
                  <span className={fieldLabelClass}>公共 X 轴</span>
                  <SelectShell>
                    <select
                      value={card.xColumn}
                      onChange={(event) => onChangeCard({ xColumn: event.target.value })}
                      className={`${inputClass} appearance-none pr-10`}
                    >
                      {allHeaders.map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </SelectShell>
                </label>

                {card.kind !== 'stats' && (
                  <>
                    <label className="grid gap-2">
                      <span className={fieldLabelClass}>绘制方式</span>
                      <SelectShell>
                        <select
                          value={card.drawMode}
                          onChange={(event) => onChangeCard({ drawMode: event.target.value as ChartCard['drawMode'] })}
                          className={`${inputClass} appearance-none pr-10`}
                        >
                          {DRAW_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </SelectShell>
                    </label>

                    <label className="grid gap-2">
                      <span className={fieldLabelClass}>线宽</span>
                      <input
                        type="number"
                        min="1"
                        max="6"
                        value={card.lineWidth}
                        onChange={(event) => onChangeCard({ lineWidth: Number(event.target.value) || 1 })}
                        className={inputClass}
                      />
                    </label>
                  </>
                )}
              </div>
            </section>

            <section className="py-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-lg font-semibold text-base-content">数据系列</div>
                {card.kind !== 'stats' && (
                  <button
                    type="button"
                    className="inline-grid size-11 place-items-center rounded-[var(--radius-box)] border border-primary/15 bg-primary/10 text-primary transition hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                    onClick={() => onAddSeries(activeDatasetId ?? undefined)}
                    aria-label="新增系列"
                    title="新增系列"
                  >
                    <Plus size={18} strokeWidth={2.2} />
                  </button>
                )}
              </div>

              <div className="grid">
                {card.series.map((series) => {
                  const dataset = datasetsById[series.datasetId]
                  const numericOptions = dataset?.numericColumns ?? []
                  const supportsX = dataset ? dataset.headers.includes(card.xColumn) : false

                  return (
                    <div key={series.id} className="grid gap-3 border-b border-base-300 py-4 last:border-b-0">
                      <div className="flex items-center justify-between gap-3">
                        <strong className="truncate text-sm font-semibold text-base-content">
                          {series.label || dataset?.fileName || '新系列'}
                        </strong>
                        <div className="relative inspector-series-actions">
                          <button
                            type="button"
                            className={iconButtonClass}
                            onClick={() => setOpenMenuSeriesId((value) => value === series.id ? null : series.id)}
                            aria-label="系列菜单"
                            title="系列菜单"
                          >
                            <MoreHorizontal size={16} strokeWidth={2.1} />
                          </button>

                          {openMenuSeriesId === series.id && (
                            <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 grid min-w-36 gap-1 rounded-[calc(var(--radius-box)+0.25rem)] border border-base-300 bg-base-100 p-2 shadow-xl">
                              <button
                                type="button"
                                className="inline-flex h-10 items-center rounded-[var(--radius-field)] px-3 text-left text-sm text-base-content transition hover:bg-base-200"
                                onClick={() => {
                                  setActiveTab('display')
                                  setOpenMenuSeriesId(null)
                                }}
                              >
                                打开显示设置
                              </button>
                              {card.series.length > 1 && (
                                <button
                                  type="button"
                                  className="inline-flex h-10 items-center rounded-[var(--radius-field)] px-3 text-left text-sm text-error transition hover:bg-error/10"
                                  onClick={() => {
                                    onRemoveSeries(series.id)
                                    setOpenMenuSeriesId(null)
                                  }}
                                >
                                  删除系列
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid gap-3">
                        <SelectShell>
                          <select
                            value={series.datasetId}
                            onChange={(event) => onChangeSeries(series.id, { datasetId: event.target.value })}
                            className={`${inputClass} appearance-none pr-10`}
                          >
                            {datasets.map((option) => (
                              <option key={option.id} value={option.id}>{option.fileName}</option>
                            ))}
                          </select>
                        </SelectShell>

                        <SelectShell>
                          <select
                            value={series.yColumn ?? ''}
                            onChange={(event) => onChangeSeries(series.id, { yColumn: event.target.value || null })}
                            className={`${inputClass} appearance-none pr-10`}
                          >
                            <option value="">选择字段</option>
                            {numericOptions.map((header) => (
                              <option key={header} value={header}>{header}</option>
                            ))}
                          </select>
                        </SelectShell>
                      </div>

                      {!supportsX && (
                        <div className="rounded-[var(--radius-box)] bg-error/10 px-3 py-2 text-sm leading-6 text-error">
                          当前数据集不包含公共 X 轴 {card.xColumn}，这条系列不会参与绘图。
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}

        {activeTab === 'display' && (
          <>
            <section className="border-b border-base-300 py-6">
              <div className="mb-4 text-lg font-semibold text-base-content">系列显示</div>
              <div className="grid">
                {card.series.map((series) => (
                  <div key={series.id} className="grid gap-3 border-b border-base-300 py-4 last:border-b-0">
                    <strong className="text-sm font-semibold text-base-content">
                      {series.label || datasetsById[series.datasetId]?.fileName || '新系列'}
                    </strong>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                      <input
                        type="text"
                        value={series.label}
                        onChange={(event) => onChangeSeries(series.id, { label: event.target.value })}
                        className={inputClass}
                      />

                      <label className="relative flex h-12 items-center gap-3 rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-4 text-sm text-base-content">
                        <span className="size-5 rounded-md border border-base-300" style={{ background: series.color }} />
                        <span className="font-medium">{series.color.toUpperCase()}</span>
                        <span className="ml-auto text-base-content/55">
                          <Palette size={15} strokeWidth={2.1} />
                        </span>
                        <input
                          type="color"
                          value={series.color}
                          onChange={(event) => onChangeSeries(series.id, { color: event.target.value })}
                          className="absolute inset-0 cursor-pointer opacity-0"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="py-6">
              <div className="mb-4 text-lg font-semibold text-base-content">图表显示</div>
              <div className="grid gap-3 md:grid-cols-2">
                {[
                  {
                    label: '图例',
                    active: card.showLegend,
                    onClick: () => onChangeCard({ showLegend: !card.showLegend }),
                  },
                  {
                    label: '网格线',
                    active: card.showGrid,
                    onClick: () => onChangeCard({ showGrid: !card.showGrid }),
                  },
                  {
                    label: '坐标轴',
                    active: card.showAxes,
                    onClick: () => onChangeCard({ showAxes: !card.showAxes }),
                  },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={`flex h-12 items-center justify-between rounded-[var(--radius-box)] border px-4 text-sm font-medium transition ${
                      item.active
                        ? 'border-primary/15 bg-primary/10 text-primary'
                        : 'border-base-300 bg-base-100 text-base-content/70 hover:border-primary/20 hover:text-base-content'
                    }`}
                    onClick={item.onClick}
                  >
                    <span>{item.label}</span>
                    <span>{item.active ? '开启' : '关闭'}</span>
                  </button>
                ))}

                <button
                  type="button"
                  className="flex h-12 items-center justify-between rounded-[var(--radius-box)] border border-base-300 bg-base-200 text-sm font-medium text-base-content/40"
                  disabled
                >
                  <span>主题色</span>
                  <span>暂不可用</span>
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </section>
  )
}
