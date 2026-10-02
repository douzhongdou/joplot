'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { OperatorRegistry } from '../lib/engineTypes'

type Language = 'zh-CN' | 'en' | 'ja-JP'
type MenuItem = { label: string; op?: string; shortcut?: string }
type MenuGroup = { label: string; items: MenuItem[] }

/**
 * 左栏「处理」命令目录：图像（类型/调整/变换）+ 处理（数学/滤镜/二值/边缘）。
 * 分析类操作（测量/粒子）在右栏「分析」区，这里不放。
 */
const GROUPS: MenuGroup[] = [
  { label: 'Type', items: [{ label: '8-bit', op: 'grayscale' }, { label: '16-bit' }, { label: '32-bit' }, { label: 'RGB Color' }] },
  { label: 'Adjust', items: [{ label: 'Brightness/Contrast', op: 'levels' }, { label: 'Threshold', op: 'threshold' }, { label: 'Auto Threshold', op: 'otsu' }, { label: 'Color Balance' }] },
  { label: 'Transform', items: [{ label: 'Crop', op: 'crop' }, { label: 'Flip Horizontally', op: 'flipH' }, { label: 'Flip Vertically', op: 'flipV' }, { label: 'Rotate 90° Right', op: 'rotateCW' }, { label: 'Rotate 90° Left', op: 'rotateCCW' }, { label: 'Scale' }] },
  { label: 'Stacks', items: [{ label: 'Next Slice', shortcut: '.' }, { label: 'Previous Slice', shortcut: ',' }, { label: 'Z Project' }] },
  { label: 'Math', items: [{ label: 'Invert', op: 'invert' }, { label: 'Add' }, { label: 'Subtract' }, { label: 'Multiply' }] },
  { label: 'Filters', items: [{ label: 'Mean', op: 'mean3x3' }, { label: 'Median', op: 'median3x3' }, { label: 'Gaussian Blur', op: 'gaussian' }, { label: 'Minimum', op: 'minimum3x3' }, { label: 'Maximum', op: 'maximum3x3' }, { label: 'Sharpen', op: 'sharpen3x3' }, { label: 'Unsharp Mask' }] },
  { label: 'Binary', items: [{ label: 'Erode', op: 'erode' }, { label: 'Dilate', op: 'dilate' }, { label: 'Open', op: 'open' }, { label: 'Close', op: 'close' }, { label: 'Fill Holes', op: 'fillHoles' }, { label: 'Skeletonize' }, { label: 'Watershed' }] },
  { label: 'Find Edges', items: [{ label: 'Sobel', op: 'sobel' }] },
]

const LABELS: Record<Language, {
  groups: Record<string, string>
  items: Record<string, string>
  search: string
  unavailable: string
  empty: string
}> = {
  'zh-CN': {
    groups: { Type: '类型', Adjust: '调整', Transform: '变换', Stacks: '图像栈', Math: '数学运算', Filters: '滤镜', Binary: '二值化', 'Find Edges': '寻找边缘' },
    items: { '8-bit': '8 位', '16-bit': '16 位', '32-bit': '32 位', 'RGB Color': 'RGB 彩色', 'Brightness/Contrast': '亮度/对比度', Threshold: '阈值', 'Auto Threshold': '自动阈值', 'Color Balance': '色彩平衡', Crop: '裁剪', 'Flip Horizontally': '水平翻转', 'Flip Vertically': '垂直翻转', 'Rotate 90° Right': '顺时针旋转 90°', 'Rotate 90° Left': '逆时针旋转 90°', Scale: '缩放尺寸', 'Next Slice': '下一切片', 'Previous Slice': '上一切片', 'Z Project': 'Z 投影', Invert: '反相', Add: '加', Subtract: '减', Multiply: '乘', Mean: '均值', Median: '中值', 'Gaussian Blur': '高斯模糊', Minimum: '最小值', Maximum: '最大值', Sharpen: '锐化', 'Unsharp Mask': '反锐化蒙版', Erode: '腐蚀', Dilate: '膨胀', Open: '开运算', Close: '闭运算', 'Fill Holes': '填孔', Skeletonize: '骨架化', Watershed: '分水岭', Sobel: 'Sobel 边缘' },
    search: '搜索命令', unavailable: '尚未接入', empty: '没有匹配的命令',
  },
  en: {
    groups: {}, items: {}, search: 'Search commands', unavailable: 'Not available yet', empty: 'No matching commands',
  },
  'ja-JP': {
    groups: { Type: '形式', Adjust: '調整', Transform: '変換', Stacks: 'スタック', Math: '演算', Filters: 'フィルタ', Binary: '二値化', 'Find Edges': 'エッジ検出' },
    items: {}, search: 'コマンドを検索', unavailable: '未対応', empty: '該当するコマンドがありません',
  },
}

