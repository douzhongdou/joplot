import { ScienceApp } from '../../src/science/components/ScienceApp'
import { resolveScienceLanguage } from '../../src/science/lib/i18n'
import { resolveRouteLanguage } from '../../src/lib/routeLanguage'

export default async function HomePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params
  return <ScienceApp language={resolveScienceLanguage(resolveRouteLanguage(lang))} />
}
