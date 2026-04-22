import { useMemo, useState } from 'react'
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

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="inspector-icon">
      <path d="M5 2.5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 5 11.5h6A1.5 1.5 0 0 0 12.5 10V4A1.5 1.5 0 0 0 11 2.5H5Zm0 1h6a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" fill="currentColor" />
      <path d="M2.5 6A1.5 1.5 0 0 1 4 4.5h.5v1H4a.5.5 0 0 0-.5.5v6A1.5 1.5 0 0 0 5 13.5h6a.5.5 0 0 0 .5-.5v-.5h1v.5A1.5 1.5 0 0 1 11 14.5H5A2.5 2.5 0 0 1 2.5 12V6Z" fill="currentColor" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="inspector-icon">
      <path d="M6 2.5h4a1 1 0 0 1 1 1V4h2a.5.5 0 0 1 0 1h-.7l-.53 7.42A1.5 1.5 0 0 1 10.27 13.8H5.73a1.5 1.5 0 0 1-1.5-1.38L3.7 5H3a.5.5 0 0 1 0-1h2v-.5a1 1 0 0 1 1-1Zm1 1a.25.25 0 0 0-.25.25V4h2.5v-.25A.25.25 0 0 0 9 3.5H7Zm-1.77 8.85a.5.5 0 0 0 .5.45h4.54a.5.5 0 0 0 .5-.45L11.29 5H4.71l.52 7.35Z" fill="currentColor" />
      <path d="M6.75 6.5a.5.5 0 0 1 .5.5v3.5a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5Zm2.5 0a.5.5 0 0 1 .5.5v3.5a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5Z" fill="currentColor" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="inspector-icon">
      <circle cx="3.5" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.25" fill="currentColor" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="inspector-icon">
      <path d="M8 3a.5.5 0 0 1 .5.5v4h4a.5.5 0 0 1 0 1h-4v4a.5.5 0 0 1-1 0v-4h-4a.5.5 0 0 1 0-1h4v-4A.5.5 0 0 1 8 3Z" fill="currentColor" />
    </svg>
  )
}

function PaletteIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="inspector-icon">
      <path d="M8 1.5A6.5 6.5 0 0 0 1.5 8 6.5 6.5 0 0 0 8 14.5h1.52a1.98 1.98 0 0 0 0-3.96H8.85a.85.85 0 0 1-.85-.85c0-.24.1-.47.26-.63l3.67-3.68A2.15 2.15 0 0 0 8 1.5Zm-3.1 5.2a.95.95 0 1 1 0-1.9.95.95 0 0 1 0 1.9Zm2.05-2.25a.95.95 0 1 1 0-1.9.95.95 0 0 1 0 1.9Zm2.6.3a.95.95 0 1 1 0-1.9.95.95 0 0 1 0 1.9Zm2.05 2.25a.95.95 0 1 1 0-1.9.95.95 0 0 1 0 1.9Z" fill="currentColor" />
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="inspector-icon">
      <path d="M8 1.5a.5.5 0 0 1 .47.32l1.03 2.75 2.75 1.03a.5.5 0 0 1 0 .94L9.5 7.57 8.47 10.32a.5.5 0 0 1-.94 0L6.5 7.57 3.75 6.54a.5.5 0 0 1 0-.94L6.5 4.57l1.03-2.75A.5.5 0 0 1 8 1.5Z" fill="currentColor" />
    </svg>
  )
}

function getKindLabel(kind: ChartCard['kind']) {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? '图卡'
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

  if (!card) {
    return (
      <section className="inspector-shell inspector-shell-empty">
        <div className="inspector-empty-icon">
          <SparkIcon />
        </div>
        <strong>先选中一张图卡</strong>
        <p>右侧会显示基础配置和显示设置。</p>
      </section>
    )
  }

  const activeDataset = activeDatasetId ? datasetsById[activeDatasetId] : null

  return (
    <section className="inspector-shell">
      <div className="inspector-header">
        <div className="inspector-header-main">
          <h2>{getKindLabel(card.kind)}</h2>
          {activeDataset && (
            <p>{activeDataset.fileName}</p>
          )}
        </div>

        <div className="inspector-header-actions">
          <button type="button" className="inspector-icon-button" onClick={onDuplicate} aria-label="复制图卡">
            <CopyIcon />
          </button>
          <button type="button" className="inspector-icon-button" onClick={onRemove} aria-label="删除图卡">
            <TrashIcon />
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
                  <select
                    value={card.kind}
                    onChange={(event) => onChangeCard({ kind: event.target.value as ChartCard['kind'] })}
                  >
                    {KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="inspector-field">
                  <span>公共 X 轴</span>
                  <select
                    value={card.xColumn}
                    onChange={(event) => onChangeCard({ xColumn: event.target.value })}
                  >
                    {allHeaders.map((header) => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </label>

                {card.kind !== 'stats' && (
                  <>
                    <label className="inspector-field">
                      <span>绘制方式</span>
                      <select
                        value={card.drawMode}
                        onChange={(event) => onChangeCard({ drawMode: event.target.value as ChartCard['drawMode'] })}
                      >
                        {DRAW_MODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
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
                  <button type="button" className="inspector-add-button" onClick={() => onAddSeries(activeDatasetId ?? undefined)}>
                    <PlusIcon />
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
                          >
                            <MoreIcon />
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
                        <select
                          value={series.datasetId}
                          onChange={(event) => onChangeSeries(series.id, { datasetId: event.target.value })}
                        >
                          {datasets.map((option) => (
                            <option key={option.id} value={option.id}>{option.fileName}</option>
                          ))}
                        </select>

                        <select
                          value={series.yColumn ?? ''}
                          onChange={(event) => onChangeSeries(series.id, { yColumn: event.target.value || null })}
                        >
                          <option value="">选择字段</option>
                          {numericOptions.map((header) => (
                            <option key={header} value={header}>{header}</option>
                          ))}
                        </select>
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

              {card.kind !== 'stats' && (
                <div className="inspector-note">
                  拖入多个 CSV 后，新建多系列图表会默认按导入顺序自动绑定这些数据集。
                </div>
              )}
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
                        <span className="inspector-color-icon">
                          <PaletteIcon />
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
