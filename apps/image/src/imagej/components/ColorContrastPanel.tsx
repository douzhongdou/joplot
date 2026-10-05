'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
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
import { useImageAnalysis } from './useImageAnalysis'
import { HistogramChart } from './HistogramChart'

const COPY = {
  'zh-CN': { title: '亮度/对比度', minimum: '最小值', maximum: '最大值', brightness: '亮度', contrast: '对比度', channel: '通道', auto: '自动', reset: '重置', set: '设置', apply: '应用', close: '关闭', range: '设置显示范围', minValue: '显示最小值', maxValue: '显示最大值', ok: '确定', cancel: '取消', invalid: '请输入有限数值，最大值不能小于最小值。', pixels: '像素', cumulative: '累计', level: '灰度', frequency: '频率', log: '对数刻度', stack: '应用到整个 Stack？', stackHint: '将当前亮度/对比度设置应用到所有切片？', current: '仅当前切片', all: '整个 Stack' },
  en: { title: 'Brightness/Contrast', minimum: 'Minimum', maximum: 'Maximum', brightness: 'Brightness', contrast: 'Contrast', channel: 'Channel', auto: 'Auto', reset: 'Reset', set: 'Set', apply: 'Apply', close: 'Close', range: 'Set Display Range', minValue: 'Minimum displayed value', maxValue: 'Maximum displayed value', ok: 'OK', cancel: 'Cancel', invalid: 'Enter finite values with maximum greater than or equal to minimum.', pixels: 'px', cumulative: 'Cumulative', level: 'Level', frequency: 'Frequency', log: 'Log scale', stack: 'Apply to Entire Stack?', stackHint: 'Apply brightness and contrast settings to all slices in the stack?', current: 'Current slice', all: 'Entire Stack' },
  'ja-JP': { title: '明るさ/コントラスト', minimum: '最小値', maximum: '最大値', brightness: '明るさ', contrast: 'コントラスト', channel: 'チャンネル', auto: '自動', reset: 'リセット', set: '設定', apply: '適用', close: '閉じる', range: '表示範囲を設定', minValue: '表示の最小値', maxValue: '表示の最大値', ok: 'OK', cancel: 'キャンセル', invalid: '有限値を入力し、最大値を最小値以上にしてください。', pixels: 'ピクセル', cumulative: '累積', level: '階調', frequency: '頻度', log: '対数目盛', stack: 'スタック全体に適用？', stackHint: '現在の設定をすべてのスライスに適用しますか？', current: '現在のスライス', all: 'スタック全体' },
}

export function ColorContrastPanel({ block, roi, language, busy, hasStack, embedded = false, session = 0, onPreview, onApply, onClose }: {
  block: ImageBlock; roi: Rect | null; language: keyof typeof COPY; busy: boolean; hasStack: boolean
  /** 内联模式：在命令目录里紧跟所属命令项展开（去掉整块分隔线与外边距）。 */
  embedded?: boolean
  /** 变化时复位面板内部状态（撤销 / 重做、换图后重新展开用）。 */
  session?: number
  onPreview(settings: readonly ColorAdjustment[]): void
  onApply(settings: readonly ColorAdjustment[], allPages: boolean): void
  onClose(): void
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
  const histogram = useImageAnalysis(block, roi, false, 1, roi, channel, snapshots)
  const values = contrastSliderValues(range, 0, defaultMax)
  useEffect(() => { setRange({ min: 0, max: defaultMax }); setSnapshots([]); setAutoWholeImage(false); autoThreshold.current = 0 }, [block, defaultMax, session])
  useEffect(() => onPreview(settings), [settings, onPreview])
  const reset = () => { setRange({ min: 0, max: defaultMax }); setAutoWholeImage(false); autoThreshold.current = 0 }
  const apply = (allPages: boolean) => { onApply(settings, allPages); setSnapshots([]); reset(); setStackDialog(false) }
  const auto = () => {
    const stats = histogram.autoAnalysis
    if (!stats) return
    const next = imagejAutoRange(stats.histogram, stats.count, stats.min, stats.max, autoThreshold.current, stats.histogramMin, stats.histogramMax)
    autoThreshold.current = next.autoThreshold; setAutoWholeImage(true); setRange({ min: next.min, max: next.max })
  }
  const analysis = histogram.analysis
  const bins = analysis?.histogram
  const domain = { min: analysis?.histogramMin ?? 0, max: analysis?.histogramMax ?? defaultMax }
  const color = channel === 'red' ? '#dc2626' : channel === 'green' ? '#16a34a' : channel === 'blue' ? '#2563eb' : 'var(--primary)'
  return <section className={embedded ? '' : 'shrink-0 border-b border-base-300 px-3 py-3'}>
    <div className={embedded ? 'mb-1 flex justify-end' : 'mb-2 flex items-center justify-between'}>
      {embedded ? null : <h3 className="text-xs font-semibold">{copy.title}</h3>}
      <Button variant="ghost" size="icon-sm" aria-label={copy.close} onClick={onClose} disabled={busy}><X size={14} /></Button>
    </div>
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
    <label className="mb-2 flex items-center gap-2 text-xs"><Checkbox checked={log} onCheckedChange={(value) => setLog(value === true)} />{copy.log}</label>
    <div className="grid gap-2">
      {(['minimum', 'maximum', 'brightness', 'contrast'] as const).map((control) => <div key={control} className="grid gap-1">
        <Label htmlFor={`imagej-color-${control}`} className="text-xs">{copy[control]}</Label>
        <Slider id={`imagej-color-${control}`} aria-label={copy[control]} min={0} max={255} step={1} value={[values[control]]} disabled={busy} onValueChange={(next) => { setAutoWholeImage(false); setRange((previous) => adjustContrastRange(previous, control, next[0] ?? values[control], 0, defaultMax)) }} />
      </div>)}
      <Label htmlFor="imagej-color-channel" className="text-xs">{copy.channel}</Label>
      <Select value={channel} onValueChange={(value) => { setSnapshots(settings); setChannel(value as ColorChannel); reset() }} disabled={busy}>
        <SelectTrigger id="imagej-color-channel" className="w-full" size="sm" aria-label={copy.channel}><SelectValue /></SelectTrigger>
        <SelectContent>{(['all', 'red', 'green', 'blue'] as const).map((value) => <SelectItem key={value} value={value}>{value[0]!.toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent>
      </Select>
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" variant="outline" disabled={busy || !histogram.autoAnalysis} onClick={auto}>{copy.auto}</Button>
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

