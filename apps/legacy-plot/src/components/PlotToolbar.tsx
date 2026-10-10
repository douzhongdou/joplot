import { Copy, CopyCheck, Download, ScanSearch } from 'lucide-react'
import { useI18n } from '../i18n'

export type PlotCopyState = 'idle' | 'copied' | 'downloaded'

interface Props {
  busy?: boolean
  copyState?: PlotCopyState
  disabled?: boolean
  labeled?: boolean
  showCopy?: boolean
  onAutorange: () => void
  onCopyImage: () => void
  onDownloadImage: () => void
}

const iconButtonClass = 'inline-grid size-9 place-items-center rounded-[var(--radius-box)] border-0 bg-transparent text-base-content/65 transition hover:bg-transparent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50'
const labeledButtonClass = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-box)] border border-base-300 bg-base-100 px-3 text-sm font-semibold text-base-content transition hover:border-primary/35 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:pointer-events-none disabled:opacity-50'

export function PlotToolbar({
  busy = false,
  copyState = 'idle',
  disabled = false,
  labeled = false,
  showCopy = true,
  onAutorange,
  onCopyImage,
  onDownloadImage,
}: Props) {
  const { t } = useI18n()
  const buttonClass = labeled ? labeledButtonClass : iconButtonClass
  const copyLabel = copyState === 'copied'
    ? t('chartCard.copySuccess')
    : copyState === 'downloaded'
      ? t('chartCard.copyDownloadedFallback')
      : t('chartCard.copyImage')

  return (
    <>
      <button
        type="button"
        className={buttonClass}
        onClick={onAutorange}
        disabled={disabled}
        aria-label={t('chartCard.autorange')}
        title={t('chartCard.autorange')}
      >
        <ScanSearch size={15} strokeWidth={2.1} />
        {labeled && <span className="hidden sm:inline">{t('chartCard.autorange')}</span>}
      </button>
      {showCopy && (
        <button
          type="button"
          className={buttonClass}
          onClick={onCopyImage}
          disabled={disabled || busy}
          aria-label={t('chartCard.copyImage')}
          title={t('chartCard.copyImage')}
        >
          {copyState === 'idle'
            ? <Copy size={15} strokeWidth={2.1} />
            : <CopyCheck size={15} strokeWidth={2.1} />}
          {labeled && <span className="hidden sm:inline">{copyLabel}</span>}
        </button>
      )}
      <button
        type="button"
        className={buttonClass}
        onClick={onDownloadImage}
        disabled={disabled || busy}
        aria-label={t('chartCard.downloadImage')}
        title={t('chartCard.downloadImage')}
      >
        <Download size={15} strokeWidth={2.1} />
        {labeled && <span className="hidden sm:inline">{t('chartCard.downloadImage')}</span>}
      </button>
    </>
  )
}
