import { notFound } from 'next/navigation'
import { normalizeLanguage, type SupportedLanguage } from '../i18n/config.ts'

/**
 * 把 `[lang]` 路由段解析成受支持的语言。
 *
 * 静态生成只列出受支持语言，`dynamicParams = false` 已经挡住其余取值；这里再兜一层，
 * 保证非法语言不会进入渲染流程。
 */
export function resolveRouteLanguage(lang: string): SupportedLanguage {
  const language = normalizeLanguage(lang)

  if (!language) {
    notFound()
  }

  return language
}
