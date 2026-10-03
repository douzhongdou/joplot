'use client'

import type { ReactNode } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@joplot/ui/button'
import { Label } from '@joplot/ui/label'
import type { ImagejCopy } from '../lib/i18n'

/**
 * 命令目录里每个命令项下方内联展开的操作面板。
 * 外壳只负责缩进层级、圆角背景与收起按钮，具体控件由各面板自己实现。
 */
function CommandPanelShell({ close, closeLabel, disabled = false, children }: {
  close(): void
  closeLabel: string
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div className="mt-1 rounded-[var(--radius-field)] border border-base-300 bg-base-100 p-2">
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          aria-label={closeLabel}
          onClick={close}
          disabled={disabled}
          className="rounded-[var(--radius-field)] p-0.5 text-base-content/50 transition hover:bg-muted hover:text-base-content disabled:cursor-not-allowed disabled:opacity-40"
        >
          <X size={12} />
        </button>
      </div>
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
  const selectClass = 'h-8 w-full rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary'
  return (
    <CommandPanelShell close={onClose} closeLabel={copy.close} disabled={disabled}>
      <div className="grid gap-2">
        <div className="grid gap-1">
          <Label htmlFor="imagej-debayer-pattern" className="text-xs">{copy.debayer.pattern}</Label>
          <select
            id="imagej-debayer-pattern"
            value={pattern}
            disabled={disabled}
            onChange={(event) => onPattern(event.target.value)}
            className={selectClass}
          >
            <option value="auto">{copy.debayer.patternAuto}</option>
            {['rggb', 'bggr', 'grbg', 'gbrg'].map((value) => (
              <option key={value} value={value}>{value.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="imagej-debayer-algorithm" className="text-xs">{copy.debayer.algorithm}</Label>
          <select
            id="imagej-debayer-algorithm"
            value={algorithm}
            disabled={disabled}
            onChange={(event) => onAlgorithm(event.target.value)}
            className={selectClass}
          >
            <option value="malvar">Malvar-He-Cutler</option>
            <option value="bilinear">Bilinear</option>
          </select>
        </div>
        <Button type="button" size="sm" className="h-8" disabled={disabled} onClick={onApply}>
          {copy.debayer.apply}
        </Button>
      </div>
    </CommandPanelShell>
  )
}