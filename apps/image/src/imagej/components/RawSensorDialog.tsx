'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@joplot/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@joplot/ui/dialog'
import { Input } from '@joplot/ui/input'
import { Label } from '@joplot/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@joplot/ui/select'
import type { ImagejCopy } from '../lib/i18n'
import type { CfaPatternName } from '../engine/debayer.ts'
import {
  guessSensorGeometry,
  inferFrames,
  inferHeight,
  normalizeSensorOptions,
  requiredByteLength,
  RAW_SENSOR_TYPES,
  type RawSensorOptions,
  type RawSensorType,
  type SensorGuess,
} from '../engine/raw/sensor.ts'

/** 待解析的裸数据文件；由工作台在探测出「无头」后弹出。 */
export interface RawSensorPrompt {
  file: File
  /** 参数将应用到同批次的多少个文件；> 1 表示这是「拖文件夹 → 一个 Stack」。 */
  count?: number
}

interface Draft {
  width: string
  height: string
  type: RawSensorType
  offset: string
  stride: string
  frames: string
  pattern: CfaPatternName | 'none'
}

const EMPTY_DRAFT: Draft = {
  width: '',
  height: '',
  type: 'uint16-le',
  offset: '0',
  stride: '0',
  frames: '1',
  pattern: 'rggb',
}

/** 类型名用传感器行话：RAW8 / RAW10 / RAW12 / RAW16，而不是 uint16 这类容器名。 */
function typeLabel(type: RawSensorType, copy: ImagejCopy['rawSensor']): string {
  switch (type) {
    case 'uint8': return 'RAW8 · 8 bit'
    case 'raw10': return `RAW10 · ${copy.packed10}`
    case 'raw12': return `RAW12 · ${copy.packed12}`
    case 'uint16-le': return `RAW16 · ${copy.endianLittle}`
    case 'uint16-be': return `RAW16 · ${copy.endianBig}`
    case 'int16-le': return `RAW16 signed · ${copy.endianLittle}`
    case 'int16-be': return `RAW16 signed · ${copy.endianBig}`
    case 'float32-le': return `float32 · ${copy.endianLittle}`
    case 'float32-be': return `float32 · ${copy.endianBig}`
  }
}

function sourceLabel(source: SensorGuess['source'], copy: ImagejCopy['rawSensor']): string {
  switch (source) {
    case 'filename': return copy.guessFromName
    case 'table': return copy.guessFromTable
    case 'aspect': return copy.guessApprox
    case 'size': return copy.guessFromSize
  }
}

function guessKey(guess: SensorGuess): string {
  return `${guess.width}x${guess.height}:${guess.type}`
}

const PATTERNS: readonly CfaPatternName[] = ['rggb', 'bggr', 'grbg', 'gbrg']

const fieldClass = 'h-8 px-2 text-xs md:text-xs'

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** 空串按缺省值处理：输入框允许被清空重填，不能因为中途为空就把参数算成 NaN。 */
function numberOr(text: string, fallback: number): number {
  const trimmed = text.trim()
  if (trimmed === '') return fallback
  return Number(trimmed)
}

/**
 * 「导入传感器裸数据」对话框。
 *
 * 无头 RAW 连宽高都没有，所以打开时先用 `guessSensorGeometry` 猜一遍并直接填好：
 * 文件名里的 `4056x3040`、文件大小的精确整除、常见传感器尺寸表都命中过才会填，
 * 猜不出就留空让用户自己写。候选放在下拉里随时可切换，各个字段也始终可手改。
 *
 * 参数校验直接复用解码器的 `normalizeSensorOptions`，保证「对话框说能导入」与
 * 「解码器能解」是同一套判断；也避免把一位之差的宽高真的分配出去（拖死浏览器的最短路径）。
 */
