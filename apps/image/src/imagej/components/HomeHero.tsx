import { ImagePlus } from 'lucide-react'
import { Button } from '@joplot/ui/button'
import type { ImagejCopy } from '../lib/i18n'

interface Props {
  copy: Pick<ImagejCopy, 'title' | 'subtitle' | 'emptyDescription' | 'openImage' | 'dropHint' | 'localNote'>
  onOpenFile: () => void
}

/**
 * 无图像时的首屏引导。
 *
 * 与 apps/plot 的 HomeHero 同一模式：工作台骨架（工具栏、命令目录、分析栏）一律不渲染，
 * 整屏只讲清楚「这是什么、从哪开始、数据去哪了」；导入之后才切进三栏工作台。
 * 拖放不在这里处理——它挂在外层容器上，所以这一屏同样可以直接把图片拖进来。
 */
export function HomeHero({ copy, onOpenFile }: Props) {
  return (
    <section className="mx-auto grid min-h-0 w-full max-w-7xl gap-8 overflow-y-auto px-6 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)] lg:items-center lg:px-10 lg:py-12">
      <div className="grid max-w-2xl gap-5">
        <div className="grid gap-2">
          <h1 className="text-3xl font-semibold leading-[1.1] tracking-tight text-base-content sm:text-4xl">
            {copy.title}
          </h1>
          <p className="text-sm font-medium text-base-content/60">{copy.subtitle}</p>
        </div>
        <p className="max-w-xl text-sm leading-relaxed text-base-content/70 sm:text-base">
          {copy.emptyDescription}
        </p>

        <div className="grid w-full gap-3 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <Button
            type="button"
            onClick={onOpenFile}
            className="h-12 w-full gap-2 rounded-2xl px-5 text-sm font-semibold sm:w-auto"
          >
            <ImagePlus size={16} strokeWidth={2.2} aria-hidden="true" />
            {copy.openImage}
          </Button>
          <p className="text-xs text-base-content/55 sm:self-center">{copy.dropHint}</p>
        </div>

        <p className="text-xs text-base-content/45">{copy.localNote}</p>
      </div>

      <div className="overflow-hidden rounded-[2rem] bg-base-100 p-5 shadow-[0_24px_80px_rgba(17,24,39,0.08)]">
        {/* 示意图：左侧是带 ROI 的图像，右侧是它的直方图——一眼说明这个工作台在做什么。 */}
        <svg viewBox="0 0 380 220" className="block h-auto w-full" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="heroImageFill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style={{ stopColor: 'var(--color-primary)' }} stopOpacity="0.8" />
              <stop offset="100%" style={{ stopColor: 'var(--color-primary)' }} stopOpacity="0.12" />
            </linearGradient>
          </defs>

          <rect x="24" y="26" width="158" height="158" rx="10" fill="url(#heroImageFill)" />
          <g strokeWidth="1" style={{ stroke: 'var(--color-base-100)' }} strokeOpacity="0.35">
            <line x1="24" y1="78" x2="182" y2="78" />
            <line x1="24" y1="130" x2="182" y2="130" />
            <line x1="76" y1="26" x2="76" y2="184" />
            <line x1="129" y1="26" x2="129" y2="184" />
          </g>
          <rect
            x="66"
            y="66"
            width="68"
            height="68"
            rx="3"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            style={{ stroke: 'var(--chart-axis)' }}
          />

          <g style={{ fill: 'var(--color-primary)' }}>
            <rect x="238" y="150" width="14" height="28" rx="2" opacity="0.45" />
            <rect x="258" y="122" width="14" height="56" rx="2" opacity="0.6" />
            <rect x="278" y="86" width="14" height="92" rx="2" opacity="0.8" />
            <rect x="298" y="110" width="14" height="68" rx="2" opacity="0.65" />
            <rect x="318" y="142" width="14" height="36" rx="2" opacity="0.5" />
          </g>
          <g strokeWidth="1" style={{ stroke: 'var(--chart-axis)' }}>
            <line x1="222" y1="178" x2="356" y2="178" />
            <line x1="222" y1="70" x2="222" y2="178" />
          </g>
          <g strokeWidth="1" strokeDasharray="4 3" style={{ stroke: 'var(--chart-grid)' }}>
            <line x1="222" y1="94" x2="356" y2="94" />
          </g>
        </svg>
      </div>
    </section>
  )
}
