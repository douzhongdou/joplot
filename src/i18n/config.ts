export const LANGUAGE_STORAGE_KEY = 'plotnow-language'

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en', 'ja-JP'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const LANGUAGE_PATHS: Record<SupportedLanguage, '/zh' | '/en' | '/ja'> = {
  'zh-CN': '/zh',
  en: '/en',
  'ja-JP': '/ja',
}

export const LANGUAGE_HTML_LANG: Record<SupportedLanguage, string> = {
  'zh-CN': 'zh-CN',
  en: 'en',
  'ja-JP': 'ja',
}

function normalizePathname(pathname?: string | null): string | null {
  if (!pathname) {
    return null
  }

  const trimmed = pathname.trim()

  if (!trimmed) {
    return null
  }

  const normalized = trimmed.replace(/\/+$/, '')
  return normalized === '' ? '/' : normalized.toLowerCase()
}

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

export function resolveLanguageFromPath(pathname?: string | null): SupportedLanguage | null {
  const normalizedPathname = normalizePathname(pathname)

  switch (normalizedPathname) {
    case '/zh':
      return 'zh-CN'
    case '/ja':
      return 'ja-JP'
    case '/en':
      return 'en'
    default:
      return null
  }
}

export function getLanguagePath(language: SupportedLanguage): string {
  return LANGUAGE_PATHS[language]
}

export function resolveInitialLanguage(
  pathname?: string | null,
  storedLanguage?: string | null,
  browserLanguage?: string | null,
): SupportedLanguage {
  if (browserLanguage === undefined && !pathname?.trim().startsWith('/')) {
    return normalizeLanguage(pathname)
      ?? normalizeLanguage(storedLanguage)
      ?? 'en'
  }

  return resolveLanguageFromPath(pathname)
    ?? normalizeLanguage(storedLanguage)
    ?? normalizeLanguage(browserLanguage)
    ?? 'en'
}
