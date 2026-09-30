'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  LANGUAGE_HTML_LANG,
  LANGUAGE_STORAGE_KEY,
  replaceRouteLanguage,
  resolveInitialLanguage,
  type SupportedLanguage,
} from './config'
import type { TranslationDictionary, TranslationParams, TranslationValue } from './types'

export interface I18nContextValue {
  language: SupportedLanguage
  setLanguage: (language: SupportedLanguage) => void
  t: (key: string, params?: TranslationParams) => string
  formatNumber: (value: number) => string
}

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

export interface I18nBundle {
  I18nProvider: (props: { children: React.ReactNode; initialLanguage?: SupportedLanguage }) => React.ReactElement
  useI18n: () => I18nContextValue
}

export interface CreateI18nOptions {
  dictionaries: Record<SupportedLanguage, TranslationDictionary>
  /** localStorage 键；不传则用共享默认值。 */
  storageKey?: string
}

/** 用一份字典创建一个隔离的 i18n Context，供单个应用使用。 */
export function createI18n({ dictionaries, storageKey = LANGUAGE_STORAGE_KEY }: CreateI18nOptions): I18nBundle {
  const I18nContext = createContext<I18nContextValue | null>(null)

  function I18nProvider({
    children,
    initialLanguage,
  }: {
    children: React.ReactNode
    initialLanguage?: SupportedLanguage
  }) {
    const [language, setLanguageState] = useState<SupportedLanguage>(() => initialLanguage ?? resolveInitialLanguage(
      typeof window !== 'undefined' ? window.location.pathname : null,
      typeof window !== 'undefined'
        ? window.localStorage.getItem(storageKey)
        : null,
      typeof navigator !== 'undefined' ? navigator.language : null,
    ))

    useEffect(() => {
      window.localStorage.setItem(storageKey, language)
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
            window.localStorage.setItem(storageKey, nextLanguage)

            const currentPath = window.location.pathname.replace(/\/+$/, '') || '/'
            const targetPath = replaceRouteLanguage(currentPath, nextLanguage)

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

  function useI18n(): I18nContextValue {
    const context = useContext(I18nContext)

    if (!context) {
      throw new Error('useI18n must be used within I18nProvider')
    }

    return context
  }

  return { I18nProvider, useI18n }
}
