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
    <div className={`inspector-control-shell ${className}`.trim()}>
      {children}
      <ChevronDown size={15} strokeWidth={2.1} className="inspector-control-icon" aria-hidden="true" />
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
      <section className="inspector-shell inspector-shell-empty">
        <div className="inspector-empty-icon">
          <Sparkles size={18} strokeWidth={2.2} />
        </div>
        <strong>先选中一张图卡</strong>
        <p>右侧会显示基础配置和显示设置。</p>
      </section>
    )
  }

  const activeDataset = activeDatasetId ? datasetsById[activeDatasetId] : null

  return (
    <section ref={shellRef} className="inspector-shell">
      <div className="inspector-header">
        <div className="inspector-header-main">
          <h2>{getKindLabel(card.kind)}</h2>
          {activeDataset && <p>{activeDataset.fileName}</p>}
        </div>

        <div className="inspector-header-actions">
          <button type="button" className="inspector-icon-button" onClick={onDuplicate} aria-label="复制图卡" title="复制图卡">
            <Copy size={16} strokeWidth={2.1} />
          </button>
          <button type="button" className="inspector-icon-button" onClick={onRemove} aria-label="删除图卡" title="删除图卡">
            <Trash2 size={16} strokeWidth={2.1} />
          </button>
        </div>
      </div>

      <div className="inspector-tabs">
        <button
          type="button"
          className={`inspector-tab ${activeTab === 'base' ? 'inspector-tab-active' : ''}`}
          onClick={() => setActiveTab('base')}
        >
          基础配置
        </button>
        <button
          type="button"
          className={`inspector-tab ${activeTab === 'display' ? 'inspector-tab-active' : ''}`}
          onClick={() => setActiveTab('display')}
        >
          显示设置
        </button>
      </div>

      <div className="inspector-body">
        {activeTab === 'base' && (
          <>
            <section className="inspector-section">
              <div className="inspector-section-title">基础设置</div>
              <div className="inspector-grid">
                <label className="inspector-field inspector-field-span">
                  <span>标题</span>
                  <input
                    type="text"
                    value={card.title}
                    onChange={(event) => onChangeCard({ title: event.target.value })}
                  />
                </label>

                <label className="inspector-field">
                  <span>图表类型</span>
                  <SelectShell>
                    <select
                      value={card.kind}
                      onChange={(event) => onChangeCard({ kind: event.target.value as ChartCard['kind'] })}
                    >
                      {KIND_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </SelectShell>
                </label>

                <label className="inspector-field">
                  <span>公共 X 轴</span>
                  <SelectShell>
                    <select
                      value={card.xColumn}
                      onChange={(event) => onChangeCard({ xColumn: event.target.value })}
                    >
                      {allHeaders.map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </SelectShell>
                </label>

                {card.kind !== 'stats' && (
                  <>
                    <label className="inspector-field">
                      <span>绘制方式</span>
                      <SelectShell>
                        <select
                          value={card.drawMode}
                          onChange={(event) => onChangeCard({ drawMode: event.target.value as ChartCard['drawMode'] })}
                        >
                          {DRAW_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </SelectShell>
                    </label>

                    <label className="inspector-field">
                      <span>线宽</span>
                      <input
                        type="number"
                        min="1"
                        max="6"
                        value={card.lineWidth}
                        onChange={(event) => onChangeCard({ lineWidth: Number(event.target.value) || 1 })}
                      />
                    </label>
                  </>
                )}
              </div>
            </section>

            <section className="inspector-section">
              <div className="inspector-section-header">
                <div className="inspector-section-title">数据系列</div>
                {card.kind !== 'stats' && (
                  <button
                    type="button"
                    className="inspector-add-button"
                    onClick={() => onAddSeries(activeDatasetId ?? undefined)}
                    aria-label="新增系列"
                    title="新增系列"
                  >
                    <Plus size={16} strokeWidth={2.2} />
                  </button>
                )}
              </div>

              <div className="inspector-series-list">
                {card.series.map((series) => {
                  const dataset = datasetsById[series.datasetId]
                  const numericOptions = dataset?.numericColumns ?? []
                  const supportsX = dataset ? dataset.headers.includes(card.xColumn) : false

                  return (
                    <div key={series.id} className="inspector-series-row">
                      <div className="inspector-series-head">
                        <strong>{series.label || dataset?.fileName || '新系列'}</strong>
                        <div className="inspector-series-actions">
                          <button
                            type="button"
                            className="inspector-icon-button"
                            onClick={() => setOpenMenuSeriesId((value) => value === series.id ? null : series.id)}
                            aria-label="系列菜单"
                            title="系列菜单"
                          >
                            <MoreHorizontal size={16} strokeWidth={2.1} />
                          </button>

                          {openMenuSeriesId === series.id && (
                            <div className="inspector-series-menu">
                              <button type="button" onClick={() => setActiveTab('display')}>
                                打开显示设置
                              </button>
                              {card.series.length > 1 && (
                                <button type="button" onClick={() => onRemoveSeries(series.id)}>
                                  删除系列
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="inspector-series-body">
                        <SelectShell className="inspector-series-select">
                          <select
                            value={series.datasetId}
                            onChange={(event) => onChangeSeries(series.id, { datasetId: event.target.value })}
                          >
                            {datasets.map((option) => (
                              <option key={option.id} value={option.id}>{option.fileName}</option>
                            ))}
                          </select>
                        </SelectShell>

                        <SelectShell className="inspector-series-select">
                          <select
                            value={series.yColumn ?? ''}
                            onChange={(event) => onChangeSeries(series.id, { yColumn: event.target.value || null })}
                          >
                            <option value="">选择字段</option>
                            {numericOptions.map((header) => (
                              <option key={header} value={header}>{header}</option>
                            ))}
                          </select>
                        </SelectShell>
                      </div>

                      {!supportsX && (
                        <div className="inspector-series-warning">
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
            <section className="inspector-section">
              <div className="inspector-section-title">系列显示</div>
              <div className="inspector-display-list">
                {card.series.map((series) => (
                  <div key={series.id} className="inspector-display-row">
                    <strong>{series.label || datasetsById[series.datasetId]?.fileName || '新系列'}</strong>
                    <div className="inspector-display-fields">
                      <input
                        className="inspector-display-input"
                        type="text"
                        value={series.label}
                        onChange={(event) => onChangeSeries(series.id, { label: event.target.value })}
                      />

                      <label className="inspector-color-trigger">
                        <span className="inspector-color-swatch" style={{ background: series.color }} />
                        <span>{series.color.toUpperCase()}</span>
                        <span className="inspector-color-icon" aria-hidden="true">
                          <Palette size={15} strokeWidth={2.1} />
                        </span>
                        <input
                          type="color"
                          value={series.color}
                          onChange={(event) => onChangeSeries(series.id, { color: event.target.value })}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="inspector-section">
              <div className="inspector-section-title">图表显示</div>
              <div className="inspector-toggle-grid">
                <button
                  type="button"
                  className={`inspector-toggle-chip ${card.showLegend ? 'inspector-toggle-chip-active' : ''}`}
                  onClick={() => onChangeCard({ showLegend: !card.showLegend })}
                >
                  <span>图例</span>
                  <span>{card.showLegend ? '开启' : '关闭'}</span>
                </button>

                <button
                  type="button"
                  className={`inspector-toggle-chip ${card.showGrid ? 'inspector-toggle-chip-active' : ''}`}
                  onClick={() => onChangeCard({ showGrid: !card.showGrid })}
                >
                  <span>网格线</span>
                  <span>{card.showGrid ? '开启' : '关闭'}</span>
                </button>

                <button
                  type="button"
                  className={`inspector-toggle-chip ${card.showAxes ? 'inspector-toggle-chip-active' : ''}`}
                  onClick={() => onChangeCard({ showAxes: !card.showAxes })}
                >
                  <span>坐标轴</span>
                  <span>{card.showAxes ? '开启' : '关闭'}</span>
                </button>

                <button type="button" className="inspector-toggle-chip inspector-toggle-chip-disabled" disabled>
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
