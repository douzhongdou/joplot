import type { Metadata } from 'next'
import { FunctionStudio } from '../../src/components/FunctionStudio'
import { getRequestLanguage } from '../../src/lib/requestLanguage'
import { getFunctionStudioMetadata } from '../../src/lib/siteMetadata'

export async function generateMetadata(): Promise<Metadata> {
  const language = await getRequestLanguage()
  return getFunctionStudioMetadata(language)
}

export default function FunctionStudioPage() {
  return <FunctionStudio />
}
