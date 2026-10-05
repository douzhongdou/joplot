'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { OperatorRegistry } from '../lib/engineTypes'

type Language = 'zh-CN' | 'en' | 'ja-JP'
type MenuItem = { label: string; op?: string; shortcut?: string; command?: string }
type MenuGroup = { label: string; items: MenuItem[] }

/**
 * 左栏「处理」命令目录：图像（类型/调整/变换）+ 处理（数学/滤镜/二值/边缘）。
 * 分析类操作（测量/粒子）在右栏「分析」区，这里不放。
 */
const GROUPS: MenuGroup[] = [
  { label: 'RAW', items: [{ label: 'Debayer', op: 'debayer' }] },
  { label: 'Type', items: [{ label: '8-bit', op: 'grayscale' }, { label: '16-bit' }, { label: '32-bit' }, { label: 'RGB Color' }] },
  { label: 'Adjust', items: [{ label: 'Brightness/Contrast', op: 'levels' }, { label: 'Threshold', op: 'threshold' }, { label: 'Auto Threshold', op: 'otsu' }, { label: 'Color Balance' }] },
  { label: 'Transform', items: [{ label: 'Crop', op: 'crop' }, { label: 'Flip Horizontally', op: 'flipH' }, { label: 'Flip Vertically', op: 'flipV' }, { label: 'Rotate 90° Right', op: 'rotateCW' }, { label: 'Rotate 90° Left', op: 'rotateCCW' }, { label: 'Scale' }] },
  {
    label: 'Stacks',
    items: [
      { label: 'Next Slice', shortcut: '.' },
      { label: 'Previous Slice', shortcut: ',' },
      { label: 'Z Project...', command: 'z-project' },
      { label: 'Grouped Z Project...', command: 'grouped-z-project' },
      { label: 'Make Montage...', command: 'montage' },
      { label: 'Montage to Stack...', command: 'montage-to-stack' },
      { label: 'Reslice [/]...', command: 'reslice' },
      { label: 'Orthogonal Views', command: 'orthogonal-views' },
      { label: 'Plot Z-axis Profile', command: 'plot-z-profile' },
      { label: 'Measure Stack...', command: 'measure-stack' },
      { label: 'Statistics', command: 'stack-statistics' },
      { label: 'Plot XY Profile', command: 'plot-xy-profile' },
      { label: 'Reverse', command: 'reverse' },
      { label: 'Reduce...', command: 'reduce' },
      { label: 'Make Substack...', command: 'substack' },
      { label: 'Add Slice', command: 'add-slice' },
      { label: 'Delete Slice', command: 'delete-slice' },
      { label: 'Insert...', command: 'insert' },
      { label: 'Combine...', command: 'combine' },
      { label: 'Concatenate...', command: 'concatenate' },
      { label: 'Start Animation', command: 'animation-start' },
      { label: 'Stop Animation', command: 'animation-stop' },
      { label: 'Animation Options...', command: 'animation-options' },
      { label: 'Set Label...', command: 'set-label' },
      { label: 'Remove Slice Labels', command: 'remove-slice-labels' },
      { label: 'Label...', command: 'label' },
      { label: '3D Project...', command: 'project-3d' },
      { label: 'Magic Montage Tools', command: 'magic-montage' },
    ],
  },
  { label: 'Math', items: [{ label: 'Invert', op: 'invert' }, { label: 'Add' }, { label: 'Subtract' }, { label: 'Multiply' }] },
  { label: 'Filters', items: [{ label: 'Mean', op: 'mean3x3' }, { label: 'Median', op: 'median3x3' }, { label: 'Gaussian Blur', op: 'gaussian' }, { label: 'Minimum', op: 'minimum3x3' }, { label: 'Maximum', op: 'maximum3x3' }, { label: 'Sharpen', op: 'sharpen3x3' }, { label: 'Unsharp Mask' }] },
  { label: 'Binary', items: [{ label: 'Erode', op: 'erode' }, { label: 'Dilate', op: 'dilate' }, { label: 'Open', op: 'open' }, { label: 'Close', op: 'close' }, { label: 'Fill Holes', op: 'fillHoles' }, { label: 'Skeletonize' }, { label: 'Watershed' }] },
  { label: 'Find Edges', items: [{ label: 'Sobel', op: 'sobel' }] },
]

const COLLAPSED_GROUPS_KEY = 'imagej.sidebar.collapsedGroups'

