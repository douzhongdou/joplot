import { NextResponse, type NextRequest } from 'next/server'
import { LANGUAGE_COOKIE_KEY, normalizeLanguage } from './src/i18n/config'
import { LANGUAGE_QUERY_KEY, resolveRequestLanguage, toLanguagePath } from '@joplot/i18n/routing'

/** 语言 cookie 的有效期：一年。 */
const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * 语言分发：URL 里不出现语言，但每个语言各有一份静态 HTML，从而让 HTML 能被 CDN 缓存。
 *
 * proxy 读语言来源决定语言，再把请求内部 rewrite 到 `/<lang>` 前缀的静态路由，浏览器地址栏
 * 不变。语言来源优先级：`?lang=` 参数 > cookie > `Accept-Language`（见 @joplot/i18n/routing）。
 *
 * 缓存约定：
 * - 语言来自参数或 cookie：结果只对本人成立，这里显式声明 private/no-store。Vercel 不缓存带
 *   `Vary: Cookie` 的响应，所以不能靠 Vary 分流，只能整条响应不进缓存。
 * - 语言来自 `Accept-Language`：静态页自带 `s-maxage=31536000`，按语言分缓存由平台层的
 *   `Vary: Accept-Language` 声明（见 vercel.json）。App Router 页面会覆盖 Next 配置层与这里
 *   设置的 Vary，只有平台层能盖回去，所以本文件里不要再设 Vary。
 */
export function proxy(request: NextRequest) {
  const queryLanguage = normalizeLanguage(request.nextUrl.searchParams.get(LANGUAGE_QUERY_KEY))
  const cookieLanguage = request.cookies.get(LANGUAGE_COOKIE_KEY)?.value

  /*
   * 图像工作台在另一个域名上，cookie 带不过去，所以跨域入口链接把语言放在 `?lang=` 里。
   * 这里把它记进本域名的 cookie，再从地址栏去掉，保证对外 URL 干净、可分享。
   */
  if (queryLanguage && queryLanguage !== normalizeLanguage(cookieLanguage)) {
    const cleanUrl = request.nextUrl.clone()
    cleanUrl.searchParams.delete('lang')

    const redirect = NextResponse.redirect(cleanUrl)
    redirect.cookies.set({
      name: LANGUAGE_COOKIE_KEY,
      value: queryLanguage,
      path: '/',
      maxAge: LANGUAGE_COOKIE_MAX_AGE,
      sameSite: 'lax',
    })

    return redirect
  }

  const { language, explicit } = resolveRequestLanguage({
    queryLanguage,
    cookieLanguage,
    acceptLanguage: request.headers.get('accept-language'),
  })

  const url = request.nextUrl.clone()
  url.pathname = toLanguagePath(request.nextUrl.pathname, language)

  const response = NextResponse.rewrite(url)

  if (explicit) {
    response.headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate')
  }

  return response
}

export const config = {
  matcher: [
    /*
     * 只接管页面请求：`_next` 静态资源与带扩展名的静态资产（favicon、manifest、图片）
     * 不参与语言分发。
     */
    '/((?!_next/|.*\\.).*)',
  ],
}
