import { notFound, redirect } from 'next/navigation'
import { getImagejPath, resolveSupportedLanguageFromRouteLanguage } from '../../src/i18n/config'

/** 图像工作台只有一个板块：/xx 直接进入 /xx/imagej，保持与旧链接一致的最终地址。 */
export default async function ImagejHomePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  const language = resolveSupportedLanguageFromRouteLanguage(lang)

  if (!language) {
    notFound()
  }

  redirect(getImagejPath(language))
}
