import { Copy, CopyCheck, Download, ScanSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  const variant = 'ghost'
  const size = labeled ? 'default' : 'icon'
  const extraClass = labeled ? 'gap-1.5 font-semibold hover:text-primary' : 'text-base-content/65 hover:text-primary'
  const copyLabel = copyState === 'copied'
    ? t('chartCard.copySuccess')
    : copyState === 'downloaded'
      ? t('chartCard.copyDownloadedFallback')
      : t('chartCard.copyImage')

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={extraClass}
        onClick={onAutorange}
        disabled={disabled}
        aria-label={t('chartCard.autorange')}
        title={t('chartCard.autorange')}
      >
        <ScanSearch size={15} strokeWidth={2.1} />
        {labeled && <span className="hidden sm:inline">{t('chartCard.autorange')}</span>}
      </Button>
      {showCopy && (
        <Button
          type="button"
          variant={variant}
          size={size}
          className={extraClass}
          onClick={onCopyImage}
          disabled={disabled || busy}
          aria-label={t('chartCard.copyImage')}
          title={t('chartCard.copyImage')}
        >
          {copyState === 'idle'
            ? <Copy size={15} strokeWidth={2.1} />
            : <CopyCheck size={15} strokeWidth={2.1} />}
          {labeled && <span className="hidden sm:inline">{copyLabel}</span>}
        </Button>
      )}
      <Button
        type="button"
        variant={variant}
        size={size}
        className={extraClass}
        onClick={onDownloadImage}
        disabled={disabled || busy}
        aria-label={t('chartCard.downloadImage')}
        title={t('chartCard.downloadImage')}
      >
        <Download size={15} strokeWidth={2.1} />
        {labeled && <span className="hidden sm:inline">{t('chartCard.downloadImage')}</span>}
      </Button>
    </>
  )
}
