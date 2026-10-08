'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@joplot/ui/button'
import { Checkbox } from '@joplot/ui/checkbox'
import { Label } from '@joplot/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@joplot/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@joplot/ui/dialog'
import { Input } from '@joplot/ui/input'
import { Slider } from '@joplot/ui/slider'
import { adjustContrastRange, contrastSliderValues, imagejAutoRange, type ColorAdjustment, type ColorChannel } from '../engine/colorAdjustments'
import type { ImageBlock } from '../engine/types'
import type { Rect } from '../lib/processor'
import { fastHistogram, type FastHistogram } from '../lib/fastHistogram'
import { HistogramChart } from './HistogramChart'

const COPY = {
  'zh-CN': { live: '实时', refresh: '刷新直方图', title: '亮度/对比度', minimum: '最小值', maximum: '最大值', brightness: '亮度', contrast: '对比度', channel: '通道', auto: '自动', reset: '重置', set: '设置', apply: '应用', close: '关闭', range: '设置显示范围', minValue: '显示最小值', maxValue: '显示最大值', ok: '确定', cancel: '取消', invalid: '请输入有限数值，最大值不能小于最小值。', pixels: '像素', cumulative: '累计', level: '灰度', frequency: '频率', log: '对数刻度', stack: '应用到整个 Stack？', stackHint: '将当前亮度/对比度设置应用到所有切片？', current: '仅当前切片', all: '整个 Stack' },
  en: { live: 'Live', refresh: 'Refresh histogram', title: 'Brightness/Contrast', minimum: 'Minimum', maximum: 'Maximum', brightness: 'Brightness', contrast: 'Contrast', channel: 'Channel', auto: 'Auto', reset: 'Reset', set: 'Set', apply: 'Apply', close: 'Close', range: 'Set Display Range', minValue: 'Minimum displayed value', maxValue: 'Maximum displayed value', ok: 'OK', cancel: 'Cancel', invalid: 'Enter finite values with maximum greater than or equal to minimum.', pixels: 'px', cumulative: 'Cumulative', level: 'Level', frequency: 'Frequency', log: 'Log scale', stack: 'Apply to Entire Stack?', stackHint: 'Apply brightness and contrast settings to all slices in the stack?', current: 'Current slice', all: 'Entire Stack' },
  'ja-JP': { live: 'ライブ', refresh: 'ヒストグラムを更新', title: '明るさ/コントラスト', minimum: '最小値', maximum: '最大値', brightness: '明るさ', contrast: 'コントラスト', channel: 'チャンネル', auto: '自動', reset: 'リセット', set: '設定', apply: '適用', close: '閉じる', range: '表示範囲を設定', minValue: '表示の最小値', maxValue: '表示の最大値', ok: 'OK', cancel: 'キャンセル', invalid: '有限値を入力し、最大値を最小値以上にしてください。', pixels: 'ピクセル', cumulative: '累積', level: '階調', frequency: '頻度', log: '対数目盛', stack: 'スタック全体に適用？', stackHint: '現在の設定をすべてのスライスに適用しますか？', current: '現在のスライス', all: 'スタック全体' },
}

