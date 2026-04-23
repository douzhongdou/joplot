export const LANGUAGE_STORAGE_KEY = 'plotnow-language'

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en', 'ja-JP'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export function normalizeLanguage(input?: string | null): SupportedLanguage | null {
  if (!input) {
    return null
  }

  const normalized = input.trim().toLowerCase()

  if (normalized.startsWith('zh')) {
    return 'zh-CN'
  }

  if (normalized.startsWith('ja')) {
    return 'ja-JP'
  }

  if (normalized.startsWith('en')) {
    return 'en'
  }

  return null
}

export function resolveInitialLanguage(
  storedLanguage?: string | null,
  browserLanguage?: string | null,
): SupportedLanguage {
  return normalizeLanguage(storedLanguage)
    ?? normalizeLanguage(browserLanguage)
    ?? 'en'
}
