import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ErrorBoundary } from '../../../src/components/ErrorBoundary'
import { FunctionStudio } from '../../../src/components/FunctionStudio'
import { I18nProvider } from '../../../src/i18n'
import { resolveSupportedLanguageFromRouteLanguage } from '../../../src/i18n/config'
import { getFunctionStudioMetadata } from '../../../src/lib/siteMetadata'

export function generateStaticParams() {
  return [{ lang: 'en' }, { lang: 'zh' }, { lang: 'ja' }]
}

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

  return getFunctionStudioMetadata(language)
}

export default async function FunctionStudioPage({
  params,
}: {
  params: Promise<{ lang: string }>
}) {
  const { lang } = await params
  const language = resolveSupportedLanguageFromRouteLanguage(lang)

  if (!language) {
    notFound()
  }

  return (
    <I18nProvider initialLanguage={language}>
      <ErrorBoundary>
        <FunctionStudio />
      </ErrorBoundary>
    </I18nProvider>
  )
}
