'use client'

import Link from 'next/link'
import { Image as ImageIcon } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@joplot/ui/select'
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

export function AppNavbar({ section = 'imagej' }: { section?: string } = {}) {
  const { language, setLanguage, t } = useI18n()

  return (
    <header className="flex h-[var(--navbar-height)] items-center justify-between gap-3 border-b border-base-300 bg-base-100 px-3 sm:px-4">
      <Link
        href={IMAGEJ_PATH}
        aria-current={section === 'imagej' ? 'page' : undefined}
        className="inline-flex items-center gap-2 rounded-[var(--radius-field)] px-1 text-sm font-semibold text-base-content"
      >
        <ImageIcon size={18} strokeWidth={2.1} aria-hidden="true" />
        <span>{t('chrome.brand')}</span>
      </Link>

      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-base-content/55 sm:inline">{t('chrome.workspace')}</span>
        <Select value={language} onValueChange={(value: string) => setLanguage(value as SupportedLanguage)}>
          <SelectTrigger className="h-8 w-28" aria-label={t('chrome.language')}>
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
      </div>
    </header>
  )
}
