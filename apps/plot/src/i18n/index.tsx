'use client'

import { createI18n } from '@joplot/i18n'
import type { SupportedLanguage } from '@joplot/i18n/config'
import type { TranslationDictionary } from '@joplot/i18n/types'
import { en } from './dictionaries/en'
import { jaJP } from './dictionaries/ja-JP'
import { zhCN } from './dictionaries/zh-CN'

const dictionaries: Record<SupportedLanguage, TranslationDictionary> = {
  'zh-CN': zhCN,
  en,
  'ja-JP': jaJP,
}

export const { I18nProvider, useI18n } = createI18n({ dictionaries })

export * from './config'
export type { SupportedLanguage } from '@joplot/i18n'
