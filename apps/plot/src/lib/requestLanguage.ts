import { cookies } from 'next/headers'
import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE_KEY, normalizeLanguage, type SupportedLanguage } from '../i18n/config'

/**
 * 服务端读取语言 cookie 决定本次请求的语言；没有 cookie 时回退到默认语言。
 * 语言不再出现在 URL 里，所以服务端只能靠 cookie 判断。
 */
export async function getRequestLanguage(): Promise<SupportedLanguage> {
  const store = await cookies()
  return normalizeLanguage(store.get(LANGUAGE_COOKIE_KEY)?.value) ?? DEFAULT_LANGUAGE
}
