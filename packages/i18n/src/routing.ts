import { DEFAULT_LANGUAGE, normalizeLanguage, type SupportedLanguage } from './config.ts'

/**
 * 语言分发。
 *
 * 约定：语言不出现在对外 URL 里，但每个语言各有一份静态 HTML。proxy 读语言来源决定语言后，
 * 把请求内部 rewrite 到 `/<lang>` 前缀的路由，对外地址栏不变；内部语言路径不该被外部访问，
 * 各应用的 `next.config.ts` 会把它们 308 回对外地址。
 */

/** 把对外路径映射成带语言段的内部路径：`/` → `/zh-CN`，`/science` → `/zh-CN/science`。 */
export function toLanguagePath(pathname: string, language: SupportedLanguage): string {
  return pathname === '/' ? `/${language}` : `/${language}${pathname}`
}

/**
 * 承载跨域语言偏好的查询参数名。
 *
 * 两个应用部署在不同域名上，语言 cookie 无法共享，所以入口链接用它把当前语言带过去；
 * 各应用的 proxy 读到后写进本域名的 cookie，再从地址栏去掉。
 */
export const LANGUAGE_QUERY_KEY = 'lang'

/** 带语言参数的跨域入口地址。 */
export function crossDomainUrl(baseUrl: string, language: SupportedLanguage): string {
  return `${baseUrl.replace(/\/+$/, '')}/?${LANGUAGE_QUERY_KEY}=${language}`
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
  /** 跨域跳转带过来的 `?lang=` 值。 */
  queryLanguage?: string | null
  /** 语言 cookie 的原始值。 */
  cookieLanguage?: string | null
  acceptLanguage?: string | null
}

export interface RequestLanguageDecision {
  language: SupportedLanguage
  /** 语言来自显式选择（URL 参数或 cookie），响应只对本人成立，不能进共享缓存。 */
  explicit: boolean
}

/**
 * 决定本次请求的语言，优先级：URL 参数 > cookie > `Accept-Language`。
 *
 * 前两者是用户的显式选择（两个应用在不同域名上，cookie 无法共享，所以跨域入口链接用
 * `?lang=` 传递）；只有 `Accept-Language` 是浏览器偏好，也只有在那种情况下响应才可以进
 * 共享缓存。
 */
export function resolveRequestLanguage({
  queryLanguage,
  cookieLanguage,
  acceptLanguage,
}: RequestLanguageInput = {}): RequestLanguageDecision {
  const explicit = normalizeLanguage(queryLanguage) ?? normalizeLanguage(cookieLanguage)

  if (explicit) {
    return { language: explicit, explicit: true }
  }

  return { language: pickLanguageFromAcceptLanguage(acceptLanguage), explicit: false }
}
