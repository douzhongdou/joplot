'use client'

import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ImagejCopy } from '../lib/i18n'
import type { OperatorRegistry } from '../lib/engineTypes'

type Tab = 'image' | 'process' | 'analyze'
type Language = 'zh-CN' | 'en' | 'ja-JP'
type MenuItem = { label: string; op?: string }
type MenuGroup = { label: string; items: MenuItem[] }

const MENUS: Record<Tab, MenuGroup[]> = {
  image: [
    { label: 'Type', items: [{ label: '8-bit', op: 'grayscale' }, { label: '16-bit' }, { label: '32-bit' }, { label: 'RGB Color' }] },
    { label: 'Adjust', items: [{ label: 'Brightness/Contrast', op: 'levels' }, { label: 'Threshold', op: 'threshold' }, { label: 'Auto Threshold', op: 'otsu' }, { label: 'Color Balance' }] },
    { label: 'Transform', items: [{ label: 'Crop', op: 'crop' }, { label: 'Flip Horizontally', op: 'flipH' }, { label: 'Flip Vertically', op: 'flipV' }, { label: 'Rotate 90° Right', op: 'rotateCW' }, { label: 'Rotate 90° Left', op: 'rotateCCW' }, { label: 'Scale' }] },
    { label: 'Stacks', items: [{ label: 'Next Slice' }, { label: 'Previous Slice' }, { label: 'Z Project' }] },
  ],
  process: [
    { label: 'Math', items: [{ label: 'Invert', op: 'invert' }, { label: 'Add' }, { label: 'Subtract' }, { label: 'Multiply' }] },
    { label: 'Filters', items: [{ label: 'Mean', op: 'mean3x3' }, { label: 'Median', op: 'median3x3' }, { label: 'Gaussian Blur', op: 'gaussian' }, { label: 'Minimum', op: 'minimum3x3' }, { label: 'Maximum', op: 'maximum3x3' }, { label: 'Sharpen', op: 'sharpen3x3' }, { label: 'Unsharp Mask' }] },
    { label: 'Binary', items: [{ label: 'Erode', op: 'erode' }, { label: 'Dilate', op: 'dilate' }, { label: 'Open', op: 'open' }, { label: 'Close', op: 'close' }, { label: 'Fill Holes', op: 'fillHoles' }, { label: 'Skeletonize' }, { label: 'Watershed' }] },
    { label: 'Find Edges', items: [{ label: 'Sobel', op: 'sobel' }] },
  ],
  analyze: [
    { label: 'Measure', items: [{ label: 'Measure', op: 'measure' }, { label: 'Histogram', op: 'measure' }, { label: 'Plot Profile' }, { label: 'Set Measurements' }] },
    { label: 'Particles', items: [{ label: 'Analyze Particles', op: 'particles' }, { label: 'Summarize' }, { label: 'Distribution' }] },
    { label: 'Calibration', items: [{ label: 'Set Scale' }, { label: 'Calibrate' }] },
  ],
}

