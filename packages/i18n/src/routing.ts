import { DEFAULT_LANGUAGE, normalizeLanguage, type SupportedLanguage } from './config.ts'

/**
 * 语言分发。
 *
 * 约定：语言不出现在对外 URL 里，但每个语言各有一份静态 HTML。proxy 读 cookie /
 * Accept-Language 决定语言后，把请求内部 rewrite 到 `/<lang>` 前缀的路由，对外地址栏不变；
 * 内部语言路径不该被外部访问，各应用的 `next.config.ts` 会把它们 308 回对外地址。
 */

/** 把对外路径映射成带语言段的内部路径：`/` → `/zh-CN`，`/science` → `/zh-CN/science`。 */
export function toLanguagePath(pathname: string, language: SupportedLanguage): string {
  return pathname === '/' ? `/${language}` : `/${language}${pathname}`
}

/** 按 q 值从高到低挑第一个受支持的语言；挑不出来时用 fallback。 */
export function pickLanguageFromAcceptLanguage(
  acceptLanguage: string | null | undefined,
  fallback: SupportedLanguage = DEFAULT_LANGUAGE,
): SupportedLanguage {
  if (!acceptLanguage) {
    return fallback
  }

  const candidates = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.split(';')
      const qualityParam = params
        .map((param) => param.trim())
        .find((param) => param.startsWith('q='))
      const quality = qualityParam ? Number.parseFloat(qualityParam.slice(2)) : 1

      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0 }
    })
    // q=0 是明确拒绝；`*` 这类通配符交给 normalizeLanguage 返回 null。
    .filter((candidate) => candidate.tag.length > 0 && candidate.quality > 0)
    .sort((left, right) => right.quality - left.quality)

  for (const candidate of candidates) {
    const language = normalizeLanguage(candidate.tag)

    if (language) {
      return language
    }
  }

  return fallback
}

export interface RequestLanguageInput {
  /** 语言 cookie 的原始值；没有就留空。 */
  cookieLanguage?: string | null
  acceptLanguage?: string | null
}

export interface RequestLanguageDecision {
  language: SupportedLanguage
  /** 语言来自 cookie：这是用户显式选择，响应只对本人成立，不能进共享缓存。 */
  fromCookie: boolean
}

/** cookie 优先于 Accept-Language：前者是用户显式选择，后者只是浏览器偏好。 */
export function resolveRequestLanguage({
  cookieLanguage,
  acceptLanguage,
}: RequestLanguageInput = {}): RequestLanguageDecision {
  const fromCookie = normalizeLanguage(cookieLanguage)

  if (fromCookie) {
    return { language: fromCookie, fromCookie: true }
  }

  return { language: pickLanguageFromAcceptLanguage(acceptLanguage), fromCookie: false }
}
