'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Activity, ChevronDown, CircleHelp, FlaskConical, FunctionSquare, Image as ImageIcon, Languages, TableProperties } from 'lucide-react'
import { HelpButton, HelpDialog } from './HelpDialog'
import { SelectMenu } from './SelectMenu'
import { Button, buttonVariants } from '@joplot/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@joplot/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  FUNCTION_STUDIO_PATH,
  HOME_PATH,
  IMAGEJ_PATH,
  SCIENCE_PATH,
  SUPER_PLOT_PATH,
  SUPPORTED_LANGUAGES,
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
  /**
   * logo 下拉菜单里的自定义分组（例如科学处理的文件操作）。
   * 提供时 logo 旁出现收起按钮，语言与帮助也一并并入该菜单；否则语言与帮助留在右侧。
   */
  logoMenu?: ReactNode
  /** logo 菜单关闭时的焦点守卫（例如导入对话框正在打开，焦点应留给对话框）。 */
  onLogoMenuCloseAutoFocus?: (event: Event) => void
}

export function AppNavbar({
  section = 'workbench',
  hasDatasets = false,
  mobile = false,
  viewMode = 'chart',
  onChangeViewMode,
  showNav = true,
  toolbar,
  logoMenu,
  onLogoMenuCloseAutoFocus,
}: Props) {
  const { language, setLanguage, t } = useI18n()
  const [helpOpen, setHelpOpen] = useState(false)

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

  const logoImage = (
    <div className={cn('shrink-0 overflow-hidden rounded-lg', section === 'science' ? 'h-5 sm:h-7' : 'h-7 sm:h-9 sm:rounded-xl')}>
      <img src="/navbar-icon.webp" alt="joplot" className="block size-full object-contain" />
    </div>
  )

  const languageSubmenu = (
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
  )

  const helpMenuItem = (
    <DropdownMenuItem onSelect={() => setHelpOpen(true)}>
      <CircleHelp size={15} aria-hidden="true" />
      {t('help.label')}
    </DropdownMenuItem>
  )

  return (
    <header className={cn('flex min-h-[var(--navbar-height)] min-w-0 items-center justify-between border-b border-base-300 bg-base-100 py-1 sm:gap-3 sm:px-5 sm:py-2', section === 'science' ? 'gap-1.5 px-2' : 'gap-2 px-3')}>
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {logoMenu ? (
          <DropdownMenu>
            <div className="flex shrink-0 items-center gap-0.5">
              {logoImage}
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('nav.menu')}
                  className="size-7 shrink-0 rounded-md text-base-content/55 hover:text-base-content"
                >
                  <ChevronDown size={15} strokeWidth={2.4} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </div>
            <DropdownMenuContent
              align="start"
              className="min-w-48"
              onCloseAutoFocus={(event) => {
                // 菜单项打开的弹窗（导入 / 帮助）需要自己接管焦点。
                if (helpOpen) event.preventDefault()
                onLogoMenuCloseAutoFocus?.(event)
              }}
            >
              {logoMenu}
              <DropdownMenuSeparator />
              {languageSubmenu}
              {helpMenuItem}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : logoImage}

        {showNav ? (
          <nav className="ml-1 flex min-w-0 items-center gap-0.5 overflow-x-auto sm:ml-3" aria-label={t('nav.sectionsLabel')}>
          <Link
            href={HOME_PATH}
            aria-current={section === 'workbench' ? 'page' : undefined}
            className={sectionLinkClass(section === 'workbench')}
          >
            <TableProperties size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t('nav.workbench')}</span>
          </Link>
          <Link
            href={FUNCTION_STUDIO_PATH}
            aria-current={section === 'function' ? 'page' : undefined}
            className={sectionLinkClass(section === 'function')}
          >
            <FunctionSquare size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t('nav.function')}</span>
          </Link>
          <Link
            href={SUPER_PLOT_PATH}
            aria-current={section === 'superplot' ? 'page' : undefined}
            className={sectionLinkClass(section === 'superplot')}
          >
            <Activity size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t('nav.superplot')}</span>
          </Link>
          <Link
            href={SCIENCE_PATH}
            aria-current={section === 'science' ? 'page' : undefined}
            className={sectionLinkClass(section === 'science')}
          >
            <FlaskConical size={15} strokeWidth={2.1} aria-hidden="true" />
            <span>{t('nav.science')}</span>
          </Link>
          <Link
            href={IMAGEJ_PATH}
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

      {!logoMenu ? <div className="flex items-center gap-1">
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
        <HelpButton />
      </div> : null}

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </header>
  )
}
