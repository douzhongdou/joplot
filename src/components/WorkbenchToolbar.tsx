import type { ChartKind } from '../types'

interface Props {
  onAdd: (kind: ChartKind) => void
}

const OPTIONS: Array<{ kind: ChartKind; label: string }> = [
  { kind: 'line', label: '新增折线图' },
  { kind: 'scatter', label: '新增散点图' },
  { kind: 'bar', label: '新增柱状图' },
  { kind: 'stats', label: '新增统计卡' },
]

export function WorkbenchToolbar({ onAdd }: Props) {
  return (
    <div className="toolbar">
      <div>
        <h2 className="card-title">工作台</h2>
        <div className="card-subtitle">多张图卡共享同一份数据集，配置彼此独立。</div>
      </div>
      <div className="toolbar-actions">
        {OPTIONS.map((option) => (
          <button key={option.kind} type="button" onClick={() => onAdd(option.kind)}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
