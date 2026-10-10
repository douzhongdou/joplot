import type { MetadataRoute } from 'next'

// 新应用还未正式发布，不向搜索引擎提交老站域名或实验页面。
export default function sitemap(): MetadataRoute.Sitemap {
  return []
}
