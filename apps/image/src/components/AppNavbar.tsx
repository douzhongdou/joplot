'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ChevronDown, Languages, TableProperties } from 'lucide-react'
import { Button } from '@joplot/ui/button'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@joplot/ui/select'
import { crossDomainUrl } from '@joplot/i18n/routing'
import { plotAppUrl } from '../lib/externalApps'
import {
  IMAGEJ_PATH,
  SUPPORTED_LANGUAGES,
  useI18n,
  type SupportedLanguage,
} from '../i18n'

/** 选项标题用各自语言的原生写法，不随界面语言变化。 */
const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  'zh-CN': '中文',
  en: 'English',
  'ja-JP': '日本語',
}

/**
 * 顶栏。
 *
 * 与 apps/plot 同形态：logo 旁边带一个折叠箭头，`logoMenu` 里的全局功能（文件、编辑……）
 * 都收在这个下拉里，语言切换由本组件追加在末尾——这样顶栏只留真正的工作控件，
 * 不再出现一排并列的菜单按钮。没有传 `logoMenu` 时退化成原来的右侧语言下拉。
 */
export function AppNavbar({
  section = 'imagej',
  toolbar,
  logoMenu,
}: {
  section?: string
  /** 主工具栏控件：渲染在品牌与语言选择之间。 */
  toolbar?: ReactNode
  /** logo 下拉里的全局功能；语言切换会自动追加在它后面。 */
  logoMenu?: ReactNode
} = {}) {
  const { language, setLanguage, t } = useI18n()

  // 绘图工作台在另一个域名上：语言 cookie 带不过去，所以链接里带上当前语言。
  const plotBaseUrl = plotAppUrl()
  const plotAppHref = plotBaseUrl ? crossDomainUrl(plotBaseUrl, language) : null

  const logoImage = (
    <Link
      href={IMAGEJ_PATH}
      aria-current={section === 'imagej' ? 'page' : undefined}
      className="inline-flex shrink-0 items-center rounded-[var(--radius-field)] px-1 text-sm font-semibold text-base-content"
    >
      {/* 品牌标识与 plot 同一形态：横版图里已经带图标与名字，因此不再另渲染文字。 */}
      <span className="block h-6 shrink-0 overflow-hidden sm:h-7">
        <img src="/navbar-icon.webp" alt="jo image" className="block h-full w-auto" />
      </span>
    </Link>
  )

  const languageSelect = (
    <Select value={language} onValueChange={(value: string) => setLanguage(value as SupportedLanguage)}>
      <SelectTrigger className="w-20 sm:w-24" aria-label={t('chrome.language')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SUPPORTED_LANGUAGES.map((value) => (
          <SelectItem key={value} value={value}>
            {LANGUAGE_LABELS[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <header className="flex h-[var(--navbar-height)] min-w-0 items-center gap-1.5 border-b border-base-300 bg-base-100 px-1.5 sm:gap-2 sm:px-2">
      {logoMenu ? (
        <DropdownMenu>
          <div className="flex shrink-0 items-center gap-0.5">
            {logoImage}
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('chrome.language')}
                className="size-7 shrink-0 rounded-md text-base-content/55 hover:text-base-content"
              >
                <ChevronDown size={15} strokeWidth={2.4} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </div>
          <DropdownMenuContent align="start" className="min-w-52">
            {logoMenu}
            <DropdownMenuSeparator />
            {plotAppHref ? (
              <DropdownMenuItem asChild>
                <a href={plotAppHref}>
                  <TableProperties size={15} aria-hidden="true" />
                  {t('chrome.plotApp')}
                </a>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Languages size={15} aria-hidden="true" />
                {t('chrome.language')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-36">
                <DropdownMenuRadioGroup
                  value={language}
                  onValueChange={(value) => {
                    const next = SUPPORTED_LANGUAGES.find((option) => option === value)
                    if (next) setLanguage(next)
                  }}
                >
                  {SUPPORTED_LANGUAGES.map((value) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {LANGUAGE_LABELS[value]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        logoImage
      )}

      {toolbar ? (
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">{toolbar}</div>
      ) : (
        <div className="min-w-0 flex-1" />
      )}

      {/* 语言已经在 logo 菜单里时，右侧不再重复放一个下拉。 */}
      {logoMenu ? null : <div className="flex shrink-0 items-center gap-1.5">{languageSelect}</div>}
    </header>
  )
}
