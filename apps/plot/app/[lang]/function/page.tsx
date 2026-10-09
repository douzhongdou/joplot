import type { Metadata } from 'next'
import { FunctionStudio } from '../../../src/components/FunctionStudio'
import { resolveRouteLanguage } from '../../../src/lib/routeLanguage'
import { getFunctionStudioMetadata } from '../../../src/lib/siteMetadata'

interface LanguageRouteProps {
  params: Promise<{ lang: string }>
}

export async function generateMetadata({ params }: LanguageRouteProps): Promise<Metadata> {
  const { lang } = await params
  return getFunctionStudioMetadata(resolveRouteLanguage(lang))
}

export default function FunctionStudioPage() {
  return <FunctionStudio />
}