export function ImageJSidebar({ language, registry, onRun, disabled = false, stackActions, expandableCommands, expandedCommand, panel, onToggleCommand }: {
  language: Language
  registry: OperatorRegistry
  /** 执行命令：传算子 kind，由父组件直接跑。 */
  onRun: (op: string) => void
  disabled?: boolean
  stackActions?: { next(): void; previous(): void; canNext: boolean; canPrevious: boolean }
  /**
   * 可以就地展开操作面板的命令 label（key 用命令英文 label）。
   * 不在此列表里的命令项点击后直接执行。
   */
  expandableCommands?: readonly string[]
  /** 当前展开的命令 label：面板渲染在该命令项自己下方，其余可展开项保持收起。 */
  expandedCommand?: string | null
  /** `expandedCommand` 对应的面板内容。 */
  panel?: ReactNode
  /** 点选可展开的命令项时触发（用于打开/收起该命令自己的面板）。 */
  onToggleCommand?: (command: string) => void
}) {
  const [query, setQuery] = useState('')
  const panelRef = useRef<HTMLDivElement | null>(null)
  const labels = LABELS[language] ?? LABELS.en
  const operators = new Map(registry.operators.map((operator) => [operator.kind, operator]))
  const localize = (label: string) => labels.items[label] ?? label
  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => `${item.label} ${localize(item.label)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
  })).filter((group) => group.items.length)
  // 展开的面板紧跟在命令项下方，可能落在可视区外——把它（连同命令项）滚进视野。
  useEffect(() => { panelRef.current?.scrollIntoView({ block: 'nearest' }) }, [expandedCommand])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-2 pb-1.5 pt-2">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}
          className="h-7 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length ? groups.map((group) => (
          <section key={group.label} className="mb-3">
            <h3 className="mb-0.5 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-base-content/45">{labels.groups[group.label] ?? group.label}</h3>
            <div className="grid gap-0.5">
              {group.items.map((item) => {
                const operator = item.op ? operators.get(item.op) : undefined
                const action = item.label === 'Next Slice' ? stackActions?.next : item.label === 'Previous Slice' ? stackActions?.previous : undefined
                const expandable = Boolean(expandableCommands?.includes(item.label) && onToggleCommand)
                const open = expandable && expandedCommand === item.label
                const available = Boolean(operator || action || expandable)
                const blocked = disabled || !available || (item.label === 'Next Slice' && !stackActions?.canNext) || (item.label === 'Previous Slice' && !stackActions?.canPrevious)
                return (
                  <div key={item.label}>
                    <button type="button" disabled={blocked} title={!available ? labels.unavailable : undefined}
                      aria-expanded={expandable ? open : undefined}
                      onClick={() => {
                        if (expandable && onToggleCommand) { onToggleCommand(item.label); return }
                        if (action) action(); else if (item.op && operator) onRun(item.op)
                      }}
                      className={`flex w-full items-center justify-between rounded-[var(--radius-field)] px-1.5 py-1 text-left text-[13px] transition ${open ? 'bg-muted text-base-content' : 'text-base-content hover:bg-muted'} disabled:cursor-not-allowed disabled:text-base-content/35 disabled:hover:bg-transparent`}>
                      <span>{localize(item.label)}{item.shortcut ? <span className="ml-1.5 font-mono text-[10px] text-base-content/40">[{item.shortcut}]</span> : null}</span>
                      {available ? (open ? <ChevronDown size={13} className="text-base-content/55" /> : <ChevronRight size={13} className="text-base-content/35" />) : <span className="text-[10px]">{labels.unavailable}</span>}
                    </button>
                    {open ? (
                      <div ref={panelRef} className="mb-1.5 ml-2 border-l border-base-300 pl-2">{panel}</div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </section>
        )) : <p className="px-2 py-4 text-center text-xs text-base-content/50">{labels.empty}</p>}
      </div>
    </div>
  )
}
