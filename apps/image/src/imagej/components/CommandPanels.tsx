'use client'

import type { ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@joplot/ui/button'
import { Label } from '@joplot/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@joplot/ui/select'
import type { ImagejCopy } from '../lib/i18n'

/**
 * 命令目录里每个命令项下方内联展开的操作面板。
 *
 * 外壳只负责圆角背景与内边距，**不渲染关闭按钮**：面板本身就是该命令项的下拉内容，
 * 再点一次命令项即收起（`ImageJSidebar` 的 `onToggleCommand`），
 * 之前右上角那个 ✕ 既多余，又白占掉面板顶部一行高度。
 *
 * `close` / `closeLabel` 保留在签名里（可选、不再使用），这样各面板的调用写法无需改动。
 */
function CommandPanelShell({ children }: {
  close?(): void
  closeLabel?: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div className="mt-1 rounded-[var(--radius-field)] border border-base-300 bg-base-200/40 p-2">
      {children}
    </div>
  )
}

/** 「亮度/对比度」：灰度图的亮度、对比度滑杆（RGB 图改用 ColorContrastPanel）。 */
export function LevelsCommandPanel({ copy, brightness, contrast, active, disabled, onBrightness, onContrast, onApply, onClose }: {
  copy: ImagejCopy
  brightness: number
  contrast: number
  /** 亮度/对比度是否偏离默认值——没动过时禁用应用按钮。 */
  active: boolean
  disabled: boolean
  onBrightness(value: number): void
  onContrast(value: number): void
  onApply(): void
  onClose(): void
}) {
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label htmlFor="imagej-brightness" className="justify-between text-xs">
            <span>{copy.adjust.brightness}</span>
            <span className="font-mono tabular-nums text-base-content/60">{brightness}</span>
          </Label>
          <input
            id="imagej-brightness"
            type="range"
            min={-127}
            max={127}
            step={1}
            value={brightness}
            disabled={disabled}
            onChange={(event) => onBrightness(Number(event.target.value))}
            className="w-full accent-primary"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="imagej-contrast" className="justify-between text-xs">
            <span>{copy.adjust.contrast}</span>
            <span className="font-mono tabular-nums text-base-content/60">{contrast}</span>
          </Label>
          <input
            id="imagej-contrast"
            type="range"
            min={1}
            max={100}
            step={1}
            value={contrast}
            disabled={disabled}
            onChange={(event) => onContrast(Number(event.target.value))}
            className="w-full accent-primary"
          />
        </div>
        <Button type="button" size="sm" className="h-8" disabled={disabled || !active} onClick={onApply}>
          {copy.adjust.applyLevels}
        </Button>
      </div>
    </CommandPanelShell>
  )
}

/** 「阈值」：手动阈值滑杆 + Otsu 自动阈值。 */
export function ThresholdCommandPanel({ copy, level, minimum, maximum, step, disabled, onLevel, onApply, onOtsu, onClose }: {
  copy: ImagejCopy
  level: number
  minimum: number
  maximum: number
  step: number | 'any'
  disabled: boolean
  onLevel(value: number): void
  onApply(): void
  onOtsu(): void
  onClose(): void
}) {
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="imagej-threshold-level" className="text-xs">{copy.adjust.threshold}</Label>
          <span className="font-mono text-xs tabular-nums text-base-content/70">{level}</span>
        </div>
        <input
          id="imagej-threshold-level"
          type="range"
          min={minimum}
          max={maximum}
          step={step}
          value={level}
          disabled={disabled}
          aria-label={copy.adjust.threshold}
          onChange={(event) => onLevel(Number(event.target.value))}
          className="w-full accent-primary"
        />
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>
            {copy.adjust.thresholdApply}
          </Button>
          <Button type="button" variant="secondary" size="sm" className="h-8" disabled={disabled} onClick={onOtsu}>
            <Sparkles size={14} />
            {copy.adjust.otsu}
          </Button>
        </div>
      </div>
    </CommandPanelShell>
  )
}

/** 「高斯模糊」：σ 滑杆。 */
export function GaussianCommandPanel({ copy, sigma, disabled, onSigma, onApply, onClose }: {
  copy: ImagejCopy
  sigma: number
  disabled: boolean
  onSigma(value: number): void
  onApply(): void
  onClose(): void
}) {
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label htmlFor="imagej-gaussian-sigma" className="justify-between text-xs">
            <span>{copy.filters.sigma}</span>
            <span className="font-mono tabular-nums text-base-content/60">{sigma.toFixed(1)}</span>
          </Label>
          <input
            id="imagej-gaussian-sigma"
            type="range"
            min={0.5}
            max={5}
            step={0.1}
            value={sigma}
            disabled={disabled}
            onChange={(event) => onSigma(Number(event.target.value))}
            className="w-full accent-primary"
          />
        </div>
        <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>
          {copy.filters.gaussian}
        </Button>
      </div>
    </CommandPanelShell>
  )
}

