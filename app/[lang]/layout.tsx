import type { Metadata } from 'next'
import Script from 'next/script'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { getLanguageMetadata } from '../../src/lib/siteMetadata'
import {
  getHtmlLang,
  isRouteLanguage,
  resolveSupportedLanguageFromRouteLanguage,
} from '../../src/i18n/config'
import '../globals.css'

const UMAMI_SCRIPT_URL = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL || 'https://analytics.hardgit.com/script.js'
const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim()
const UMAMI_DOMAINS = process.env.NEXT_PUBLIC_UMAMI_DOMAINS?.trim()

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>
}): Promise<Metadata> {
  const { lang } = await params
  const language = resolveSupportedLanguageFromRouteLanguage(lang)

  if (!language) {
    return {}
  }

  return getLanguageMetadata(language)
}

export default async function LangLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params

  if (!isRouteLanguage(lang)) {
    notFound()
  }

  const language = resolveSupportedLanguageFromRouteLanguage(lang)

  if (!language) {
    notFound()
  }

  return (
    <html lang={getHtmlLang(language)} suppressHydrationWarning>
      <body>
        {UMAMI_WEBSITE_ID && (
          <Script
            defer
            src={UMAMI_SCRIPT_URL}
            data-website-id={UMAMI_WEBSITE_ID}
            data-domains={UMAMI_DOMAINS || undefined}
            strategy="afterInteractive"
          />
        )}
        {children}
      </body>
    </html>
  )
}
