import { notFound } from 'next/navigation'
import App from '../../src/App'
import { I18nProvider } from '../../src/i18n'
import { resolveSupportedLanguageFromRouteLanguage } from '../../src/i18n/config'

export function generateStaticParams() {
  return [{ lang: 'en' }, { lang: 'zh' }, { lang: 'ja' }]
}

export default async function LocalizedPage({
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
      <App />
    </I18nProvider>
  )
}