export function ColorContrastPanel({ block, roi, language, busy, hasStack, embedded = false, singleChannel = false, mode = 'brightness', session = 0, onPreview, onApply }: {
  block: ImageBlock; roi: Rect | null; language: keyof typeof COPY; busy: boolean; hasStack: boolean
  /** 内联模式：在命令目录里紧跟所属命令项展开（去掉整块分隔线与外边距）。 */
  embedded?: boolean
  /** 灰度图：只有一个通道，隐藏通道选择。 */
  singleChannel?: boolean
  /**
   * 面板服务于哪条命令。
   *
   * `brightness`（Brightness/Contrast）没有通道概念，永远不显示通道选择器；
   * `colorBalance` 是保留给「按通道的亮度/对比度」的语义；当前调用方恒传 `brightness`，
   * 两者共用这一套控件，若不区分就会长得一模一样。
   */
  mode?: 'brightness' | 'colorBalance'
  /** 变化时复位面板内部状态（撤销 / 重做、换图后重新展开用）。 */
  session?: number
  onPreview(settings: readonly ColorAdjustment[]): void
  onApply(settings: readonly ColorAdjustment[], allPages: boolean): void
  /** 面板不再自带关闭按钮：再点一次命令项即可收起，此处仅为调用方签名兼容。 */
  onClose?(): void
}) {
  const copy = COPY[language], defaultMax = block.dtype === 'uint16' ? 65535 : 255
  const [channel, setChannel] = useState<ColorChannel>('all')
  const [range, setRange] = useState({ min: 0, max: defaultMax })
  const [snapshots, setSnapshots] = useState<readonly ColorAdjustment[]>([])
  const [autoWholeImage, setAutoWholeImage] = useState(false)
  const [log, setLog] = useState(false), [setting, setSetting] = useState(false), [stackDialog, setStackDialog] = useState(false)
  const [enteredMin, setEnteredMin] = useState('0'), [enteredMax, setEnteredMax] = useState(String(defaultMax)), [error, setError] = useState('')
  const autoThreshold = useRef(0)
  const active = useMemo(() => range.min === 0 && range.max === defaultMax ? [] : [{ ...range, channel, roi: !autoWholeImage && roi ? { ...roi } : undefined }], [range, channel, roi, defaultMax, autoWholeImage])
  const settings = useMemo(() => [...snapshots, ...active], [snapshots, active])
  /*
   * 直方图在主线程同步算：worker 那条路每翻一页要复制整帧（12-38 MB）再全图遍历，
   * 往返上百毫秒，而为了让画面不闪旧结果又被保留到新结果返回——翻页时明显滞后。
   * 直方图数据本来就在内存里，抽样同步扫一遍即可，几毫秒出结果。
   *
   * Live（对齐 ImageJ 直方图窗口的 Live 复选框）：勾上就跟随当前切片即时重算；
   * 取消后画面停在最后一次结果上，直到点刷新——用于翻页时想对比某一页的分布。
   */
  const computed = useMemo(() => fastHistogram(block, channel), [block, channel])
  const [live, setLive] = useState(true)
  const [frozen, setFrozen] = useState<FastHistogram | null>(null)
  const histogram = live ? computed : (frozen ?? computed)
  const refresh = () => setFrozen(computed)
  const toggleLive = (on: boolean) => { setLive(on); if (!on) setFrozen(computed) }
  const values = contrastSliderValues(range, 0, defaultMax)
  useEffect(() => { setRange({ min: 0, max: defaultMax }); setSnapshots([]); setAutoWholeImage(false); autoThreshold.current = 0 }, [block, defaultMax, session])
  useEffect(() => onPreview(settings), [settings, onPreview])
  const reset = () => { setRange({ min: 0, max: defaultMax }); setAutoWholeImage(false); autoThreshold.current = 0 }
  const apply = (allPages: boolean) => { onApply(settings, allPages); setSnapshots([]); reset(); setStackDialog(false) }
  const auto = () => {
    const stats = histogram
    if (stats.count === 0) return
    const next = imagejAutoRange(stats.counts, stats.count, stats.min, stats.max, autoThreshold.current, stats.histogramMin, stats.histogramMax)
    autoThreshold.current = next.autoThreshold; setAutoWholeImage(true); setRange({ min: next.min, max: next.max })
  }
  const bins = histogram.counts
  const domain = { min: histogram.histogramMin, max: histogram.histogramMax }
  const color = channel === 'red' ? '#dc2626' : channel === 'green' ? '#16a34a' : channel === 'blue' ? '#2563eb' : 'var(--primary)'
  // 内联展开时留出与命令项之间的间距，和其它命令面板（CommandPanelShell 的 mt-1）一致。
  return <section className={embedded ? 'mt-1' : 'shrink-0 border-b border-base-300 px-3 py-3'}>
    {embedded ? null : <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold">{copy.title}</h3></div>}
    <div className="rounded-[var(--radius-field)] border border-base-300 bg-muted/40">
      <HistogramChart
        data={bins ? { counts: bins, min: domain.min, max: domain.max } : null}
        height={80}
        color={color}
        logScale={log}
        highlight={range.min === 0 && range.max === defaultMax ? null : range}
        labels={{ count: copy.pixels, cumulative: copy.cumulative, level: copy.level, frequency: copy.frequency, empty: '' }}
        ariaLabel={`${copy.channel} ${channel} histogram`}
      />
    </div>
    <div className="mb-2 flex justify-between font-mono text-xs"><span>{Math.round(range.min)}</span><span>{Math.round(range.max)}</span></div>
    <div className="mb-2 flex items-center gap-3 text-xs">
      <label className="flex items-center gap-2"><Checkbox checked={log} onCheckedChange={(value) => setLog(value === true)} />{copy.log}</label>
      {/* ImageJ 直方图窗口的两个控件：Live 决定是否跟随，刷新拉一次当前切片。 */}
      <label className="flex items-center gap-2"><Checkbox checked={live} onCheckedChange={(value) => toggleLive(value === true)} />{copy.live}</label>
      <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5" disabled={busy || live} onClick={refresh} aria-label={copy.refresh}>
        <RefreshCw size={12} />
      </Button>
    </div>
    <div className="grid gap-2">
      {(['minimum', 'maximum', 'brightness', 'contrast'] as const).map((control) => <div key={control} className="grid gap-1">
        <Label htmlFor={`imagej-color-${control}`} className="text-xs">{copy[control]}</Label>
        <Slider id={`imagej-color-${control}`} aria-label={copy[control]} min={0} max={255} step={1} value={[values[control]]} disabled={busy} onValueChange={(next) => { setAutoWholeImage(false); setRange((previous) => adjustContrastRange(previous, control, next[0] ?? values[control], 0, defaultMax)) }} />
      </div>)}
      {singleChannel || mode === 'brightness' ? null : <>
        <Label htmlFor="imagej-color-channel" className="text-xs">{copy.channel}</Label>
        <Select value={channel} onValueChange={(value) => { setSnapshots(settings); setChannel(value as ColorChannel); reset() }} disabled={busy}>
          <SelectTrigger id="imagej-color-channel" className="w-full" size="sm" aria-label={copy.channel}><SelectValue /></SelectTrigger>
          <SelectContent>{(['all', 'red', 'green', 'blue'] as const).map((value) => <SelectItem key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent>
        </Select>
      </>}
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" variant="outline" disabled={busy || histogram.count === 0} onClick={auto}>{copy.auto}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={reset}>{copy.reset}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => { setEnteredMin(String(range.min)); setEnteredMax(String(range.max)); setError(''); setSetting(true) }}>{copy.set}</Button>
        <Button size="sm" disabled={busy} onClick={() => hasStack ? setStackDialog(true) : apply(false)}>{copy.apply}</Button>
      </div>
    </div>
    <Dialog open={setting} onOpenChange={setSetting}><DialogContent><DialogHeader><DialogTitle>{copy.range}</DialogTitle><DialogDescription>{copy.channel}: {channel}</DialogDescription></DialogHeader>
      <Label htmlFor="imagej-set-minimum">{copy.minValue}</Label><Input id="imagej-set-minimum" type="number" step="any" value={enteredMin} onChange={(event) => setEnteredMin(event.target.value)} />
      <Label htmlFor="imagej-set-maximum">{copy.maxValue}</Label><Input id="imagej-set-maximum" type="number" step="any" value={enteredMax} onChange={(event) => setEnteredMax(event.target.value)} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={() => setSetting(false)}>{copy.cancel}</Button><Button onClick={() => { const min = Number(enteredMin), max = Number(enteredMax); if (!enteredMin.trim() || !enteredMax.trim() || !Number.isFinite(min) || !Number.isFinite(max) || max < min) { setError(copy.invalid); return }; setAutoWholeImage(false); setRange({ min, max }); setSetting(false) }}>{copy.ok}</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={stackDialog} onOpenChange={setStackDialog}><DialogContent><DialogHeader><DialogTitle>{copy.stack}</DialogTitle><DialogDescription>{copy.stackHint}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setStackDialog(false)}>{copy.cancel}</Button><Button variant="outline" onClick={() => apply(false)}>{copy.current}</Button><Button onClick={() => apply(true)}>{copy.all}</Button></DialogFooter></DialogContent></Dialog>
  </section>
}




