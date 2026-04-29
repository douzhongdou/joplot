'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  getLanguagePath,
  LANGUAGE_HTML_LANG,
  LANGUAGE_STORAGE_KEY,
  resolveInitialLanguage,
  type SupportedLanguage,
} from './config'
import type { TranslationDictionary, TranslationParams, TranslationValue } from './types'
import { en } from './dictionaries/en'
import { jaJP } from './dictionaries/ja-JP'
import { zhCN } from './dictionaries/zh-CN'

const dictionaries: Record<SupportedLanguage, TranslationDictionary> = {
  'zh-CN': zhCN,
  en,
  'ja-JP': jaJP,
}

interface I18nContextValue {
  language: SupportedLanguage
  setLanguage: (language: SupportedLanguage) => void
  t: (key: string, params?: TranslationParams) => string
  formatNumber: (value: number) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function getTranslationValue(dictionary: TranslationDictionary, key: string): TranslationValue | null {
  const segments = key.split('.')
  let current: TranslationDictionary | TranslationValue = dictionary

  for (const segment of segments) {
    if (typeof current === 'string' || typeof current === 'function') {
      return null
    }

    current = current[segment]

    if (current === undefined) {
      return null
    }
  }

  return typeof current === 'string' || typeof current === 'function' ? current : null
}

export function I18nProvider({
  children,
  initialLanguage,
}: {
  children: React.ReactNode
  initialLanguage?: SupportedLanguage
}) {
  const [language, setLanguageState] = useState<SupportedLanguage>(() => initialLanguage ?? resolveInitialLanguage(
    typeof window !== 'undefined' ? window.location.pathname : null,
    typeof window !== 'undefined'
      ? window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
      : null,
    typeof navigator !== 'undefined' ? navigator.language : null,
  ))

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    document.documentElement.lang = LANGUAGE_HTML_LANG[language]
  }, [language])

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(language),
    [language],
  )

  const value = useMemo<I18nContextValue>(() => {
    const dictionary = dictionaries[language]

    return {
      language,
      setLanguage: (nextLanguage) => {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage)

          const targetPath = getLanguagePath(nextLanguage)
          const currentPath = window.location.pathname.replace(/\/+$/, '') || '/'

          if (currentPath !== targetPath) {
            window.location.assign(targetPath)
            return
          }
        }

        setLanguageState(nextLanguage)
      },
      t: (key, params = {}) => {
        const translated = getTranslationValue(dictionary, key)

        if (!translated) {
          return key
        }

        return typeof translated === 'function' ? translated(params) : translated
      },
      formatNumber: (valueToFormat) => numberFormatter.format(valueToFormat),
    }
  }, [language, numberFormatter])

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)

  if (!context) {
    throw new Error('useI18n must be used within I18nProvider')
  }

  return context
}

export {
  getLanguagePath,
  getRouteLanguage,
  getHtmlLang,
  isRouteLanguage,
  LANGUAGE_STORAGE_KEY,
  LANGUAGE_PATHS,
  ROUTE_LANGUAGES,
  SUPPORTED_LANGUAGES,
  resolveLanguageFromPath,
  resolveInitialLanguage,
  normalizeLanguage,
  resolveSupportedLanguageFromRouteLanguage,
} from './config'
export type { RouteLanguage, SupportedLanguage } from './config'