/** 「去马赛克」：滤镜序列（CFA 图案）+ 算法，供 RAW 的 CFA 数据还原彩色。 */
export function DebayerCommandPanel({ copy, pattern, algorithm, disabled, onPattern, onAlgorithm, onApply, onClose }: {
  copy: ImagejCopy
  pattern: string
  algorithm: string
  disabled: boolean
  onPattern(value: string): void
  onAlgorithm(value: string): void
  onApply(): void
  onClose(): void
}) {
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label htmlFor="imagej-debayer-pattern" className="text-xs">{copy.debayer.pattern}</Label>
          <Select value={pattern} disabled={disabled} onValueChange={onPattern}>
            <SelectTrigger id="imagej-debayer-pattern" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{copy.debayer.patternAuto}</SelectItem>
              {['rggb', 'bggr', 'grbg', 'gbrg'].map((value) => (
                <SelectItem key={value} value={value}>{value.toUpperCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="imagej-debayer-algorithm" className="text-xs">{copy.debayer.algorithm}</Label>
          <Select value={algorithm} disabled={disabled} onValueChange={onAlgorithm}>
            <SelectTrigger id="imagej-debayer-algorithm" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="malvar">Malvar-He-Cutler</SelectItem>
              <SelectItem value="bilinear">Bilinear</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>
          {copy.debayer.apply}
        </Button>
      </div>
    </CommandPanelShell>
  )
}

/**
 * 「Z 投影…」/「分组 Z 投影…」：投影方式 + 切片范围（分组时改为组大小）。
 *
 * 两项共用同一个面板：分组投影与整体投影的唯一差别是「每几页合成一页」，其余语义相同。
 */
export function ZProjectCommandPanel({ copy, grouped, method, start, stop, groupSize, sliceCount, timeCount, factors, allTimeFrames, disabled, onMethod, onStart, onStop, onGroupSize, onAllTimeFrames, onApply, onClose }: {
  copy: ImagejCopy
  grouped: boolean
  method: string
  start: number
  stop: number
  groupSize: number
  sliceCount: number
  /** 时间帧数；大于 1 时才提供「全部时间帧」（对应 ImageJ 的 All time frames）。 */
  timeCount: number
  /** 能整除页数的组大小候选（ImageJ 的 "Valid factors" 提示行）。 */
  factors: readonly number[]
  allTimeFrames: boolean
  disabled: boolean
  onMethod(value: string): void
  onStart(value: number): void
  onStop(value: number): void
  onGroupSize(value: number): void
  onAllTimeFrames(value: boolean): void
  onApply(): void
  onClose(): void
}) {
  const ops = copy.stackOps
  const fieldClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus:border-primary/60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  const methods = ['average', 'max', 'min', 'sum', 'sd', 'median'] as const
  const maxSlice = Math.max(1, sliceCount)
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label htmlFor="imagej-projection-method" className="text-xs">{ops.method}</Label>
          <Select value={method} disabled={disabled} onValueChange={onMethod}>
            <SelectTrigger id="imagej-projection-method" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {methods.map((value) => <SelectItem key={value} value={value}>{ops.methods[value]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {!grouped && timeCount > 1 ? (
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={allTimeFrames}
              disabled={disabled}
              onChange={(event) => onAllTimeFrames(event.target.checked)}
            />
            {ops.allTimeFrames}
          </label>
        ) : null}
        {grouped ? (
          <div className="grid gap-1">
            <Label htmlFor="imagej-projection-group" className="justify-between text-xs">
              <span>{ops.groupSize}</span>
              <span className="font-mono tabular-nums text-base-content/60">{groupSize}</span>
            </Label>
            <input
              id="imagej-projection-group"
              type="number"
              min={1}
              max={maxSlice}
              step={1}
              value={groupSize}
              disabled={disabled}
              onChange={(event) => onGroupSize(Math.max(1, Math.round(Number(event.target.value) || 1)))}
              className={fieldClass}
            />
            <p className="text-[10px] text-base-content/55">{ops.groupHint}</p>
            <p className="text-[10px] text-base-content/55">{ops.factors}: {factors.join(', ')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="imagej-projection-start" className="text-xs">{ops.startSlice}</Label>
              <input
                id="imagej-projection-start"
                type="number"
                min={1}
                max={maxSlice}
                step={1}
                value={start}
                disabled={disabled}
                onChange={(event) => onStart(Math.max(1, Math.round(Number(event.target.value) || 1)))}
                className={fieldClass}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="imagej-projection-stop" className="text-xs">{ops.stopSlice}</Label>
              <input
                id="imagej-projection-stop"
                type="number"
                min={1}
                max={maxSlice}
                step={1}
                value={stop}
                disabled={disabled}
                onChange={(event) => onStop(Math.max(1, Math.round(Number(event.target.value) || 1)))}
                className={fieldClass}
              />
            </div>
          </div>
        )}
        <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>{ops.run}</Button>
      </div>
    </CommandPanelShell>
  )
}

/**
 * 「制作蒙太奇…」：行列、缩放、切片范围与步长、面板间距。
 *
 * 行列留 0 表示交给引擎按 ImageJ 的自动规则算（列数 ≈ √n，面板过宽时自动降到 0.5 / 0.25 倍）。
 */
export function MontageCommandPanel({ copy, columns, rows, scale, border, start, stop, increment, sliceCount, labelSlices, fontSize, disabled, onColumns, onRows, onScale, onBorder, onStart, onStop, onIncrement, onLabelSlices, onFontSize, onApply, onClose }: {
  copy: ImagejCopy
  columns: number
  rows: number
  scale: number
  border: number
  start: number
  stop: number
  increment: number
  sliceCount: number
  /** 是否在每个面板底部标注切片文本（ImageJ 的 Label slices）。 */
  labelSlices: boolean
  fontSize: number
  disabled: boolean
  onColumns(value: number): void
  onRows(value: number): void
  onScale(value: number): void
  onBorder(value: number): void
  onStart(value: number): void
  onStop(value: number): void
  onIncrement(value: number): void
  onLabelSlices(value: boolean): void
  onFontSize(value: number): void
  onApply(): void
  onClose(): void
}) {
  const ops = copy.stackOps
  const fieldClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus:border-primary/60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  const maxSlice = Math.max(1, sliceCount)
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="imagej-montage-columns" className="text-xs">{ops.columns}</Label>
            <input id="imagej-montage-columns" type="number" min={0} step={1} value={columns} disabled={disabled}
              placeholder={ops.auto}
              onChange={(event) => onColumns(Math.max(0, Math.round(Number(event.target.value) || 0)))} className={fieldClass} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="imagej-montage-rows" className="text-xs">{ops.rows}</Label>
            <input id="imagej-montage-rows" type="number" min={0} step={1} value={rows} disabled={disabled}
              placeholder={ops.auto}
              onChange={(event) => onRows(Math.max(0, Math.round(Number(event.target.value) || 0)))} className={fieldClass} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="imagej-montage-scale" className="text-xs">{ops.scale}</Label>
            <input id="imagej-montage-scale" type="number" min={0} step={0.25} value={scale} disabled={disabled}
              placeholder={ops.auto}
              onChange={(event) => onScale(Math.max(0, Number(event.target.value) || 0))} className={fieldClass} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="imagej-montage-border" className="text-xs">{ops.border}</Label>
            <input id="imagej-montage-border" type="number" min={0} step={1} value={border} disabled={disabled}
              onChange={(event) => onBorder(Math.max(0, Math.round(Number(event.target.value) || 0)))} className={fieldClass} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="imagej-montage-start" className="text-xs">{ops.startSlice}</Label>
            <input id="imagej-montage-start" type="number" min={1} max={maxSlice} step={1} value={start} disabled={disabled}
              onChange={(event) => onStart(Math.max(1, Math.round(Number(event.target.value) || 1)))} className={fieldClass} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="imagej-montage-stop" className="text-xs">{ops.stopSlice}</Label>
            <input id="imagej-montage-stop" type="number" min={1} max={maxSlice} step={1} value={stop} disabled={disabled}
              onChange={(event) => onStop(Math.max(1, Math.round(Number(event.target.value) || 1)))} className={fieldClass} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="imagej-montage-increment" className="text-xs">{ops.increment}</Label>
            <input id="imagej-montage-increment" type="number" min={1} max={maxSlice} step={1} value={increment} disabled={disabled}
              onChange={(event) => onIncrement(Math.max(1, Math.round(Number(event.target.value) || 1)))} className={fieldClass} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={labelSlices} disabled={disabled} onChange={(event) => onLabelSlices(event.target.checked)} />
          {ops.labelSlices}
        </label>
        {labelSlices ? (
          <div className="grid gap-1">
            <Label htmlFor="imagej-montage-font" className="text-xs">{ops.labelFontSize}</Label>
            <input id="imagej-montage-font" type="number" min={5} step={1} value={fontSize} disabled={disabled}
              onChange={(event) => onFontSize(Math.max(5, Math.round(Number(event.target.value) || 12)))} className={fieldClass} />
          </div>
        ) : null}
        <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>{ops.run}</Button>
      </div>
    </CommandPanelShell>
  )
}

/**
 * 「蒙太奇转 Stack…」：行列与边框宽度。
 *
 * 行列留 0 表示沿用蒙太奇图元数据里记录的行列（对应 ImageJ 通过 `Info` 传递的 xMontage / yMontage），
 * 都取不到时退化为 2×2。
 */
export function MontageToStackCommandPanel({ copy, columns, rows, border, hint, disabled, onColumns, onRows, onBorder, onApply, onClose }: {
  copy: ImagejCopy
  columns: number
  rows: number
  border: number
  /** 元数据里读到的行列提示，例如「当前蒙太奇：4 × 2」。 */
  hint: string
  disabled: boolean
  onColumns(value: number): void
  onRows(value: number): void
  onBorder(value: number): void
  onApply(): void
  onClose(): void
}) {
  const ops = copy.stackOps
  const fieldClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus:border-primary/60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="imagej-mts-columns" className="text-xs">{ops.columns}</Label>
            <input id="imagej-mts-columns" type="number" min={0} step={1} value={columns} disabled={disabled}
              placeholder={ops.auto}
              onChange={(event) => onColumns(Math.max(0, Math.round(Number(event.target.value) || 0)))} className={fieldClass} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="imagej-mts-rows" className="text-xs">{ops.rows}</Label>
            <input id="imagej-mts-rows" type="number" min={0} step={1} value={rows} disabled={disabled}
              placeholder={ops.auto}
              onChange={(event) => onRows(Math.max(0, Math.round(Number(event.target.value) || 0)))} className={fieldClass} />
          </div>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="imagej-mts-border" className="text-xs">{ops.border}</Label>
          <input id="imagej-mts-border" type="number" min={0} step={1} value={border} disabled={disabled}
            onChange={(event) => onBorder(Math.max(0, Math.round(Number(event.target.value) || 0)))} className={fieldClass} />
        </div>
        {hint ? <p className="text-[10px] text-base-content/55">{hint}</p> : null}
        <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>{ops.run}</Button>
      </div>
    </CommandPanelShell>
  )
}

/**
 * 「重切…」（Reslice [/]...）：输出间距、起始边、垂直翻转与 90° 旋转。
 *
 * 起始边决定沿哪个方向逐条采样（上/下取水平线，左/右取竖直线），
 * 与 ImageJ 的 `Start at:` 选择一致。
 */
export function ResliceCommandPanel({ copy, spacing, startAt, flip, rotate, hasRoi, disabled, onSpacing, onStartAt, onFlip, onRotate, onApply, onClose }: {
  copy: ImagejCopy
  spacing: number
  startAt: string
  flip: boolean
  rotate: boolean
  /** 是否有矩形选区；没有时按 ImageJ 的行为对整帧重切。 */
  hasRoi: boolean
  disabled: boolean
  onSpacing(value: number): void
  onStartAt(value: string): void
  onFlip(value: boolean): void
  onRotate(value: boolean): void
  onApply(): void
  onClose(): void
}) {
  const ops = copy.stackOps
  const fieldClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus:border-primary/60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  const starts = [
    { value: 'top', label: ops.startTop },
    { value: 'left', label: ops.startLeft },
    { value: 'bottom', label: ops.startBottom },
    { value: 'right', label: ops.startRight },
  ]
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label htmlFor="imagej-reslice-spacing" className="text-xs">{ops.outputSpacing}</Label>
          <input
            id="imagej-reslice-spacing"
            type="number"
            min={0.1}
            step={0.5}
            value={spacing}
            disabled={disabled}
            onChange={(event) => onSpacing(Math.max(0.1, Number(event.target.value) || 1))}
            className={fieldClass}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="imagej-reslice-start" className="text-xs">{ops.startAt}</Label>
          <Select value={startAt} disabled={disabled} onValueChange={onStartAt}>
            <SelectTrigger id="imagej-reslice-start" size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {starts.map((start) => <SelectItem key={start.value} value={start.value}>{start.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={flip} disabled={disabled} onChange={(event) => onFlip(event.target.checked)} />
          {ops.flipVertically}
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={rotate} disabled={disabled} onChange={(event) => onRotate(event.target.checked)} />
          {ops.rotate90}
        </label>
        {hasRoi ? null : <p className="text-[10px] text-base-content/55">{copy.roi.needRoi}</p>}
        <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>{ops.run}</Button>
      </div>
    </CommandPanelShell>
  )
}

/**
 * 「正交视图」（Orthogonal Views）：交叉点的 x / y 像素坐标。
 *
 * 交叉点决定 XZ 取哪一行、YZ 取哪一列；留空则由引擎取图像中心。
 */
export function OrthogonalCommandPanel({ copy, x, y, width, height, disabled, onX, onY, onApply, onClose }: {
  copy: ImagejCopy
  x: number
  y: number
  /** 当前图像的宽高，用于给输入框定范围。 */
  width: number
  height: number
  disabled: boolean
  onX(value: number): void
  onY(value: number): void
  onApply(): void
  onClose(): void
}) {
  const ops = copy.stackOps
  const fieldClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus:border-primary/60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="imagej-orthogonal-x" className="text-xs">{ops.pointX}</Label>
            <input
              id="imagej-orthogonal-x"
              type="number"
              min={0}
              max={Math.max(0, width - 1)}
              step={1}
              value={x}
              disabled={disabled}
              onChange={(event) => onX(Math.max(0, Math.round(Number(event.target.value) || 0)))}
              className={fieldClass}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="imagej-orthogonal-y" className="text-xs">{ops.pointY}</Label>
            <input
              id="imagej-orthogonal-y"
              type="number"
              min={0}
              max={Math.max(0, height - 1)}
              step={1}
              value={y}
              disabled={disabled}
              onChange={(event) => onY(Math.max(0, Math.round(Number(event.target.value) || 0)))}
              className={fieldClass}
            />
          </div>
        </div>
        <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>{ops.run}</Button>
      </div>
    </CommandPanelShell>
  )
}

/**
 * 「抽稀…」（Reduce...）：每 N 页保留一页，从第 1 页起、固定偏移（对齐 ImageJ 的 StackReducer）。
 */
export function ReduceCommandPanel({ copy, factor, sliceCount, disabled, onFactor, onApply, onClose }: {
  copy: ImagejCopy
  factor: number
  sliceCount: number
  disabled: boolean
  onFactor(value: number): void
  onApply(): void
  onClose(): void
}) {
  const ops = copy.stackOps
  const fieldClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus:border-primary/60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  const kept = Math.max(1, Math.ceil(sliceCount / Math.max(1, factor)))
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label htmlFor="imagej-reduce-factor" className="justify-between text-xs">
            <span>{ops.factor}</span>
            <span className="font-mono tabular-nums text-base-content/60">{factor}</span>
          </Label>
          <input
            id="imagej-reduce-factor"
            type="number"
            min={1}
            max={Math.max(1, sliceCount)}
            step={1}
            value={factor}
            disabled={disabled}
            onChange={(event) => onFactor(Math.max(1, Math.round(Number(event.target.value) || 1)))}
            className={fieldClass}
          />
          <p className="text-[10px] text-base-content/55">{kept} / {sliceCount}</p>
        </div>
        <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>{ops.run}</Button>
      </div>
    </CommandPanelShell>
  )
}

/**
 * 「子栈…」（Make Substack...）：切片表达式，语法与 ImageJ 一致（`1-3`、`1-100-2`、`7,9,25`）。
 */
export function SubstackCommandPanel({ copy, value, sliceCount, disabled, onChange, onApply, onClose }: {
  copy: ImagejCopy
  value: string
  sliceCount: number
  disabled: boolean
  onChange(value: string): void
  onApply(): void
  onClose(): void
}) {
  const ops = copy.stackOps
  const fieldClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus:border-primary/60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label htmlFor="imagej-substack-pages" className="text-xs">{ops.pages}</Label>
          <input
            id="imagej-substack-pages"
            type="text"
            value={value}
            disabled={disabled}
            placeholder={ops.pagesHint}
            onChange={(event) => onChange(event.target.value)}
            className={fieldClass}
          />
          <p className="text-[10px] text-base-content/55">{ops.pagesHint} · 1 / {sliceCount}</p>
        </div>
        <Button type="button" size="sm" className="h-8" disabled={disabled || !value.trim()} onClick={onApply}>{ops.run}</Button>
      </div>
    </CommandPanelShell>
  )
}

/**
 * 「插入图像…」（Insert...）与「合并拼接…」（Combine...）共用的面板。
 *
 * 两者都是「当前文档 + 另一个已打开的文档」，差别只在参数：
 * Insert 需要粘贴位置，Combine 需要选择水平 / 垂直。
 */
export function CombineCommandPanel({ copy, op, documents, source, x, y, vertical, disabled, onSource, onX, onY, onVertical, onApply, onClose }: {
  copy: ImagejCopy
  op: 'insert' | 'combine'
  /** 可选的其它已打开文档；`id` 用各自的 datasetId。 */
  documents: readonly { id: string; title: string }[]
  source: string
  x: number
  y: number
  vertical: boolean
  disabled: boolean
  onSource(value: string): void
  onX(value: number): void
  onY(value: number): void
  onVertical(value: boolean): void
  onApply(): void
  onClose(): void
}) {
  const ops = copy.stackOps
  const fieldClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary'
  const missing = documents.length === 0
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label htmlFor="imagej-combine-source" className="text-xs">{ops.sourceDocument}</Label>
          <select
            id="imagej-combine-source"
            value={source}
            disabled={disabled || missing}
            onChange={(event) => onSource(event.target.value)}
            className={fieldClass}
          >
            {documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}
          </select>
          {missing ? <p className="text-[10px] text-base-content/55">{ops.needSecondDocument}</p> : null}
        </div>
        {op === 'insert' ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="imagej-insert-x" className="text-xs">{ops.pasteX}</Label>
              <input id="imagej-insert-x" type="number" step={1} value={x} disabled={disabled}
                onChange={(event) => onX(Math.round(Number(event.target.value) || 0))} className={fieldClass} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="imagej-insert-y" className="text-xs">{ops.pasteY}</Label>
              <input id="imagej-insert-y" type="number" step={1} value={y} disabled={disabled}
                onChange={(event) => onY(Math.round(Number(event.target.value) || 0))} className={fieldClass} />
            </div>
          </div>
        ) : (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={vertical} disabled={disabled} onChange={(event) => onVertical(event.target.checked)} />
            {ops.vertical}
          </label>
        )}
        <Button type="button" size="sm" className="h-8" disabled={disabled || missing || !source} onClick={onApply}>{ops.run}</Button>
      </div>
    </CommandPanelShell>
  )
}

/**
 * 「动画选项…」（Animation Options）：帧率、播放区间、是否来回循环，以及开始 / 停止。
 *
 * 对应 ImageJ 的 Animator 对话框（`Animator.java:233-258`）：Speed 的单位是 fps，
 * 上界 1000；First / Last Frame 只在普通栈上出现（超栈固定为整段）。
 */
export function AnimationCommandPanel({ copy, fps, first, last, loop, running, sliceCount, disabled, onFps, onFirst, onLast, onLoop, onStart, onStop, onClose }: {
  copy: ImagejCopy
  fps: number
  first: number
  last: number
  loop: boolean
  running: boolean
  sliceCount: number
  disabled: boolean
  onFps(value: number): void
  onFirst(value: number): void
  onLast(value: number): void
  onLoop(value: boolean): void
  onStart(): void
  onStop(): void
  onClose(): void
}) {
  const ops = copy.stackOps
  const fieldClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary'
  const maxSlice = Math.max(1, sliceCount)
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label htmlFor="imagej-animation-fps" className="justify-between text-xs">
            <span>{ops.fps}</span>
            <span className="font-mono tabular-nums text-base-content/60">{fps}</span>
          </Label>
          <input
            id="imagej-animation-fps"
            type="number"
            min={0.1}
            max={1000}
            step={1}
            value={fps}
            disabled={disabled}
            onChange={(event) => onFps(Math.max(0.1, Math.min(1000, Number(event.target.value) || 7)))}
            className={fieldClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="imagej-animation-first" className="text-xs">{ops.firstFrame}</Label>
            <input id="imagej-animation-first" type="number" min={1} max={maxSlice} step={1} value={first} disabled={disabled}
              onChange={(event) => onFirst(Math.max(1, Math.round(Number(event.target.value) || 1)))} className={fieldClass} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="imagej-animation-last" className="text-xs">{ops.lastFrame}</Label>
            <input id="imagej-animation-last" type="number" min={1} max={maxSlice} step={1} value={last} disabled={disabled}
              onChange={(event) => onLast(Math.max(1, Math.round(Number(event.target.value) || 1)))} className={fieldClass} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={loop} disabled={disabled} onChange={(event) => onLoop(event.target.checked)} />
          {ops.loopBackAndForth}
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" size="sm" className="h-8" disabled={disabled || running} onClick={onStart}>{ops.animationStart}</Button>
          <Button type="button" variant="secondary" size="sm" className="h-8" disabled={disabled || !running} onClick={onStop}>{ops.animationStop}</Button>
        </div>
      </div>
    </CommandPanelShell>
  )
}

/**
 * 「设置标签…」（Set Label...）：给**当前切片**写一个标签字符串。
 *
 * 对应 ImageJ 的 `Set Slice Label (<当前切片号>)` 对话框（`SimpleCommands.java:137-158`）：
 * 只改当前片的标签，空串即清除该页。
 */
export function SetLabelCommandPanel({ copy, value, sliceNumber, disabled, onChange, onApply, onClear, onClose }: {
  copy: ImagejCopy
  value: string
  /** 当前切片号（1-based），用于面板标题。 */
  sliceNumber: number
  disabled: boolean
  onChange(value: string): void
  onApply(): void
  onClear(): void
  onClose(): void
}) {
  const ops = copy.stackOps
  const fieldClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary'
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label htmlFor="imagej-set-label" className="justify-between text-xs">
            <span>{ops.labelValue}</span>
            <span className="font-mono tabular-nums text-base-content/60">#{sliceNumber}</span>
          </Label>
          <input
            id="imagej-set-label"
            type="text"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onApply() }}
            className={fieldClass}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>{ops.run}</Button>
          <Button type="button" variant="secondary" size="sm" className="h-8" disabled={disabled} onClick={onClear}>{ops.removeSliceLabels}</Button>
        </div>
      </div>
    </CommandPanelShell>
  )
}

