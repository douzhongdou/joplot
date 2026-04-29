import { Languages } from 'lucide-react'
import { HelpPopover } from './HelpPopover'
import { SelectMenu } from './SelectMenu'
import { SUPPORTED_LANGUAGES, useI18n, type SupportedLanguage } from '../i18n'

interface Props {
  hasDatasets: boolean
  mobile?: boolean
  viewMode: 'chart' | 'data'
  onChangeViewMode: (mode: 'chart' | 'data') => void
}

export function AppNavbar({ hasDatasets, mobile = false, viewMode, onChangeViewMode }: Props) {
  const { language, setLanguage, t } = useI18n()

  const languageOptions = SUPPORTED_LANGUAGES.map((option) => ({
    value: option,
    label: t(`language.options.${option}`),
  }))

  return (
    <header className="flex min-h-[var(--navbar-height)] items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-3 py-1 sm:gap-3 sm:px-5 sm:py-2">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="h-7 overflow-hidden rounded-lg sm:h-9 sm:rounded-xl">
          <img src="/navbar-icon.webp" alt="" className="block size-full object-contain" />
        </div>

        {hasDatasets && !mobile ? (
          <div className="ml-2 flex items-center gap-1 sm:ml-4">
            <button
              type="button"
              className={`inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold transition sm:px-4 ${
                viewMode === 'chart'
                  ? 'bg-primary text-primary-content'
                  : 'text-base-content/60 hover:text-base-content'
              }`}
              onClick={() => onChangeViewMode('chart')}
            >
              {t('dataView.chartLabel')}
            </button>
            <button
              type="button"
              className={`inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold transition sm:px-4 ${
                viewMode === 'data'
                  ? 'bg-primary text-primary-content'
                  : 'text-base-content/60 hover:text-base-content'
              }`}
              onClick={() => onChangeViewMode('data')}
            >
              {t('dataView.tabLabel')}
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <div className="min-w-0">
          <SelectMenu<SupportedLanguage>
          value={language}
          options={languageOptions}
          onChange={setLanguage}
          placeholder={t('language.label')}
          triggerAriaLabel={t('language.label')}
          align="right"
          buttonClassName="h-8 w-8 justify-center rounded-lg border-0 bg-transparent px-0 shadow-none hover:bg-transparent focus-visible:ring-0 sm:h-9 sm:w-9 sm:rounded-xl"
          menuClassName="min-w-[9rem]"
          renderTrigger={(_, open) => (
            <Languages
              size={mobile ? 16 : 17}
              strokeWidth={2.1}
              className={`shrink-0 transition ${open ? 'text-primary' : 'text-base-content/72'}`}
              aria-hidden="true"
            />
          )}
        />
        </div>
        <HelpPopover />
      </div>
    </header>
  )
}