export function RawSensorDialog({ prompt, copy, onConfirm, onCancel }: {
  prompt: RawSensorPrompt | null
  copy: ImagejCopy['rawSensor']
  onConfirm(options: RawSensorOptions): void
  onCancel(): void
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [guesses, setGuesses] = useState<readonly SensorGuess[]>([])
  const [source, setSource] = useState<SensorGuess['source'] | null>(null)
  const file = prompt?.file ?? null

  /* 每次打开重新推测并填好：上一个文件的宽高留在这里只会造成误导入。 */
  useEffect(() => {
    if (!prompt) return
    const found = guessSensorGeometry(prompt.file.size, prompt.file.name)
    setGuesses(found)
    const best = found[0]
    setSource(best?.source ?? null)
    setDraft(best
      ? { ...EMPTY_DRAFT, width: String(best.width), height: String(best.height), type: best.type }
      : EMPTY_DRAFT)
  }, [prompt])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))

  /** 当前手填值正好等于某条候选时，下拉回显它；否则留空表示「自定义」。 */
  const activeKey = useMemo(() => {
    const matched = guesses.find((guess) =>
      String(guess.width) === draft.width.trim() && String(guess.height) === draft.height.trim() && guess.type === draft.type)
    return matched ? guessKey(matched) : ''
  }, [guesses, draft.width, draft.height, draft.type])

  const applyGuess = (key: string) => {
    const guess = guesses.find((entry) => guessKey(entry) === key)
    if (!guess) return
    setDraft((current) => ({ ...current, width: String(guess.width), height: String(guess.height), type: guess.type }))
    setSource(guess.source)
  }

  const parsed = useMemo(() => {
    const candidate: RawSensorOptions = {
      width: numberOr(draft.width, 0),
      height: numberOr(draft.height, 0),
      type: draft.type,
      offset: numberOr(draft.offset, 0),
      stride: numberOr(draft.stride, 0),
      frames: numberOr(draft.frames, 1),
      pattern: draft.pattern,
    }
    const size = file?.size ?? 0
    let options: RawSensorOptions | undefined
    let error: string | undefined
    try {
      options = normalizeSensorOptions(candidate, size)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    const needed = requiredByteLength(candidate)
    return { options, error, needed: Number.isFinite(needed) ? needed : undefined, size }
  }, [draft, file])

  const fits = parsed.options !== undefined
  /** 参数要的字节比文件还多：这是最常见的手误，单独给本地化提示而不是引擎原话。 */
  const overflows = parsed.needed !== undefined && parsed.needed > parsed.size
  const maxFrames = useMemo(() => {
    if (!file || !parsed.options) return 1
    return inferFrames(file.size, parsed.options.width, parsed.options.height, parsed.options.type, parsed.options.offset, parsed.options.stride)
  }, [file, parsed.options])

  const canInferHeight = file !== null && inferHeight(file.size, numberOr(draft.width, 0), draft.type, numberOr(draft.offset, 0), numberOr(draft.frames, 1)) !== undefined

  const fillHeight = () => {
    if (!file) return
    const height = inferHeight(file.size, numberOr(draft.width, 0), draft.type, numberOr(draft.offset, 0), numberOr(draft.frames, 1))
    if (height !== undefined) set('height', String(height))
  }

  const status = fits
    ? copy.match.replace('{needed}', String(parsed.needed)).replace('{size}', String(parsed.size))
    : overflows
      ? copy.mismatch.replace('{needed}', String(parsed.needed)).replace('{size}', String(parsed.size))
      : parsed.error ?? ''

  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.hint}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <p className="truncate text-xs text-base-content/70" title={file?.name}>
            {file?.name} · {copy.sizeLabel} {file ? formatBytes(file.size) : '—'}
          </p>

          {prompt && (prompt.count ?? 1) > 1 ? (
            <p className="text-xs text-base-content/70">{copy.applyToAll.replace('{n}', String(prompt.count))}</p>
          ) : null}

          {guesses.length > 0 ? (
            <div className="grid gap-1.5 rounded-[var(--radius-field)] border border-base-300 bg-base-200/40 p-2">
              <div className="flex items-center gap-2">
                <Label className="shrink-0 text-xs">{copy.guessLabel}</Label>
                <Select value={activeKey} onValueChange={applyGuess}>
                  <SelectTrigger className={`${fieldClass} flex-1`}><SelectValue placeholder={copy.guessPick} /></SelectTrigger>
                  <SelectContent>
                    {guesses.map((guess) => (
                      <SelectItem key={guessKey(guess)} value={guessKey(guess)}>
                        {`${guess.width} × ${guess.height} · ${typeLabel(guess.type, copy)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-base-content/60">{source ? sourceLabel(source, copy) : ''}</p>
            </div>
          ) : (
            <p className="text-xs text-base-content/45">{copy.guessNone}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="raw-width" className="text-xs">{copy.width}</Label>
              <Input id="raw-width" type="number" min={1} className={fieldClass} value={draft.width} onChange={(event) => set('width', event.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="raw-height" className="text-xs">{copy.height}</Label>
              <Input id="raw-height" type="number" min={1} className={fieldClass} value={draft.height} onChange={(event) => set('height', event.target.value)} />
            </div>
          </div>

          <div className="grid gap-1">
            <Label className="text-xs">{copy.type}</Label>
            <Select value={draft.type} onValueChange={(value) => set('type', value as RawSensorType)}>
              <SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger>
              <SelectContent>
                {RAW_SENSOR_TYPES.map((type) => <SelectItem key={type} value={type}>{typeLabel(type, copy)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="raw-offset" className="text-xs">{copy.offset}</Label>
              <Input id="raw-offset" type="number" min={0} className={fieldClass} value={draft.offset} onChange={(event) => set('offset', event.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="raw-stride" className="text-xs">{copy.stride}</Label>
              <Input id="raw-stride" type="number" min={0} placeholder={copy.strideAuto} className={fieldClass} value={draft.stride} onChange={(event) => set('stride', event.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="raw-frames" className="text-xs">{copy.frames}</Label>
              <Input id="raw-frames" type="number" min={1} className={fieldClass} value={draft.frames} onChange={(event) => set('frames', event.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">{copy.pattern}</Label>
              <Select value={draft.pattern} onValueChange={(value) => set('pattern', value as CfaPatternName | 'none')}>
                <SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PATTERNS.map((pattern) => <SelectItem key={pattern} value={pattern}>{pattern.toUpperCase()}</SelectItem>)}
                  <SelectItem value="none">{copy.patternNone}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1">
            <p className={`text-xs ${parsed.options ? (fits ? 'text-base-content/60' : 'text-warning') : 'text-base-content/45'}`}>{status}</p>
            {maxFrames > 1 ? <p className="text-xs text-base-content/60">{copy.framesHint.replace('{n}', String(maxFrames))}</p> : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" disabled={!canInferHeight} onClick={fillHeight}>{copy.inferHeight}</Button>
          <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={onCancel}>{copy.cancel}</Button>
          <Button type="button" size="sm" disabled={!parsed.options} onClick={() => { if (parsed.options) onConfirm(parsed.options) }}>{copy.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
