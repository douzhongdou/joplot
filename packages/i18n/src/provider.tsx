'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  LANGUAGE_COOKIE_KEY,
  LANGUAGE_HTML_LANG,
  resolveLanguage,
  serializeLanguageCookie,
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
  /** 语言 cookie 的名称；不传则用共享默认值。 */
  cookieKey?: string
}

/** 用一份字典创建一个隔离的 i18n Context，供单个应用使用。 */
export function createI18n({ dictionaries, cookieKey = LANGUAGE_COOKIE_KEY }: CreateI18nOptions): I18nBundle {
  const I18nContext = createContext<I18nContextValue | null>(null)

  function I18nProvider({
    children,
    initialLanguage,
  }: {
    children: React.ReactNode
    initialLanguage?: SupportedLanguage
  }) {
    const [language, setLanguageState] = useState<SupportedLanguage>(() => initialLanguage ?? resolveLanguage({
      cookie: typeof document !== 'undefined' ? document.cookie : null,
      browser: typeof navigator !== 'undefined' ? navigator.language : null,
    }))

    useEffect(() => {
      document.documentElement.lang = LANGUAGE_HTML_LANG[language]
    }, [language])

    const numberFormatter = useMemo(
      () => new Intl.NumberFormat(language),
      [language],
    )

    const value = useMemo<I18nContextValue>(() => ({
      language,
      // 路径里不再带语言：切换只写 cookie 并就地重渲染，不跳转。
      setLanguage: (nextLanguage) => {
        if (typeof document !== 'undefined') {
          document.cookie = serializeLanguageCookie(nextLanguage, cookieKey)
        }
        setLanguageState(nextLanguage)
      },
      t: (key, params = {}) => {
        const translated = getTranslationValue(dictionaries[language], key)

        if (!translated) {
          return key
        }

        return typeof translated === 'function' ? translated(params) : translated
      },
      formatNumber: (valueToFormat) => numberFormatter.format(valueToFormat),
    }), [language, numberFormatter, cookieKey])

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
