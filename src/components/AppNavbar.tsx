import Link from 'next/link'
import { FunctionSquare, Languages, TableProperties } from 'lucide-react'
import { HelpPopover } from './HelpPopover'
import { SelectMenu } from './SelectMenu'
import {
  SUPPORTED_LANGUAGES,
  getFunctionStudioPath,
  getLanguagePath,
  useI18n,
  type SupportedLanguage,
} from '../i18n'

export type AppSection = 'workbench' | 'function'

interface Props {
  section?: AppSection
  hasDatasets?: boolean
  mobile?: boolean
  viewMode?: 'chart' | 'data'
  onChangeViewMode?: (mode: 'chart' | 'data') => void
}

const sectionLinkClass = 'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition sm:h-9 sm:px-3'
const activeSectionClass = 'bg-primary/10 text-primary'
const idleSectionClass = 'text-base-content/60 hover:text-base-content'

export function AppNavbar({
  section = 'workbench',
  hasDatasets = false,
  mobile = false,
  viewMode = 'chart',
  onChangeViewMode,
}: Props) {
  const { language, setLanguage, t } = useI18n()

  const languageOptions = SUPPORTED_LANGUAGES.map((option) => ({
    value: option,
    label: t(`language.options.${option}`),
  }))

  const showViewToggle = section === 'workbench' && hasDatasets && !mobile && onChangeViewMode

  return (
    <header className="flex min-h-[var(--navbar-height)] items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-3 py-1 sm:gap-3 sm:px-5 sm:py-2">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="h-7 overflow-hidden rounded-lg sm:h-9 sm:rounded-xl">
          <img src="/navbar-icon.webp" alt="joplot" className="block size-full object-contain" />
        </div>

        <nav className="ml-1 flex items-center gap-0.5 sm:ml-3" aria-label={t('nav.sectionsLabel')}>
          <Link
            href={getLanguagePath(language)}
            aria-current={section === 'workbench' ? 'page' : undefined}
            className={`${sectionLinkClass} ${section === 'workbench' ? activeSectionClass : idleSectionClass}`}
          >
            <TableProperties size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t('nav.workbench')}</span>
          </Link>
          <Link
            href={getFunctionStudioPath(language)}
            aria-current={section === 'function' ? 'page' : undefined}
            className={`${sectionLinkClass} ${section === 'function' ? activeSectionClass : idleSectionClass}`}
          >
            <FunctionSquare size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t('nav.function')}</span>
          </Link>
        </nav>

        {showViewToggle ? (
          <div className="ml-1 flex items-center gap-1 border-l border-base-300 pl-2 sm:ml-2 sm:pl-3">
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
          buttonClassName="h-8 w-8 justify-center rounded-lg border-0 bg-transparent px-0 shadow-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-primary/20 sm:h-9 sm:w-9 sm:rounded-xl"
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
