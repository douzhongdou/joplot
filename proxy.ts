import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { resolveLocaleRedirect } from './src/lib/localeRouting'

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/') {
    const redirectPath = resolveLocaleRedirect(request.headers.get('accept-language'))
    return NextResponse.redirect(new URL(redirectPath, request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/'],
}
