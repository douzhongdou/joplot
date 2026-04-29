export const LANGUAGE_STORAGE_KEY = 'plotnow-language'

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en', 'ja-JP'] as const
export const ROUTE_LANGUAGES = ['zh', 'en', 'ja'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]
export type RouteLanguage = (typeof ROUTE_LANGUAGES)[number]

export const LANGUAGE_PATHS: Record<SupportedLanguage, '/zh' | '/en' | '/ja'> = {
  'zh-CN': '/zh',
  en: '/en',
  'ja-JP': '/ja',
}

export const ROUTE_LANGUAGE_TO_SUPPORTED_LANGUAGE: Record<RouteLanguage, SupportedLanguage> = {
  zh: 'zh-CN',
  en: 'en',
  ja: 'ja-JP',
}

export const SUPPORTED_LANGUAGE_TO_ROUTE_LANGUAGE: Record<SupportedLanguage, RouteLanguage> = {
  'zh-CN': 'zh',
  en: 'en',
  'ja-JP': 'ja',
}

export const LANGUAGE_HTML_LANG: Record<SupportedLanguage, string> = {
  'zh-CN': 'zh-CN',
  en: 'en',
  'ja-JP': 'ja',
}

export function isRouteLanguage(value: string): value is RouteLanguage {
  return ROUTE_LANGUAGES.includes(value as RouteLanguage)
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

export function resolveSupportedLanguageFromRouteLanguage(language: string): SupportedLanguage | null {
  return isRouteLanguage(language) ? ROUTE_LANGUAGE_TO_SUPPORTED_LANGUAGE[language] : null
}

export function getLanguagePath(language: SupportedLanguage): string {
  return LANGUAGE_PATHS[language]
}

export function getRouteLanguage(language: SupportedLanguage): RouteLanguage {
  return SUPPORTED_LANGUAGE_TO_ROUTE_LANGUAGE[language]
}

export function getHtmlLang(language: SupportedLanguage): string {
  return LANGUAGE_HTML_LANG[language]
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
