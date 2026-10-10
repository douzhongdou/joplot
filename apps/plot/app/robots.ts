import type { MetadataRoute } from 'next'

// 新 joplot 仅用于开发预览，老站的索引由 legacy-plot 单独维护。
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } }
}