const LABELS: Record<Language, {
  groups: Record<string, string>
  items: Record<string, string>
  search: string
  unavailable: string
  empty: string
}> = {
  'zh-CN': {
    groups: { RAW: 'RAW', Type: '类型', Adjust: '调整', Transform: '变换', Stacks: '图像栈', Math: '数学运算', Filters: '滤镜', Binary: '二值化', 'Find Edges': '寻找边缘' },
    items: { Debayer: '去马赛克', '8-bit': '8 位', '16-bit': '16 位', '32-bit': '32 位', 'RGB Color': 'RGB 彩色', 'Brightness/Contrast': '亮度/对比度', Threshold: '阈值', 'Auto Threshold': '自动阈值', 'Color Balance': '色彩平衡', Crop: '裁剪', 'Flip Horizontally': '水平翻转', 'Flip Vertically': '垂直翻转', 'Rotate 90° Right': '顺时针旋转 90°', 'Rotate 90° Left': '逆时针旋转 90°', Scale: '缩放尺寸', 'Next Slice': '下一切片', 'Previous Slice': '上一切片', 'Z Project...': 'Z 投影…', 'Grouped Z Project...': '分组 Z 投影…', 'Make Montage...': '制作蒙太奇…', 'Montage to Stack...': '蒙太奇转 Stack…', 'Reslice [/]...': '重切…', 'Orthogonal Views': '正交视图', 'Plot Z-axis Profile': 'Z 轴剖面图', 'Measure Stack...': '整栈测量…', Statistics: '统计', 'Plot XY Profile': '逐页剖面…', Reverse: '反转顺序', 'Reduce...': '抽稀…', 'Make Substack...': '子栈…', 'Add Slice': '插入空白切片', 'Delete Slice': '删除当前切片', 'Insert...': '插入图像…', 'Combine...': '合并拼接…', 'Concatenate...': '首尾拼接…', 'Start Animation': '开始动画', 'Stop Animation': '停止动画', 'Animation Options...': '动画选项…', 'Set Label...': '设置标签…', 'Remove Slice Labels': '清除切片标签', 'Label...': '标注切片…', '3D Project...': '3D 投影…', 'Magic Montage Tools': '蒙太奇工具…', Invert: '反相', Add: '加', Subtract: '减', Multiply: '乘', Mean: '均值', Median: '中值', 'Gaussian Blur': '高斯模糊', Minimum: '最小值', Maximum: '最大值', Sharpen: '锐化', 'Unsharp Mask': '反锐化蒙版', Erode: '腐蚀', Dilate: '膨胀', Open: '开运算', Close: '闭运算', 'Fill Holes': '填孔', Skeletonize: '骨架化', Watershed: '分水岭', Sobel: 'Sobel 边缘' },
    search: '搜索命令', unavailable: '尚未接入', empty: '没有匹配的命令',
  },
  en: {
    groups: {}, items: {}, search: 'Search commands', unavailable: 'Not available yet', empty: 'No matching commands',
  },
  'ja-JP': {
    groups: { RAW: 'RAW', Type: '形式', Adjust: '調整', Transform: '変換', Stacks: 'スタック', Math: '演算', Filters: 'フィルタ', Binary: '二値化', 'Find Edges': 'エッジ検出' },
    items: { Debayer: 'デベイヤ' }, search: 'コマンドを検索', unavailable: '未対応', empty: '該当するコマンドがありません',
  },
}

