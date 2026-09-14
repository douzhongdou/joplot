export function resolveLocaleRedirect(acceptLanguage?: string | null, pathname = '/') {
  const normalized = (acceptLanguage ?? '').toLowerCase()
  const suffix = pathname === '/' ? '' : pathname.replace(/\/+$/, '')

  if (normalized.includes('zh')) {
    return `/zh${suffix}`
  }

  if (normalized.includes('ja')) {
    return `/ja${suffix}`
  }

  return `/en${suffix}`
}
