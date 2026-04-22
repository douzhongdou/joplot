import { useMemo } from 'react'
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

const panelClass = 'rounded-[16px] border border-[rgba(195,204,216,0.82)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.96)_100%)] p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
const fieldClass = 'grid min-w-0 gap-1.5 rounded-[14px] border border-[rgba(217,224,232,0.95)] bg-white/90 p-3'
const labelClass = 'text-[0.73rem] font-bold tracking-[0.02em] text-slate-600'
const controlClass = 'min-h-10 w-full rounded-[10px] border border-[rgba(195,204,216,0.95)] bg-white px-3 text-sm text-[var(--text)] outline-none transition focus:border-[rgba(21,94,239,0.55)] focus:shadow-[0_0_0_3px_rgba(21,94,239,0.1)] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400'
const iconButtonClass = 'inline-flex h-8.5 w-8.5 items-center justify-center rounded-[10px] border border-[var(--line)] bg-white/90 text-[var(--muted)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[rgba(21,94,239,0.24)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]'
const dangerIconButtonClass = `${iconButtonClass} hover:border-[rgba(196,50,10,0.24)] hover:bg-[rgba(196,50,10,0.08)] hover:text-[var(--danger)]`

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
      <path
        d="M5 2.5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 5 11.5h6A1.5 1.5 0 0 0 12.5 10V4A1.5 1.5 0 0 0 11 2.5H5Zm0 1h6a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"
        fill="currentColor"
      />
      <path
        d="M2.5 6A1.5 1.5 0 0 1 4 4.5h.5v1H4a.5.5 0 0 0-.5.5v6A1.5 1.5 0 0 0 5 13.5h6a.5.5 0 0 0 .5-.5v-.5h1v.5A1.5 1.5 0 0 1 11 14.5H5A2.5 2.5 0 0 1 2.5 12V6Z"
        fill="currentColor"
      />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
      <path
        d="M6 2.5h4a1 1 0 0 1 1 1V4h2a.5.5 0 0 1 0 1h-.7l-.53 7.42A1.5 1.5 0 0 1 10.27 13.8H5.73a1.5 1.5 0 0 1-1.5-1.38L3.7 5H3a.5.5 0 0 1 0-1h2v-.5a1 1 0 0 1 1-1Zm1 1a.25.25 0 0 0-.25.25V4h2.5v-.25A.25.25 0 0 0 9 3.5H7Zm-1.77 8.85a.5.5 0 0 0 .5.45h4.54a.5.5 0 0 0 .5-.45L11.29 5H4.71l.52 7.35Z"
        fill="currentColor"
      />
      <path d="M6.75 6.5a.5.5 0 0 1 .5.5v3.5a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5Zm2.5 0a.5.5 0 0 1 .5.5v3.5a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5Z" fill="currentColor" />
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
      <path
        d="M8 1.5a.5.5 0 0 1 .47.32l1.03 2.75 2.75 1.03a.5.5 0 0 1 0 .94L9.5 7.57 8.47 10.32a.5.5 0 0 1-.94 0L6.5 7.57 3.75 6.54a.5.5 0 0 1 0-.94L6.5 4.57l1.03-2.75A.5.5 0 0 1 8 1.5Zm0 1.93-.61 1.63a.5.5 0 0 1-.29.29L5.47 6l1.63.61a.5.5 0 0 1 .29.29L8 8.53l.61-1.63a.5.5 0 0 1 .29-.29L10.53 6 8.9 5.39a.5.5 0 0 1-.29-.29L8 3.43Z"
        fill="currentColor"
      />
      <path d="M12.5 10.5a.5.5 0 0 1 .45.28l.4.82.82.4a.5.5 0 0 1 0 .9l-.82.4-.4.82a.5.5 0 0 1-.9 0l-.4-.82-.82-.4a.5.5 0 0 1 0-.9l.82-.4.4-.82a.5.5 0 0 1 .45-.28Z" fill="currentColor" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
      <path d="M8 3a.5.5 0 0 1 .5.5v4h4a.5.5 0 0 1 0 1h-4v4a.5.5 0 0 1-1 0v-4h-4a.5.5 0 0 1 0-1h4v-4A.5.5 0 0 1 8 3Z" fill="currentColor" />
    </svg>
  )
}

function getKindLabel(kind: ChartCard['kind']) {
  return KIND_OPTIONS.find((option) => option.value === kind)?.label ?? '图卡'
}

