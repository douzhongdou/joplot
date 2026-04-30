import { ArrowRight } from 'lucide-react'
import { getUploadCopy } from '../lib/upload'
import { getSampleDatasetCopy, type SampleDatasetId } from '../lib/sampleData'
import { useI18n } from '../i18n'
import type { TrackingInputMethod } from '../lib/analytics'
import { FileUploader } from './FileUploader'

interface Props {
  busy?: boolean
  onLoadSample: (id: SampleDatasetId) => void | Promise<void>
  onUploadFiles: (files: File[], inputMethod?: TrackingInputMethod) => void | Promise<unknown>
}

export function HomeHero({ busy = false, onLoadSample, onUploadFiles }: Props) {
  const { language } = useI18n()
  const copy = getUploadCopy(language)
  const sample = getSampleDatasetCopy(language)[0]

  return (
    <section className="mx-auto grid min-h-full w-full max-w-7xl gap-8 px-6 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)] lg:items-center lg:px-10 lg:py-12">
      <div className="grid max-w-2xl gap-5">
        <h1 className="text-5xl font-semibold leading-[1.02] tracking-tight text-base-content sm:text-5xl">
          {copy.heroTitle}
        </h1>

        <p className="max-w-xl text-base leading-7 text-base-content/62 sm:text-lg">
          {copy.heroSubtitle}
        </p>

        <div className="grid w-full gap-3 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <FileUploader
            hasDatasets={false}
            onFiles={onUploadFiles}
            disabled={busy}
            containerClassName="w-full sm:w-auto"
            buttonClassName="h-12 w-full rounded-2xl border border-primary/15 bg-primary px-5 text-sm font-semibold text-primary-content shadow-none hover:border-primary hover:bg-primary sm:w-auto"
          />

          <button
            type="button"
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-base-300 bg-base-100 px-5 text-sm font-semibold text-base-content transition hover:border-primary/25 hover:bg-primary/8 hover:text-primary disabled:pointer-events-none disabled:text-base-content/45 sm:w-auto"
            onClick={() => void onLoadSample(sample.id)}
            disabled={busy}
          >
            {copy.sampleButton}
            <ArrowRight size={15} strokeWidth={2.1} />
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[2rem] border border-base-300 bg-base-100 p-5 shadow-[0_24px_80px_rgba(17,24,39,0.08)]">
        <div className="overflow-hidden rounded-[calc(var(--radius-box)+0.25rem)]">
          <svg viewBox="0 0 380 220" className="block h-auto w-full">
            <defs>
              <linearGradient id="heroChartFill" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#fa9ccc" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#eb50a0ff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g stroke="#e5e7eb" strokeWidth="1">
              <line x1="24" y1="24" x2="24" y2="188" />
              <line x1="24" y1="188" x2="356" y2="188" />
              <line x1="24" y1="56" x2="356" y2="56" />
              <line x1="24" y1="104" x2="356" y2="104" />
              <line x1="24" y1="152" x2="356" y2="152" />
            </g>
            <path
              d="M24 162 L82 150 L140 126 L198 134 L256 92 L314 58 L356 38 L356 188 L24 188 Z"
              fill="url(#heroChartFill)"
            />
            <path
              d="M24 162 L82 150 L140 126 L198 134 L256 92 L314 58 L356 38"
              fill="none"
              stroke="#eb50a0ff"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {[24, 82, 140, 198, 256, 314, 356].map((x, index) => {
              const points = [162, 150, 126, 134, 92, 58, 38]
              return (
                <circle key={x} cx={x} cy={points[index]} r="5" fill="#e7278aff" />
              )
            })}
          </svg>
        </div>
      </div>
    </section>
  )
}
