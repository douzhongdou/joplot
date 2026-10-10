/**
 * 语言偏好的通用工具。语言不再出现在 URL 路径里，而是由 cookie 决定，
 * 首次访问时回退到浏览器语言。各应用用静态路径常量（如 '/imagej'）指板块。
 */

/** 保存语言偏好的 cookie 名。 */
export const LANGUAGE_COOKIE_KEY = 'joplot-language'

/** 没有 cookie、也匹配不到浏览器语言时使用的语言。 */
export const DEFAULT_LANGUAGE = 'en' as const

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en', 'ja-JP'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const LANGUAGE_HTML_LANG: Record<SupportedLanguage, string> = {
  'zh-CN': 'zh-CN',
  en: 'en',
  'ja-JP': 'ja',
}

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

/** 把任意语言标识（cookie / 浏览器语言）归一到受支持的语言，无法识别时返回 null。 */
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

/** 从 cookie 头（`a=1; joplot-language=zh-CN`）里解析语言偏好。 */
export function parseLanguageCookie(
  cookieHeader?: string | null,
  cookieKey: string = LANGUAGE_COOKIE_KEY,
): SupportedLanguage | null {
  if (!cookieHeader) {
    return null
  }

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) {
      continue
    }
    const name = part.slice(0, separator).trim()
    if (name !== cookieKey) {
      continue
    }
    return normalizeLanguage(decodeURIComponent(part.slice(separator + 1).trim()))
  }

  return null
}

/** 生成写入语言偏好的 Set-Cookie 值。 */
export function serializeLanguageCookie(
  language: SupportedLanguage,
  cookieKey: string = LANGUAGE_COOKIE_KEY,
): string {
  return `${cookieKey}=${encodeURIComponent(language)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

/**
 * 决定初始语言：cookie 优先，其次浏览器语言，最后回退到默认语言。
 * 传入的回退语言用于服务端在没有 cookie 时表达默认值。
 */
export function resolveLanguage(inputs: {
  cookie?: string | null
  browser?: string | null
  fallback?: SupportedLanguage
} = {}): SupportedLanguage {
  return parseLanguageCookie(inputs.cookie)
    ?? normalizeLanguage(inputs.browser)
    ?? inputs.fallback
    ?? DEFAULT_LANGUAGE
}