/**
 * 「标注切片…」（Label...）：按格式给切片范围标注文本，并把文本**画进像素**。
 *
 * 对应 ImageJ 的 StackLabeler 对话框（`StackLabeler.java:85-100`）：六种格式、
 * 起始值 / 步长、位置与字号；输出是一个标注后的新栈。
 */
export function LabelCommandPanel({ copy, format, start, interval, text, x, y, fontSize, disabled, onFormat, onStart, onInterval, onText, onX, onY, onFontSize, onApply, onClose }: {
  copy: ImagejCopy
  format: string
  start: number
  interval: number
  text: string
  x: number
  y: number
  fontSize: number
  disabled: boolean
  onFormat(value: string): void
  onStart(value: number): void
  onInterval(value: number): void
  onText(value: string): void
  onX(value: number): void
  onY(value: number): void
  onFontSize(value: number): void
  onApply(): void
  onClose(): void
}) {
  const ops = copy.stackOps
  const fieldClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary'
  const formats = [
    { value: 'number', label: ops.labelFormats.number },
    { value: 'zero-padded', label: ops.labelFormats.zeroPadded },
    { value: 'mm:ss', label: ops.labelFormats.mmss },
    { value: 'hh:mm:ss', label: ops.labelFormats.hhmmss },
    { value: 'text', label: ops.labelFormats.text },
    { value: 'label', label: ops.labelFormats.label },
  ]
  const numberField = (id: string, label: string, value: number, onChange: (value: number) => void, step = 1, min?: number) => (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <input id={id} type="number" step={step} min={min} value={value} disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value) || 0)} className={fieldClass} />
    </div>
  )
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label htmlFor="imagej-label-format" className="text-xs">{ops.labelFormat}</Label>
          <select id="imagej-label-format" value={format} disabled={disabled} onChange={(event) => onFormat(event.target.value)} className={fieldClass}>
            {formats.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {numberField('imagej-label-start', ops.labelStart, start, onStart, 1)}
          {numberField('imagej-label-interval', ops.labelInterval, interval, onInterval, 0.5)}
        </div>
        <div className="grid gap-1">
          <Label htmlFor="imagej-label-text" className="text-xs">{ops.labelText}</Label>
          <input id="imagej-label-text" type="text" value={text} disabled={disabled}
            onChange={(event) => onText(event.target.value)} className={fieldClass} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {numberField('imagej-label-x', ops.labelX, x, onX)}
          {numberField('imagej-label-y', ops.labelY, y, onY)}
          {numberField('imagej-label-font', ops.labelFontSize, fontSize, onFontSize, 1, 5)}
        </div>
        <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>{ops.run}</Button>
      </div>
    </CommandPanelShell>
  )
}

