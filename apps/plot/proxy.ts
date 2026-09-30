import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { resolveLocaleRedirect } from './src/lib/localeRouting'

const LOCALE_REDIRECT_PATHS = new Set(['/', '/function'])

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (LOCALE_REDIRECT_PATHS.has(pathname)) {
    const redirectPath = resolveLocaleRedirect(request.headers.get('accept-language'), pathname)
    return NextResponse.redirect(new URL(redirectPath, request.url), 308)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/function'],
}
