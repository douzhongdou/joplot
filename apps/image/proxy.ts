import { NextResponse, type NextRequest } from 'next/server'
import { LANGUAGE_COOKIE_KEY } from './src/i18n/config'
import { resolveRequestLanguage, toLanguagePath } from '@joplot/i18n/routing'

/**
 * 语言分发：URL 里不出现语言，但每个语言各有一份静态 HTML，从而让 HTML 能被 CDN 缓存。
 *
 * 本应用被绘图工作台反代在 `/imagej`，所以这里处理的路径就是 `/imagej`、`/imagej/classic`；
 * Accept-Language 与 cookie 都会随反代请求透传过来。
 *
 * 缓存约定：
 * - 语言来自 cookie：结果只对本人成立，这里显式声明 private/no-store。Vercel 不缓存带
 *   `Vary: Cookie` 的响应，所以不能靠 Vary 分流，只能整条响应不进缓存。
 * - 语言来自 Accept-Language：静态页自带 `s-maxage=31536000`，按语言分缓存由平台层的
 *   `Vary: Accept-Language` 声明（见 vercel.json）。App Router 页面会覆盖 Next 配置层与
 *   这里设置的 Vary，只有平台层能盖回去，所以本文件里不要再设 Vary。
 */
export function proxy(request: NextRequest) {
  const { language, fromCookie } = resolveRequestLanguage({
    cookieLanguage: request.cookies.get(LANGUAGE_COOKIE_KEY)?.value,
    acceptLanguage: request.headers.get('accept-language'),
  })

  const url = request.nextUrl.clone()
  url.pathname = toLanguagePath(request.nextUrl.pathname, language)

  const response = NextResponse.rewrite(url)

  if (fromCookie) {
    response.headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate')
  }

  return response
}

export const config = {
  matcher: [
    /*
     * 只接管页面请求：`_next` 静态资源（含绘图工作台经 /imagej-assets 转发过来的那些）
     * 与带扩展名的静态资产都不参与语言分发。
     */
    '/((?!_next/|.*\\.).*)',
  ],
}