/**
 * 「3D 投影…」（3D Project...）：旋转轴、投影方法、角度序列与两种深度提示。
 *
 * 对应 ImageJ 的 3D Projection 对话框（`Projector.java:104-163`）：角度序列为
 * `floor(总旋转/增量)+1` 帧；不透明度 0 表示全用体渲染、100 表示全用表面。
 */
export function Project3dCommandPanel({ copy, method, axis, initialAngle, totalRotation, angleIncrement, opacity, surfaceCueing, interiorCueing, angleCount, disabled, onMethod, onAxis, onInitialAngle, onTotalRotation, onAngleIncrement, onOpacity, onSurfaceCueing, onInteriorCueing, onApply, onClose }: {
  copy: ImagejCopy
  method: string
  axis: string
  initialAngle: number
  totalRotation: number
  angleIncrement: number
  opacity: number
  surfaceCueing: number
  interiorCueing: number
  /** 预计输出页数，实时显示给用户。 */
  angleCount: number
  disabled: boolean
  onMethod(value: string): void
  onAxis(value: string): void
  onInitialAngle(value: number): void
  onTotalRotation(value: number): void
  onAngleIncrement(value: number): void
  onOpacity(value: number): void
  onSurfaceCueing(value: number): void
  onInteriorCueing(value: number): void
  onApply(): void
  onClose(): void
}) {
  const ops = copy.stackOps
  const fieldClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary'
  const methods = [
    { value: 'nearest', label: ops.methods3d.nearest },
    { value: 'brightest', label: ops.methods3d.brightest },
    { value: 'mean', label: ops.methods3d.mean },
  ]
  const axes = [
    { value: 'x', label: ops.axes3d.x },
    { value: 'y', label: ops.axes3d.y },
    { value: 'z', label: ops.axes3d.z },
  ]
  const numberField = (id: string, label: string, value: number, onChange: (value: number) => void, step = 1, min?: number, max?: number) => (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <input id={id} type="number" step={step} min={min} max={max} value={value} disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value) || 0)} className={fieldClass} />
    </div>
  )
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="imagej-3d-method" className="text-xs">{ops.projection3dMethod}</Label>
            <select id="imagej-3d-method" value={method} disabled={disabled} onChange={(event) => onMethod(event.target.value)} className={fieldClass}>
              {methods.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="imagej-3d-axis" className="text-xs">{ops.projection3dAxis}</Label>
            <select id="imagej-3d-axis" value={axis} disabled={disabled} onChange={(event) => onAxis(event.target.value)} className={fieldClass}>
              {axes.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {numberField('imagej-3d-initial', ops.initialAngle, initialAngle, onInitialAngle, 1, 0, 359)}
          {numberField('imagej-3d-total', ops.totalRotation, totalRotation, onTotalRotation, 1, 0, 359)}
          {numberField('imagej-3d-increment', ops.angleIncrement, angleIncrement, onAngleIncrement, 1, 1, 359)}
        </div>
        <p className="text-[10px] text-base-content/55">{angleCount}</p>
        <div className="grid grid-cols-3 gap-2">
          {numberField('imagej-3d-opacity', ops.opacity, opacity, onOpacity, 5, 0, 100)}
          {numberField('imagej-3d-surface', ops.surfaceCueing, surfaceCueing, onSurfaceCueing, 5, 0, 100)}
          {numberField('imagej-3d-interior', ops.interiorCueing, interiorCueing, onInteriorCueing, 5, 0, 100)}
        </div>
        <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>{ops.run}</Button>
      </div>
    </CommandPanelShell>
  )
}

