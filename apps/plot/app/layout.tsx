import type { Metadata } from 'next'
import Script from 'next/script'
import type { ReactNode } from 'react'
import { ErrorBoundary } from '../src/components/ErrorBoundary'
import { FocusModality } from '../src/components/FocusModality'
import { I18nProvider } from '../src/i18n'
import { LANGUAGE_HTML_LANG } from '../src/i18n/config'
import { getRequestLanguage } from '../src/lib/requestLanguage'
import { getLanguageMetadata, getSoftwareApplicationJsonLd } from '../src/lib/siteMetadata'
import './globals.css'

const UMAMI_SCRIPT_URL = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL || 'https://analytics.hardgit.com/script.js'
const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim()
const UMAMI_DOMAINS = process.env.NEXT_PUBLIC_UMAMI_DOMAINS?.trim()

export async function generateMetadata(): Promise<Metadata> {
  const language = await getRequestLanguage()
  return getLanguageMetadata(language)
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  const language = await getRequestLanguage()
  const softwareApplicationJsonLd = getSoftwareApplicationJsonLd()

  return (
    <html lang={LANGUAGE_HTML_LANG[language]} suppressHydrationWarning>
      <body>
        <FocusModality />
        {UMAMI_WEBSITE_ID && (
          <Script
            defer
            src={UMAMI_SCRIPT_URL}
            data-website-id={UMAMI_WEBSITE_ID}
            data-domains={UMAMI_DOMAINS || undefined}
            strategy="afterInteractive"
          />
        )}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd) }}
        />
        <I18nProvider initialLanguage={language}>
          <ErrorBoundary>{children}</ErrorBoundary>
        </I18nProvider>
      </body>
    </html>
  )
}
