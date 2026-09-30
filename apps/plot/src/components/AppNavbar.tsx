'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Activity, ChevronDown, CircleHelp, FlaskConical, FunctionSquare, Image as ImageIcon, Languages, TableProperties } from 'lucide-react'
import { HelpContent, HelpPopover } from './HelpPopover'
import { SelectMenu } from './SelectMenu'
import { Button, buttonVariants } from '@joplot/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@joplot/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  SUPPORTED_LANGUAGES,
  getFunctionStudioPath,
  getImagejPath,
  getLanguagePath,
  getSuperPlotPath,
  getSciencePath,
  useI18n,
  type SupportedLanguage,
} from '../i18n'

export type AppSection = 'workbench' | 'function' | 'superplot' | 'science' | 'imagej'

interface Props {
  section?: AppSection
  hasDatasets?: boolean
  mobile?: boolean
  viewMode?: 'chart' | 'data'
  onChangeViewMode?: (mode: 'chart' | 'data') => void
  /** 是否显示板块导航（数据 / 函数 / super-plot / 科学处理 / 图像）；工具栏模式可关掉。 */
  showNav?: boolean
  /** 当前板块自己的工具按钮，渲染在导航与语言/帮助之间。 */
  toolbar?: ReactNode
  /** 工具页左侧菜单；提供时将语言和帮助归入同一个“更多”菜单。 */
  menu?: ReactNode
}

export function AppNavbar({
  section = 'workbench',
  hasDatasets = false,
  mobile = false,
  viewMode = 'chart',
  onChangeViewMode,
  showNav = true,
  toolbar,
  menu,
}: Props) {
  const { language, setLanguage, t } = useI18n()
  const [helpExpanded, setHelpExpanded] = useState(false)

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
    <header className={cn('flex min-h-[var(--navbar-height)] min-w-0 items-center justify-between border-b border-base-300 bg-base-100 py-1 sm:gap-3 sm:px-5 sm:py-2', section === 'science' ? 'gap-1.5 px-2' : 'gap-2 px-3')}>
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className={cn('shrink-0 overflow-hidden rounded-lg', section === 'science' ? 'h-5 sm:h-7' : 'h-7 sm:h-9 sm:rounded-xl')}>
          <img src="/navbar-icon.webp" alt="joplot" className="block size-full object-contain" />
        </div>

        {menu ? (
          <nav className="flex shrink-0 items-center gap-0.5 border-l border-base-300 pl-1 sm:pl-3" aria-label={t('nav.science')}>
            {menu}
            <DropdownMenu onOpenChange={(open) => {
              if (!open) setHelpExpanded(false)
            }}>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="app-menubar-trigger h-7 gap-1 px-1.5 text-xs sm:px-2">
                  {t('nav.more')}
                  <ChevronDown size={12} className="hidden sm:block" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className={helpExpanded ? 'w-72' : 'min-w-40'}>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Languages size={15} aria-hidden="true" />
                    {t('language.label')}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-36">
                    <DropdownMenuRadioGroup value={language} onValueChange={(value) => {
                      const selected = SUPPORTED_LANGUAGES.find((option) => option === value)
                      if (selected) setLanguage(selected)
                    }}>
                      {languageOptions.map((option) => (
                        <DropdownMenuRadioItem key={option.value} value={option.value}>
                          {option.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem
                  aria-expanded={helpExpanded}
                  onSelect={(event) => {
                    event.preventDefault()
                    setHelpExpanded((expanded) => !expanded)
                  }}
                >
                    <CircleHelp size={15} aria-hidden="true" />
                    {t('help.label')}
                    <ChevronDown size={14} className={cn('ml-auto transition-transform', helpExpanded && 'rotate-180')} aria-hidden="true" />
                </DropdownMenuItem>
                {helpExpanded ? (
                  <div className="mt-1 border-t border-base-300 p-3">
                    <HelpContent />
                  </div>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        ) : null}

        {showNav ? (
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
          <Link
            href={getImagejPath(language)}
            aria-current={section === 'imagej' ? 'page' : undefined}
            className={sectionLinkClass(section === 'imagej')}
          >
            <ImageIcon size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t('nav.imagej')}</span>
          </Link>
          </nav>
        ) : null}

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

      {toolbar ? (
        <div className="flex min-w-0 flex-1 items-center justify-end overflow-x-auto">
          {toolbar}
        </div>
      ) : null}

      {!menu ? <div className="flex items-center gap-1">
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
      </div> : null}
    </header>
  )
}
