import { ArrowRight, Sparkles } from 'lucide-react'
import { FileUploader } from './FileUploader'
import { getUploadCopy } from '../lib/upload'
import { getSampleDatasetCopy, type SampleDatasetId } from '../lib/sampleData'
import { useI18n } from '../i18n'

interface Props {
  busy?: boolean
  onFiles: (files: File[]) => void | Promise<void>
  onLoadSample: (id: SampleDatasetId) => void | Promise<void>
}

export function HomeHero({ busy = false, onFiles, onLoadSample }: Props) {
  const { language, t, formatNumber } = useI18n()
  const copy = getUploadCopy(language)
  const samples = getSampleDatasetCopy(language)
  const previewCopy = {
    'zh-CN': {
      label: '即时预览',
      title: '上传，自动出图，直接分享',
      badge: '默认白底 PNG',
      highlights: [
        ['几秒出图', '根据首个可用字段自动生成图表。'],
        ['直接复制', '贴到幻灯片、聊天工具和文档里就能用。'],
        ['零配置', '不用注册，也不用先搭后端。'],
      ],
    },
    en: {
      label: 'Instant Preview',
      title: 'Upload. Auto-chart. Share.',
      badge: 'White PNG by default',
      highlights: [
        ['Chart in seconds', 'Auto chart from the first useful columns.'],
        ['Copy to docs', 'Paste straight into slides, chat, and docs.'],
        ['Zero setup', 'No signup, no backend, no waiting around.'],
      ],
    },
    'ja-JP': {
      label: 'すぐ試せるプレビュー',
      title: 'アップロードして、自動で出図、そのまま共有',
      badge: '白背景 PNG が標準',
      highlights: [
        ['すぐにグラフ化', '最初に使える列から自動でグラフを作成。'],
        ['そのまま貼れる', 'スライドやチャット、ドキュメントにすぐ貼れる。'],
        ['設定いらず', '登録もバックエンド準備も不要。'],
      ],
    },
  }[language]

  return (
    <section className="mx-auto grid min-h-full w-full max-w-7xl gap-10 px-6 py-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] lg:items-center lg:px-10 lg:py-14">
      <div className="grid gap-8">
        <div className="inline-flex h-9 w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-4 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          <Sparkles size={14} strokeWidth={2.2} />
          joplot
        </div>

        <div className="grid max-w-3xl gap-4">
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight text-base-content sm:text-6xl">
            {copy.heroTitle}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-base-content/65 sm:text-lg">
            {copy.heroSubtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <FileUploader
            hasDatasets={false}
            onFiles={onFiles}
            disabled={busy}
            buttonClassName="h-12 rounded-2xl border-0 bg-primary px-6 text-primary-content hover:bg-primary/90 hover:text-primary-content"
          />
          <button
            type="button"
            className="inline-flex h-12 items-center gap-2 rounded-2xl border border-base-300 bg-base-100 px-5 text-sm font-semibold text-base-content transition hover:border-primary/25 hover:bg-primary/8 hover:text-primary disabled:pointer-events-none disabled:text-base-content/45"
            onClick={() => void onLoadSample(samples[0].id)}
            disabled={busy}
          >
            {copy.sampleButton}
            <ArrowRight size={15} strokeWidth={2.1} />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {copy.proofPoints.map((item) => (
            <span
              key={item}
              className="inline-flex h-9 items-center rounded-full border border-base-300 bg-base-100 px-4 text-sm text-base-content/72"
            >
              {item}
            </span>
          ))}
        </div>

        <div className="grid gap-4 rounded-[calc(var(--radius-box)+0.5rem)] border border-base-300 bg-base-100 p-5 sm:p-6">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold text-base-content">{copy.sampleTitle}</h2>
            <p className="text-sm leading-6 text-base-content/60">{copy.sampleDescription}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {samples.map((sample) => (
              <button
                key={sample.id}
                type="button"
                className="grid gap-1 rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-4 py-4 text-left transition hover:border-primary/30 hover:bg-primary/6"
                onClick={() => void onLoadSample(sample.id)}
                disabled={busy}
              >
                <span className="text-sm font-semibold text-base-content">{sample.label}</span>
                <span className="text-sm leading-6 text-base-content/58">{sample.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[2rem] border border-base-300 bg-base-100 p-6 shadow-[0_24px_80px_rgba(17,24,39,0.08)]">
        <div className="absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top,rgba(21,94,239,0.16),transparent_72%)]" />
        <div className="relative grid gap-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">{previewCopy.label}</div>
              <div className="mt-2 text-2xl font-semibold text-base-content">{previewCopy.title}</div>
            </div>
            <div className="rounded-full border border-base-300 bg-base-100 px-3 py-1 text-xs font-medium text-base-content/60">
              {previewCopy.badge}
            </div>
          </div>

          <div className="grid gap-3">
            <div className="flex items-center justify-between rounded-[var(--radius-box)] bg-base-200/70 px-4 py-3 text-sm text-base-content/72">
              <span>{samples[0].fileName}</span>
              <span>{t('common.rowCount', { count: formatNumber(6) })}</span>
            </div>
            <div className="overflow-hidden rounded-[calc(var(--radius-box)+0.25rem)] border border-base-300 bg-white p-4">
              <svg viewBox="0 0 380 220" className="block h-auto w-full">
                <defs>
                  <linearGradient id="heroChartFill" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#155eef" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#155eef" stopOpacity="0" />
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
                  stroke="#155eef"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {[24, 82, 140, 198, 256, 314, 356].map((x, index) => {
                  const points = [162, 150, 126, 134, 92, 58, 38]
                  return (
                    <circle key={x} cx={x} cy={points[index]} r="5" fill="#155eef" />
                  )
                })}
              </svg>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {previewCopy.highlights.map(([title, body]) => (
              <div key={title} className="grid gap-2 border-t border-base-300 pt-3">
                <div className="text-sm font-semibold text-base-content">{title}</div>
                <div className="text-sm leading-6 text-base-content/58">{body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
