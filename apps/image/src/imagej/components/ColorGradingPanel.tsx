'use client'

/**
 * 「白平衡」面板：真正的调色工具（灰度世界 / 白点 / 自动色阶 / 直方图均衡化），
 * 与 Brightness/Contrast（纯亮度对比度显示调整）是两件事。
 *
 * 算法都在 `engine/colorGrading.ts` 里，是纯函数；本面板只负责收集参数并在 Apply 时
 * 往处理链里加一步 `colorGrading`。
 */
import { Button } from '@joplot/ui/button'

import { Checkbox } from '@joplot/ui/checkbox'
import { Input } from '@joplot/ui/input'
import { Label } from '@joplot/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@joplot/ui/select'
import { COLOR_GRADING_METHODS, type ColorGradingMethod } from '../engine/colorGrading'

const COPY = {
  'zh-CN': {
    title: '白平衡', preview: '预览',
    method: '方法',
    grayWorld: '灰度世界', whitePatch: '白点', autoLevels: '自动色阶', equalize: '直方图均衡化', manual: '手动增益',
    grayWorldHint: '假设画面平均色应为中性灰，按各通道均值求增益，校正整体偏色。',
    whitePatchHint: '以画面最亮处为白，按各通道峰值求增益，校正高光色偏。',
    autoLevelsHint: '按比例裁掉两端极值后，每个通道各自拉伸到满量程。',
    equalizeHint: '按累积分布重映射，拉开对比度；强度可控制与原图的混合比例。',
    manualHint: '直接给红/绿/蓝三通道乘增益（1 为不变）。',
    clip: '裁剪比例 (%)', strength: '强度 (%)', red: '红', green: '绿', blue: '蓝', apply: '应用',
  },
  en: {
    title: 'White Balance', preview: 'Preview',
    method: 'Method',
    grayWorld: 'Gray World', whitePatch: 'White Patch', autoLevels: 'Auto Levels', equalize: 'Equalize', manual: 'Manual gains',
    grayWorldHint: 'Assume the scene averages to neutral gray; per-channel gain from channel means.',
    whitePatchHint: 'Treat the brightest point as white; per-channel gain from channel peaks.',
    autoLevelsHint: 'Clip both tails by a percentage, then stretch each channel to full scale.',
    equalizeHint: 'Remap by cumulative distribution to open up contrast; strength blends with the original.',
    manualHint: 'Multiply the red/green/blue channels by explicit gains (1 = unchanged).',
    clip: 'Clip (%)', strength: 'Strength (%)', red: 'Red', green: 'Green', blue: 'Blue', apply: 'Apply',
  },
  'ja-JP': {
    title: 'ホワイトバランス', preview: 'プレビュー',
    method: '方法',
    grayWorld: 'グレーワールド', whitePatch: 'ホワイトパッチ', autoLevels: '自動レベル', equalize: 'ヒストグラム平坦化', manual: '手動ゲイン',
    grayWorldHint: '画面の平均色が無彩色と仮定し、チャンネル平均からゲインを求めます。',
    whitePatchHint: '最も明るい点を白とみなし、チャンネル最大値からゲインを求めます。',
    autoLevelsHint: '両端を割合で切り捨て、各チャンネルをフルスケールに伸張します。',
    equalizeHint: '累積分布で再マップしてコントラストを広げます。強度で元画像と混合できます。',
    manualHint: 'RGB 各チャンネルにゲインを掛けます（1 で変化なし）。',
    clip: 'クリップ (%)', strength: '強度 (%)', red: '赤', green: '緑', blue: '青', apply: '適用',
  },
}

const METHOD_LABELS: Record<ColorGradingMethod, keyof (typeof COPY)['zh-CN']> = {
  grayWorld: 'grayWorld',
  whitePatch: 'whitePatch',
  autoLevels: 'autoLevels',
  equalize: 'equalize',
  manual: 'manual',
}

export function ColorGradingPanel({ language, method, clipPercent, strength, gains, preview, disabled, onMethod, onClipPercent, onStrength, onGain, onPreview, onApply }: {
  language: keyof typeof COPY
  method: ColorGradingMethod
  /** 自动色阶两端各裁掉的像素比例（%）。 */
  clipPercent: number
  /** 均衡化强度（%）。 */
  strength: number
  /** 手动模式的 RGB 增益。 */
  gains: readonly number[]
  /** 「预览」复选框：勾上才把当前参数实时刷进画面。 */
  preview: boolean
  disabled: boolean
  onMethod(value: ColorGradingMethod): void
  onClipPercent(value: number): void
  onStrength(value: number): void
  onGain(channel: number, value: number): void
  onPreview(value: boolean): void
  onApply(): void
}) {
  const copy = COPY[language] ?? COPY.en
  const hintKey = `${METHOD_LABELS[method]}Hint` as keyof typeof copy
  const channels: readonly (keyof typeof copy)[] = ['red', 'green', 'blue']
  return <section className="mt-1">
    <div className="grid gap-2">
      <div className="grid gap-1">
        <Label htmlFor="imagej-grading-method" className="text-xs">{copy.method}</Label>
        <Select value={method} onValueChange={(value) => onMethod(value as ColorGradingMethod)} disabled={disabled}>
          <SelectTrigger id="imagej-grading-method" className="w-full" size="sm" aria-label={copy.method}><SelectValue /></SelectTrigger>
          <SelectContent>
            {COLOR_GRADING_METHODS.map((value) => <SelectItem key={value} value={value}>{copy[METHOD_LABELS[value]]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-base-content/55">{copy[hintKey]}</p>

      <label className="flex items-center gap-2 text-xs">

        <Checkbox checked={preview} disabled={disabled} onCheckedChange={(value) => onPreview(value === true)} />

        {copy.preview}

      </label>
      {method === 'autoLevels' ? <div className="grid gap-1">
        <Label htmlFor="imagej-grading-clip" className="text-xs">{copy.clip}</Label>
        <Input id="imagej-grading-clip" type="number" min={0} max={10} step={0.1} value={clipPercent} disabled={disabled}
          onChange={(event) => onClipPercent(Math.max(0, Math.min(10, Number(event.target.value) || 0)))} className="h-7 px-2 text-xs" />
      </div> : null}
      {method === 'equalize' ? <div className="grid gap-1">
        <Label htmlFor="imagej-grading-strength" className="text-xs">{copy.strength}</Label>
        <Input id="imagej-grading-strength" type="number" min={0} max={100} step={5} value={strength} disabled={disabled}
          onChange={(event) => onStrength(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} className="h-7 px-2 text-xs" />
      </div> : null}
      {method === 'manual' ? <div className="grid grid-cols-3 gap-2">
        {channels.map((key, index) => <div key={key} className="grid gap-1">
          <Label htmlFor={`imagej-grading-gain-${index}`} className="text-xs">{copy[key]}</Label>
          <Input id={`imagej-grading-gain-${index}`} type="number" min={0} max={4} step={0.05} value={gains[index] ?? 1} disabled={disabled}
            onChange={(event) => onGain(index, Math.max(0, Math.min(4, Number(event.target.value) || 0)))} className="h-7 px-2 text-xs" />
        </div>)}
      </div> : null}
      <Button size="sm" className="h-8" disabled={disabled} onClick={onApply}>{copy.apply}</Button>
    </div>
  </section>
}