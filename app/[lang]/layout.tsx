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
        <Script
          defer
          src="https://analytics.hardgit.com/script.js"
          data-website-id="ae3a3e3e-896b-4a99-bb52-66dc81e59839"
          strategy="afterInteractive"
        />
        {children}
      </body>
    </html>
  )
}
