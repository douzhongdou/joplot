'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Download, FileUp, Image as ImageIcon, Undo2, X } from 'lucide-react'
import { AppNavbar } from '../../components/AppNavbar'
import { Button } from '@joplot/ui/button'
import { useImageRuntime } from './useImageRuntime'
import { toUiRegistry, type OperatorCapability } from '../engine/operators'
import { getOperator } from '../engine/operators'
import type { RuntimeState } from '../engine/runtime'
import type { ImageBlock } from '../engine/types'
import { blockToRgba, computeWindowLevel } from '../engine/render/rgba'
import { encodeTiff } from '../lib/tiff'
import type { VtkImageView } from '../engine/render/vtk'

const CATEGORY_LABEL: Record<string, string> = {
  format: '格式',
  adjust: '调整',
  threshold: '阈值',
  filter: '滤波',
  morphology: '形态学',
  geometry: '几何',
  analysis: '分析',
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function baseName(state: RuntimeState): string {
  return state.dataset?.source.name.replace(/\.[^.]+$/, '') || 'image'
}

/** 单通道用数据极值做窗宽窗位；多分量（RGB）用 0..255 恒等映射，保持颜色。 */
function applyDisplay(view: VtkImageView, image: ImageBlock): void {
  view.setBlock(image)
  const c = image.axes.indexOf('c')
  const components = c >= 0 ? (image.shape[c] ?? 1) : 1
  view.setWindowLevel(components === 1 ? computeWindowLevel(image) : { window: 255, level: 127.5 })
}

/** 参数面板：本地编辑，点「应用」才提交一次撤销单位。 */
function StepParamsEditor({
  capability,
  params,
  onApply,
}: {
  capability: OperatorCapability
  params: Record<string, number | string>
  onApply: (next: Record<string, number | string>) => void
}) {
  const [draft, setDraft] = useState<Record<string, number | string>>(params)
  useEffect(() => setDraft(params), [params])
  if (capability.params.length === 0) return null
  return (
    <div className="grid gap-2 rounded-md border border-base-300 p-2">
      {capability.params.map((spec) => (
        <label key={spec.key} className="grid gap-1 text-xs">
          <span className="text-base-content/70">{spec.labelKey}</span>
          {spec.type === 'number' ? (
            <input
              type="number"
              className="h-7 rounded border border-base-300 bg-base-100 px-2"
              value={Number(draft[spec.key] ?? spec.default)}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              onChange={(event) => setDraft((current) => ({ ...current, [spec.key]: Number(event.target.value) }))}
            />
          ) : (
            <select
              className="h-7 rounded border border-base-300 bg-base-100 px-2"
              value={String(draft[spec.key] ?? spec.default)}
              onChange={(event) => setDraft((current) => ({ ...current, [spec.key]: event.target.value }))}
            >
              {spec.options.map((option) => (
                <option key={option.value} value={option.value}>{option.labelKey}</option>
              ))}
            </select>
          )}
        </label>
      ))}
      <Button type="button" size="sm" className="h-7" onClick={() => onApply(draft)}>应用</Button>
    </div>
  )
}

export function ScientificImageWorkspace(): ReactNode {
  const { state, runtime } = useImageRuntime()
  const registry = useMemo(() => toUiRegistry(), [])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<VtkImageView | null>(null)
  const imageRef = useRef<ImageBlock | null>(null)
  imageRef.current = state.image
  const [vtkError, setVtkError] = useState<string>()
  const [exportError, setExportError] = useState<string>()
  const [selectedStepId, setSelectedStepId] = useState<string>()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const container = viewportRef.current
    if (!container) return
    let cancelled = false
    void import('../engine/render/vtk')
      .then(({ createVtkImageView }) => createVtkImageView(container, { background: [0.08, 0.08, 0.1] }))
      .then((view) => {
        if (cancelled) {
          view.destroy()
          return
        }
        viewRef.current = view
        const image = imageRef.current
        if (image) applyDisplay(view, image)
      })
      .catch((error: unknown) => setVtkError(error instanceof Error ? error.message : String(error)))
    return () => {
      cancelled = true
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !state.image) return
    applyDisplay(view, state.image)
  }, [state.image])

  const slices = useMemo(() => {
    const dataset = state.dataset
    if (!dataset) return [] as Array<{ axis: 't' | 'c' | 'z'; length: number; index: number }>
    return (['t', 'c', 'z'] as const)
      .filter((axis) => !(axis === 'c' && dataset.componentKind === 'rgb'))
      .map((axis) => ({ axis, length: dataset.shape[dataset.axes.indexOf(axis)] ?? 1, index: state.selection[axis] ?? 0 }))
      .filter((entry) => entry.length > 1)
  }, [state.dataset, state.selection])

  const selectedStep = state.recipe?.steps.find((step) => step.id === selectedStepId)

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) await runtime.openFile(file)
    event.target.value = ''
  }

  const exportPng = () => {
    const image = state.image
    if (!image) return
    const width = image.shape[image.axes.indexOf('x')] ?? 1
    const height = image.shape[image.axes.indexOf('y')] ?? 1
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return
    context.putImageData(new ImageData(blockToRgba(image, computeWindowLevel(image)), width, height), 0, 0)
    canvas.toBlob((blob) => { if (blob) download(blob, `${baseName(state)}.png`) }, 'image/png')
  }

  const exportTiff = async () => {
    const image = state.image
    if (!image || !state.dataset) return
    const c = image.axes.indexOf('c')
    if (c >= 0 && (image.shape[c] ?? 1) > 1) {
      setExportError('彩色图像暂不支持 TIFF 导出，请使用 PNG')
      return
    }
    setExportError(undefined)
    try {
      const { encodeImageBlock } = await import('../engine/compute/itk')
      const bytes = await encodeImageBlock(image, 'image/tiff', state.dataset.spatialTransform)
      download(new Blob([bytes as unknown as BlobPart], { type: 'image/tiff' }), `${baseName(state)}.tiff`)
    } catch (error) {
      if (image.dtype === 'uint8' && image.axes.length === 2) {
        const width = image.shape[image.axes.indexOf('x')] ?? 1
        const height = image.shape[image.axes.indexOf('y')] ?? 1
        const bytes = encodeTiff([{ width, height, data: image.data as Uint8Array }])
        download(new Blob([bytes as unknown as BlobPart], { type: 'image/tiff' }), `${baseName(state)}.tiff`)
      } else {
        setExportError(`TIFF 导出失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const statusText = state.status === 'importing' ? '导入中…'
    : state.status === 'running' ? '计算中…'
      : state.status === 'error' ? `错误：${state.error ?? ''}`
        : state.dataset ? '就绪' : '请导入科学图像（TIFF / PNG）'

  return (
    <div className="flex h-screen min-h-0 flex-col bg-base-100 text-base-content">
      <AppNavbar />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col border-r border-base-300">
          <div className="border-b border-base-300 p-3">
            <input ref={fileInputRef} type="file" accept=".tif,.tiff,.png,image/tiff,image/png" className="hidden" onChange={onFile} />
            <Button type="button" size="sm" className="w-full" onClick={() => fileInputRef.current?.click()}>
              <FileUp size={14} className="mr-1" />导入图像
            </Button>
            <p className="mt-2 text-xs text-base-content/60">{statusText}</p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <section className="mb-4">
              <h2 className="mb-2 text-xs font-semibold uppercase text-base-content/60">步骤</h2>
              {state.recipe && state.recipe.steps.length > 0 ? (
                <ul className="grid gap-1">
                  {state.recipe.steps.map((step, index) => (
                    <li key={step.id}>
                      <div className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${selectedStepId === step.id ? 'border-primary' : 'border-base-300'}`}>
                        <button type="button" className="flex-1 text-left" onClick={() => setSelectedStepId(step.id)}>{index + 1}. {step.op}</button>
                        <button type="button" className="opacity-60 hover:opacity-100" onClick={() => runtime.viewStep(step.id)} title="查看此步">看</button>
                        <button type="button" onClick={() => runtime.removeStep(step.id)} title="删除"><X size={12} /></button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-base-content/50">尚未添加步骤，源图直接显示。</p>
              )}
              {selectedStep && (
                <div className="mt-2">
                  <StepParamsEditor
                    capability={getOperator(selectedStep.op)!}
                    params={selectedStep.params}
                    onApply={(next) => runtime.updateParams(selectedStep.id, next)}
                  />
                </div>
              )}
            </section>

            {registry.categories.map((category) => (
              <section key={category} className="mb-3">
                <h3 className="mb-1 text-xs font-semibold text-base-content/60">{CATEGORY_LABEL[category] ?? category}</h3>
                <div className="flex flex-wrap gap-1">
                  {registry.operators.filter((operator) => operator.category === category).map((operator) => (
                    <Button key={operator.kind} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs"
                      disabled={!state.dataset}
                      onClick={() => runtime.addStep(operator.kind)}>
                      {operator.labelKey}
                    </Button>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="grid gap-1 border-t border-base-300 p-3">
            <div className="grid grid-cols-2 gap-1">
              <Button type="button" size="sm" variant="outline" className="h-7" disabled={!runtime.canUndo()} onClick={() => runtime.undo()}>
                <Undo2 size={13} className="mr-1" />撤销
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-7" disabled={!state.dataset} onClick={() => runtime.viewStep(undefined)}>查看结果</Button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <Button type="button" size="sm" variant="outline" className="h-7" disabled={!state.image} onClick={exportPng}>
                <Download size={13} className="mr-1" />PNG
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-7" disabled={!state.image} onClick={() => void exportTiff()}>TIFF</Button>
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col">
          {slices.length > 0 && (
            <div className="flex items-center gap-3 border-b border-base-300 px-3 py-1.5 text-xs">
              {slices.map((slice) => (
                <div key={slice.axis} className="flex items-center gap-1">
                  <span className="uppercase text-base-content/60">{slice.axis}</span>
                  <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => runtime.stepSelection(slice.axis, -1)}><ChevronLeft size={13} /></Button>
                  <span>{slice.index + 1}/{slice.length}</span>
                  <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => runtime.stepSelection(slice.axis, 1)}><ChevronRight size={13} /></Button>
                </div>
              ))}
            </div>
          )}

          <div className="relative min-h-0 flex-1 bg-black">
            <div ref={viewportRef} className="absolute inset-0" />
            {!state.dataset && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-base-content/50">
                <ImageIcon size={40} />
                <p className="text-sm">导入 TIFF 或 PNG 以开始</p>
              </div>
            )}
            {vtkError && <p className="absolute bottom-2 left-2 text-xs text-error">VTK 初始化失败：{vtkError}</p>}
          </div>

          <footer className="max-h-48 overflow-y-auto border-t border-base-300 p-3 text-xs">
            {state.error && <p className="text-error">{state.error}</p>}
            {exportError && <p className="text-error">{exportError}</p>}
            {state.warnings.map((warning) => <p key={warning} className="text-warning">{warning}</p>)}
            <div className="flex flex-wrap gap-4">
              <span>引擎：{mounted ? state.engine : '…'}</span>
              <span>耗时：{state.lastRunMs ?? 0} ms</span>
              <span>估算峰值：{(state.estimatedBytes / (1024 * 1024)).toFixed(1)} MiB</span>
              <span>缓存：{state.cache.entries} 项 / {(state.cache.bytes / (1024 * 1024)).toFixed(1)} MiB（命中 {state.cache.hits} / 未命中 {state.cache.misses}）</span>
            </div>
            {state.stats && state.stats.map((stats) => (
              <p key={stats.channel}>
                {stats.channel}：像素 {stats.count.toLocaleString()}，均值 {stats.mean.toFixed(2)}，min {stats.min}，max {stats.max}，标准差 {stats.stdDev.toFixed(2)}
              </p>
            ))}
            {state.results.some((result) => result.status === 'error') && (
              <div>
                {state.results.filter((result) => result.status === 'error').map((result) => (
                  <p key={result.stepId} className="text-error">步骤 {result.stepId} 失败：{result.error}</p>
                ))}
              </div>
            )}
          </footer>
        </main>
      </div>
    </div>
  )
}