function getDrawModeLabel(drawMode: ChartCard['drawMode']) {
  return DRAW_MODE_OPTIONS.find((option) => option.value === drawMode)?.label ?? '默认'
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
      <section className="grid gap-3.5 border-b border-[var(--line)] bg-transparent p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--accent)]">Inspector</p>
            <h2 className="mt-1 text-base font-semibold text-[var(--text)]">图卡配置</h2>
          </div>
        </div>

        <div className={`${panelClass} grid items-center gap-3 sm:grid-cols-[auto_minmax(0,1fr)]`}>
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(21,94,239,0.08)] text-[var(--accent)]">
            <SparkIcon />
          </div>
          <div className="min-w-0">
            <strong className="block text-[0.95rem] leading-5 font-semibold text-[var(--text)]">先选中一张图卡</strong>
            <p className="mt-1 text-sm leading-6 text-[var(--muted)]">这里会显示标题、公共 X 轴和系列配置，方便你快速微调当前视图。</p>
          </div>
        </div>
      </section>
    )
  }

  const activeDataset = activeDatasetId ? datasetsById[activeDatasetId] : null

  return (
    <section className="grid gap-3.5 border-b border-[var(--line)] bg-transparent p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[0.72rem] font-bold uppercase tracking-[0.12em] text-[var(--accent)]">Inspector</p>
          <h2 className="mt-1 text-base font-semibold text-[var(--text)]">图卡配置</h2>
        </div>
        <div className="inline-flex items-center gap-2">
          <button type="button" className={iconButtonClass} onClick={onDuplicate} aria-label="复制图卡" title="复制图卡">
            <CopyIcon />
          </button>
          <button type="button" className={dangerIconButtonClass} onClick={onRemove} aria-label="删除图卡" title="删除图卡">
            <TrashIcon />
          </button>
        </div>
      </div>

      <div className={`${panelClass} grid gap-3.5`}>
        <div className="grid gap-1.5">
          <span className="inline-flex w-fit items-center rounded-full bg-[rgba(21,94,239,0.1)] px-2.5 py-1 text-[0.72rem] font-bold tracking-[0.04em] text-[var(--accent)]">
            {getKindLabel(card.kind)}
          </span>
          <strong className="block text-[0.95rem] leading-5 font-semibold text-[var(--text)]">{card.title || '未命名图卡'}</strong>
          <p className="m-0 text-xs leading-5 text-[var(--muted)]">
            {card.series.length} 条数据系列
            {activeDataset ? ` · 当前数据集 ${activeDataset.fileName}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="inline-flex min-h-7 items-center rounded-full bg-slate-100/90 px-2.5 text-[0.74rem] text-slate-600">
            X · {card.xColumn || '未选择'}
          </span>
          <span className="inline-flex min-h-7 items-center rounded-full bg-slate-100/90 px-2.5 text-[0.74rem] text-slate-600">
            系列 · {card.series.length}
          </span>
          {card.kind !== 'stats' && (
            <span className="inline-flex min-h-7 items-center rounded-full bg-slate-100/90 px-2.5 text-[0.74rem] text-slate-600">
              绘制 · {getDrawModeLabel(card.drawMode)}
            </span>
          )}
        </div>
      </div>

      <div className={`${panelClass} grid gap-3`}>
        <div>
          <strong className="block text-[0.95rem] leading-5 font-semibold text-[var(--text)]">基础设置</strong>
          <p className="m-0 text-xs leading-5 text-[var(--muted)]">先调整图卡名称、图表类型和公共 X 轴。</p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <label className={`${fieldClass} col-span-2`}>
            <span className={labelClass}>标题</span>
            <input
              className={controlClass}
              type="text"
              value={card.title}
              onChange={(event) => onChangeCard({ title: event.target.value })}
            />
          </label>

          <label className={fieldClass}>
            <span className={labelClass}>类型</span>
            <select
              className={controlClass}
              value={card.kind}
              onChange={(event) => onChangeCard({ kind: event.target.value as ChartCard['kind'] })}
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className={fieldClass}>
            <span className={labelClass}>公共 X 轴</span>
            <select
              className={controlClass}
              value={card.xColumn}
              onChange={(event) => onChangeCard({ xColumn: event.target.value })}
            >
              {allHeaders.map((header) => (
                <option key={header} value={header}>{header}</option>
              ))}
            </select>
          </label>

          {card.kind !== 'stats' && (
            <label className={fieldClass}>
              <span className={labelClass}>线宽</span>
              <input
                className={controlClass}
                type="number"
                min="1"
                max="6"
                value={card.lineWidth}
                onChange={(event) => onChangeCard({ lineWidth: Number(event.target.value) || 1 })}
              />
            </label>
          )}

          {card.kind === 'line' && (
            <label className={fieldClass}>
              <span className={labelClass}>绘制方式</span>
              <select
                className={controlClass}
                value={card.drawMode}
                onChange={(event) => onChangeCard({ drawMode: event.target.value as ChartCard['drawMode'] })}
              >
                {DRAW_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      <div className={`${panelClass} grid gap-3`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <strong className="block text-[0.95rem] leading-5 font-semibold text-[var(--text)]">数据系列</strong>
            <p className="m-0 text-xs leading-5 text-[var(--muted)]">每条系列都可以单独绑定数据集、Y 列和颜色。</p>
          </div>

          {card.kind !== 'stats' && (
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] border border-[rgba(21,94,239,0.16)] bg-[var(--accent-soft)] px-3 text-sm font-medium text-[var(--accent)] transition hover:bg-[rgba(21,94,239,0.12)]"
              onClick={() => onAddSeries(activeDatasetId ?? undefined)}
            >
              <PlusIcon />
              添加系列
            </button>
          )}
        </div>

        <div className="grid gap-3">
          {card.series.map((series, index) => {
            const dataset = datasetsById[series.datasetId]
            const numericOptions = dataset?.numericColumns ?? []
            const supportsX = dataset ? dataset.headers.includes(card.xColumn) : false

            return (
              <div key={series.id} className="grid gap-2.5 rounded-[14px] border border-[var(--line)] bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="inline-flex min-h-6 items-center rounded-full bg-slate-100 px-2.5 text-[0.72rem] font-semibold text-slate-600">
                      系列 {index + 1}
                    </span>
                    <p className="mt-1 mb-0 truncate text-sm font-medium text-[var(--text)]">{series.label || dataset?.fileName || '未命名系列'}</p>
                  </div>

                  {card.series.length > 1 && (
                    <button
                      type="button"
                      className={dangerIconButtonClass}
                      onClick={() => onRemoveSeries(series.id)}
                      aria-label={`删除系列 ${index + 1}`}
                      title="删除系列"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <label className={`${fieldClass} col-span-2`}>
                    <span className={labelClass}>数据集</span>
                    <select
                      className={controlClass}
                      value={series.datasetId}
                      onChange={(event) => onChangeSeries(series.id, { datasetId: event.target.value })}
                    >
                      {datasets.map((option) => (
                        <option key={option.id} value={option.id}>{option.fileName}</option>
                      ))}
                    </select>
                  </label>

                  <label className={`${fieldClass} col-span-2`}>
                    <span className={labelClass}>显示名</span>
                    <input
                      className={controlClass}
                      type="text"
                      value={series.label}
                      onChange={(event) => onChangeSeries(series.id, { label: event.target.value })}
                    />
                  </label>

                  <label className={fieldClass}>
                    <span className={labelClass}>Y 列</span>
                    <select
                      className={controlClass}
                      value={series.yColumn ?? ''}
                      onChange={(event) => onChangeSeries(series.id, { yColumn: event.target.value || null })}
                    >
                      <option value="">选择数值列</option>
                      {numericOptions.map((header) => (
                        <option key={header} value={header}>{header}</option>
                      ))}
                    </select>
                  </label>

                  <label className={fieldClass}>
                    <span className={labelClass}>颜色</span>
                    <div className="flex items-center gap-2.5">
                      <input
                        className={`${controlClass} h-10 w-[46px] min-w-[46px] cursor-pointer overflow-hidden p-1`}
                        type="color"
                        value={series.color}
                        onChange={(event) => onChangeSeries(series.id, { color: event.target.value })}
                      />
                      <span className="inline-flex min-h-10 items-center rounded-[10px] border border-[rgba(195,204,216,0.95)] bg-white px-3 text-[0.78rem] font-semibold tracking-[0.04em] text-[var(--text)]">
                        {series.color.toUpperCase()}
                      </span>
                    </div>
                  </label>
                </div>

                {!supportsX && (
                  <div className="rounded-[12px] border border-[rgba(196,50,10,0.16)] bg-[rgba(196,50,10,0.06)] px-3 py-2 text-[0.78rem] leading-5 text-[var(--danger)]">
                    当前数据集不包含公共 X 列 <code className="rounded bg-white/80 px-1 py-0.5 text-[0.74rem] text-[var(--text)]">{card.xColumn}</code>，这条系列暂时不会参与绘图。
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