export function ImageJSidebar({ language, registry, onRun, onCommand, disabled = false, stackActions, expandableCommands, expandedCommand, panel, onToggleCommand }: {
  language: Language
  registry: OperatorRegistry
  /** 执行命令：传算子 kind，由父组件直接跑。 */
  onRun: (op: string) => void
  /** 执行栈命令（Z 投影 / 整栈统计）：传 command 字符串，由父组件分派。 */
  onCommand?: (command: string) => void
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
  /** 被折叠起来的分组（记住用户的选择）。 */
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const panelRef = useRef<HTMLDivElement | null>(null)
  const labels = LABELS[language] ?? LABELS.en
  const operators = new Map(registry.operators.map((operator) => [operator.kind, operator]))
  const localize = (label: string) => labels.items[label] ?? label
  const searching = query.trim().length > 0
  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => `${item.label} ${localize(item.label)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
  })).filter((group) => group.items.length)
  // 展开的面板紧跟在命令项下方，可能落在可视区外——把它（连同命令项）滚进视野。
  useEffect(() => { panelRef.current?.scrollIntoView({ block: 'nearest' }) }, [expandedCommand])
  // 恢复用户折叠过哪些分组（隐私模式下读不到就保持默认全展开）。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY)
      if (raw) setCollapsedGroups(JSON.parse(raw) as Record<string, boolean>)
    } catch { /* 忽略损坏的缓存 */ }
  }, [])
  const toggleGroup = (label: string) => setCollapsedGroups((current) => {
    const next = { ...current, [label]: !current[label] }
    try { localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next)) } catch { /* 写不进去也不影响本次会话 */ }
    return next
  })
  // 从别处（比如工具栏）打开了某个命令的面板时，它所在的分组要自动展开，否则面板看不见。
  // 这次展开不写回 localStorage —— 它是临时的，不该覆盖用户手动折叠的选择。
  useEffect(() => {
    if (!expandedCommand) return
    const owner = GROUPS.find((entry) => entry.items.some((item) => item.label === expandedCommand))
    if (!owner) return
    setCollapsedGroups((current) => (current[owner.label] ? { ...current, [owner.label]: false } : current))
  }, [expandedCommand])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-2 pb-1.5 pt-2">
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}
          className="h-7 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus:border-primary/60" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.length ? groups.map((group) => {
          // 搜索时一律展开：否则命中的命令会被折叠状态藏起来，搜索就白搜了。
          const groupOpen = searching || !collapsedGroups[group.label]
          return (
            <section key={group.label} className="mb-1.5">
              <button
                type="button"
                aria-expanded={groupOpen}
                onClick={() => toggleGroup(group.label)}
                className="flex w-full items-center gap-0.5 rounded-[var(--radius-field)] px-1 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-base-content/45 transition hover:bg-muted hover:text-base-content/75"
              >
                {groupOpen ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
                <span>{labels.groups[group.label] ?? group.label}</span>
                <span className="ml-auto font-mono text-[9px] tabular-nums text-base-content/30">{group.items.length}</span>
              </button>
              {groupOpen ? (
                <div className="grid gap-0.5">
              {group.items.map((item) => {
                const operator = item.op ? operators.get(item.op) : undefined
                const action = item.label === 'Next Slice' ? stackActions?.next : item.label === 'Previous Slice' ? stackActions?.previous : undefined
                /** 该命令有没有下拉面板 —— 决定画不画 ▸。 */
                const hasPanel = Boolean(expandableCommands?.includes(item.label))
                /**
                 * 点击是否由侧栏拦截、直接切换面板。
                 *
                 * 只有**没有命令处理器**的命令才这样（亮度/对比度、阈值、高斯、Debayer 这类
                 * 直接作用于当前图的参数面板）。带 `command` 的命令（Z 投影、蒙太奇、Reslice、
                 * Insert/Combine…）由各自的处理器打开面板并做初始化，侧栏若抢先拦截，
                 * 它们就永远点不开。
                 */
                const intercept = Boolean(hasPanel && onToggleCommand && !item.command)
                const open = hasPanel && expandedCommand === item.label
                const runnable = Boolean(item.command && onCommand)
                const available = Boolean(operator || action || hasPanel || runnable)
                const blocked = disabled || !available || (item.label === 'Next Slice' && !stackActions?.canNext) || (item.label === 'Previous Slice' && !stackActions?.canPrevious)
                return (
                  <div key={item.label}>
                    <button type="button" disabled={blocked} title={!available ? labels.unavailable : undefined}
                      aria-expanded={hasPanel ? open : undefined}
                      onClick={() => {
                        if (intercept && onToggleCommand) { onToggleCommand(item.label); return }
                        if (action) action()
                        else if (item.command && onCommand) onCommand(item.command)
                        else if (item.op && operator) onRun(item.op)
                      }}
                      className={`flex w-full items-center justify-between rounded-[var(--radius-field)] px-1.5 py-1 text-left text-[13px] transition ${open ? 'bg-muted text-base-content' : 'text-base-content hover:bg-muted'} disabled:cursor-not-allowed disabled:text-base-content/35 disabled:hover:bg-transparent`}>
                      <span>{localize(item.label)}{item.shortcut ? <span className="ml-1.5 font-mono text-[10px] text-base-content/40">[{item.shortcut}]</span> : null}</span>
                      {/* 只有真正有下拉面板的命令才画箭头：点了直接执行的命令画 ▸ 会让人
                          以为还有下一层。 */}
                      {!available
                        ? <span className="text-[10px]">{labels.unavailable}</span>
                        : hasPanel
                          ? (open ? <ChevronDown size={13} className="text-base-content/55" /> : <ChevronRight size={13} className="text-base-content/35" />)
                          : null}
                    </button>
                    {open ? (
                      /* 面板与命令项等宽（不再用左缩进 + 层级竖线：那样面板比命令项窄，
                         左侧还会多出一根与内容无关的线，整体看着不齐）。 */
                      <div ref={panelRef} className="mb-1.5">{panel}</div>
                    ) : null}
                  </div>
                )
              })}
                </div>
              ) : null}
            </section>
          )
        }) : <p className="px-2 py-4 text-center text-xs text-base-content/50">{labels.empty}</p>}
      </div>
    </div>
  )
}