/**
 * 「蒙太奇工具…」（Magic Montage Tools）：按新的行列重排当前蒙太奇图。
 *
 * ImageJ 里这是一套宏工具集（`macros/MagicMontageTools.txt`），其中最实用的是
 * "Change Montage Layout"：拆开再重拼。这里把它做成一条命令，源行列缺省沿用元数据。
 */
export function RemontageCommandPanel({ copy, sourceColumns, sourceRows, columns, rows, border, labelSlices, fontSize, hint, disabled, onSourceColumns, onSourceRows, onColumns, onRows, onBorder, onLabelSlices, onFontSize, onApply, onClose }: {
  copy: ImagejCopy
  sourceColumns: number
  sourceRows: number
  columns: number
  rows: number
  border: number
  labelSlices: boolean
  fontSize: number
  /** 元数据里读到的源行列提示。 */
  hint: string
  disabled: boolean
  onSourceColumns(value: number): void
  onSourceRows(value: number): void
  onColumns(value: number): void
  onRows(value: number): void
  onBorder(value: number): void
  onLabelSlices(value: boolean): void
  onFontSize(value: number): void
  onApply(): void
  onClose(): void
}) {
  const ops = copy.stackOps
  const fieldClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary'
  const numberField = (id: string, label: string, value: number, onChange: (value: number) => void, min = 0) => (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <input id={id} type="number" min={min} step={1} value={value} disabled={disabled}
        onChange={(event) => onChange(Math.max(min, Math.round(Number(event.target.value) || min)))} className={fieldClass} />
    </div>
  )
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        {hint ? <p className="text-[10px] text-base-content/55">{hint}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          {numberField('imagej-remontage-sc', ops.sourceColumns, sourceColumns, onSourceColumns, 1)}
          {numberField('imagej-remontage-sr', ops.sourceRows, sourceRows, onSourceRows, 1)}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {numberField('imagej-remontage-c', ops.columns, columns, onColumns, 1)}
          {numberField('imagej-remontage-r', ops.rows, rows, onRows, 1)}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {numberField('imagej-remontage-border', ops.border, border, onBorder, 0)}
          {numberField('imagej-remontage-font', ops.labelFontSize, fontSize, onFontSize, 5)}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={labelSlices} disabled={disabled} onChange={(event) => onLabelSlices(event.target.checked)} />
          {ops.labelSlices}
        </label>
        <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>{ops.run}</Button>
      </div>
    </CommandPanelShell>
  )
}