const LABELS: Record<Language, {
  tabs: Record<Tab, string>
  groups: Record<string, string>
  items: Record<string, string>
  search: string
  unavailable: string
  empty: string
}> = {
  'zh-CN': {
    tabs: { image: 'Image', process: 'Process', analyze: 'Analyze' },
    groups: { Type: '类型', Adjust: '调整', Transform: '变换', Stacks: '图像栈', Math: '数学运算', Filters: '滤镜', Binary: '二值化', 'Find Edges': '寻找边缘', Measure: '测量', Particles: '粒子', Calibration: '标定' },
    items: { '8-bit': '8 位', '16-bit': '16 位', '32-bit': '32 位', 'RGB Color': 'RGB 彩色', 'Brightness/Contrast': '亮度/对比度', Threshold: '阈值', 'Auto Threshold': '自动阈值', 'Color Balance': '色彩平衡', Crop: '裁剪', 'Flip Horizontally': '水平翻转', 'Flip Vertically': '垂直翻转', 'Rotate 90° Right': '顺时针旋转 90°', 'Rotate 90° Left': '逆时针旋转 90°', Scale: '缩放尺寸', 'Next Slice': '下一切片', 'Previous Slice': '上一切片', 'Z Project': 'Z 投影', Invert: '反相', Add: '加', Subtract: '减', Multiply: '乘', Mean: '均值', Median: '中值', 'Gaussian Blur': '高斯模糊', Minimum: '最小值', Maximum: '最大值', Sharpen: '锐化', 'Unsharp Mask': '反锐化蒙版', Erode: '腐蚀', Dilate: '膨胀', Open: '开运算', Close: '闭运算', 'Fill Holes': '填孔', Skeletonize: '骨架化', Watershed: '分水岭', Sobel: 'Sobel 边缘', Measure: '测量', Histogram: '直方图', 'Plot Profile': '绘制剖面', 'Set Measurements': '设置测量', 'Analyze Particles': '分析粒子', Summarize: '汇总', Distribution: '分布', 'Set Scale': '设置比例尺', Calibrate: '校准' },
    search: '搜索命令', unavailable: '尚未接入', empty: '没有匹配的命令',
  },
  en: {
    tabs: { image: 'Image', process: 'Process', analyze: 'Analyze' },
    groups: {}, items: {}, search: 'Search commands', unavailable: 'Not available yet', empty: 'No matching commands',
  },
  'ja-JP': {
    tabs: { image: 'Image', process: 'Process', analyze: 'Analyze' },
    groups: { Type: '形式', Adjust: '調整', Transform: '変換', Stacks: 'スタック', Math: '演算', Filters: 'フィルタ', Binary: '二値化', 'Find Edges': 'エッジ検出', Measure: '測定', Particles: '粒子', Calibration: '校正' },
    items: {}, search: 'コマンドを検索', unavailable: '未対応', empty: '該当するコマンドがありません',
  },
}

export function ImageJSidebar({ language, copy, registry, onRun, resultsPanel }: {
  language: Language
  copy: ImagejCopy
  registry: OperatorRegistry
  /** 执行命令：传算子 kind，由父组件直接跑（不再排队到步骤台账）。 */
  onRun: (op: string) => void
  /** 「分析」页顶部的结果区（测量统计 / 直方图 / 粒子表）。 */
  resultsPanel?: ReactNode
}) {
  const [tab, setTab] = useState<Tab>('image')
  const [query, setQuery] = useState('')
  const labels = LABELS[language] ?? LABELS.en
  const operators = new Map(registry.operators.map((operator) => [operator.kind, operator]))
  const localize = (label: string) => labels.items[label] ?? label
  const groups = MENUS[tab].map((group) => ({
    ...group,
    items: group.items.filter((item) => `${item.label} ${localize(item.label)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
  })).filter((group) => group.items.length)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label={copy.title} className="flex shrink-0 border-b border-base-300 px-2">
        {(['image', 'process', 'analyze'] as const).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setQuery('') }}
            className={`min-w-0 flex-1 border-b-2 px-1 py-3 text-xs font-medium transition-colors ${tab === key ? 'border-primary text-base-content' : 'border-transparent text-base-content/55 hover:text-base-content'}`}>
            {labels.tabs[key]}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 p-3">
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search}
            className="h-9 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {tab === 'analyze' && resultsPanel ? <div className="mb-4">{resultsPanel}</div> : null}
          {groups.length ? groups.map((group) => (
            <section key={group.label} className="mb-5">
              <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-base-content/45">{labels.groups[group.label] ?? group.label}</h3>
              <div className="grid gap-0.5">
                {group.items.map((item) => {
                  const operator = item.op ? operators.get(item.op) : undefined
                  return (
                    <button key={item.label} type="button" disabled={!operator} title={!operator ? labels.unavailable : undefined}
                      onClick={() => { if (item.op && operator) onRun(item.op) }}
                      className="flex w-full items-center justify-between rounded-[var(--radius-field)] px-2 py-2 text-left text-sm text-base-content hover:bg-muted disabled:cursor-not-allowed disabled:text-base-content/35 disabled:hover:bg-transparent">
                      <span>{localize(item.label)}</span>
                      {operator ? <ChevronRight size={14} className="text-base-content/35" /> : <span className="text-[10px]">{labels.unavailable}</span>}
                    </button>
                  )
                })}
              </div>
            </section>
          )) : <p className="px-2 py-6 text-center text-sm text-base-content/50">{labels.empty}</p>}
        </div>
      </div>
    </div>
  )
}
