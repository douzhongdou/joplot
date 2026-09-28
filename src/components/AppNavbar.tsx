'use client'

import Link from 'next/link'
import { Activity, FlaskConical, FunctionSquare, Languages, TableProperties } from 'lucide-react'
import { HelpPopover } from './HelpPopover'
import { SelectMenu } from './SelectMenu'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  SUPPORTED_LANGUAGES,
  getFunctionStudioPath,
  getLanguagePath,
  getSuperPlotPath,
  getSciencePath,
  useI18n,
  type SupportedLanguage,
} from '../i18n'

export type AppSection = 'workbench' | 'function' | 'superplot' | 'science'

interface Props {
  section?: AppSection
  hasDatasets?: boolean
  mobile?: boolean
  viewMode?: 'chart' | 'data'
  onChangeViewMode?: (mode: 'chart' | 'data') => void
}

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

  function sectionLinkClass(active: boolean) {
    return cn(
      buttonVariants({ variant: active ? 'secondary' : 'ghost', size: 'sm' }),
      'shrink-0 font-semibold',
    )
  }

  return (
    <header className="flex min-h-[var(--navbar-height)] items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-3 py-1 sm:gap-3 sm:px-5 sm:py-2">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="h-7 overflow-hidden rounded-lg sm:h-9 sm:rounded-xl">
          <img src="/navbar-icon.webp" alt="joplot" className="block size-full object-contain" />
        </div>

        <nav className="ml-1 flex min-w-0 items-center gap-0.5 overflow-x-auto sm:ml-3" aria-label={t('nav.sectionsLabel')}>
          <Link
            href={getLanguagePath(language)}
            aria-current={section === 'workbench' ? 'page' : undefined}
            className={sectionLinkClass(section === 'workbench')}
          >
            <TableProperties size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t('nav.workbench')}</span>
          </Link>
          <Link
            href={getFunctionStudioPath(language)}
            aria-current={section === 'function' ? 'page' : undefined}
            className={sectionLinkClass(section === 'function')}
          >
            <FunctionSquare size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t('nav.function')}</span>
          </Link>
          <Link
            href={getSuperPlotPath(language)}
            aria-current={section === 'superplot' ? 'page' : undefined}
            className={sectionLinkClass(section === 'superplot')}
          >
            <Activity size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t('nav.superplot')}</span>
          </Link>
          <Link
            href={getSciencePath(language)}
            aria-current={section === 'science' ? 'page' : undefined}
            className={sectionLinkClass(section === 'science')}
          >
            <FlaskConical size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t('nav.science')}</span>
          </Link>
        </nav>

        {showViewToggle ? (
          <div role="group" aria-label={`${t('dataView.chartLabel')} / ${t('dataView.tabLabel')}`} className="ml-1 flex items-center gap-1 border-l border-base-300 pl-2 sm:ml-2 sm:pl-3">
            <button
              type="button"
              aria-pressed={viewMode === 'chart'}
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
              aria-pressed={viewMode === 'data'}
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
            triggerSize="sm"
            buttonClassName="size-8 border-0 bg-transparent px-0 shadow-none hover:bg-transparent focus-visible:ring-0"
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
