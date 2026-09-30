import { cookies } from 'next/headers'
import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE_KEY, normalizeLanguage, type SupportedLanguage } from '../i18n/config'

/** 服务端读取语言 cookie；没有 cookie 时回退到默认语言。 */
export async function getRequestLanguage(): Promise<SupportedLanguage> {
  const store = await cookies()
  return normalizeLanguage(store.get(LANGUAGE_COOKIE_KEY)?.value) ?? DEFAULT_LANGUAGE
}
