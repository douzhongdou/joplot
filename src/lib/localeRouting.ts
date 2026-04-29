export function resolveLocaleRedirect(acceptLanguage?: string | null) {
  const normalized = (acceptLanguage ?? '').toLowerCase()

  if (normalized.includes('zh')) {
    return '/zh'
  }

  if (normalized.includes('ja')) {
    return '/ja'
  }

  return '/en'
}
