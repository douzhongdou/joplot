import type { MetadataRoute } from 'next'

/** 与 layout 的 canonical 保持一致；换域名时两处一起改。 */
const siteUrl = 'https://joimage.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
