import type { Metadata } from 'next'
import Script from 'next/script'
import type { ReactNode } from 'react'
import { ErrorBoundary } from '../../src/components/ErrorBoundary'
import { FocusModality } from '../../src/components/FocusModality'
import { I18nProvider } from '../../src/i18n'
import { LANGUAGE_HTML_LANG, SUPPORTED_LANGUAGES } from '../../src/i18n/config'
import { resolveRouteLanguage } from '../../src/lib/routeLanguage'
import { getLanguageMetadata, getSoftwareApplicationJsonLd } from '../../src/lib/siteMetadata'
import '../globals.css'

const UMAMI_SCRIPT_URL = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL || 'https://analytics.hardgit.com/script.js'
const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim()
const UMAMI_DOMAINS = process.env.NEXT_PUBLIC_UMAMI_DOMAINS?.trim()

interface LanguageRouteProps {
  params: Promise<{ lang: string }>
}

/**
 * 语言取自路由段而不是 cookie，所以每个语言都能在构建时生成一份静态 HTML——HTML 由此可进
 * CDN；对外地址由 proxy.ts 分发到对应语言。
 */
export const dynamicParams = false

export function generateStaticParams() {
  return SUPPORTED_LANGUAGES.map((language) => ({ lang: language }))
}

export async function generateMetadata({ params }: LanguageRouteProps): Promise<Metadata> {
  const { lang } = await params
  return getLanguageMetadata(resolveRouteLanguage(lang))
}

export default async function RootLayout({
  children,
  params,
}: LanguageRouteProps & {
  children: ReactNode
}) {
  const { lang } = await params
  const language = resolveRouteLanguage(lang)
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
