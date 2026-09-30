import type { NextConfig } from 'next'

/**
 * 同域多 zone：本应用被主应用（plot）反代到 /[lang]/imagej。
 * IMAGE_ASSET_PREFIX 指向本应用自己的部署源（绝对 URL），让 /_next/static 资源
 * 直接打到本 zone，避免与主应用的静态资源路径冲突；单独直接访问本应用时可以不配。
 */
const assetPrefix = process.env.IMAGE_ASSET_PREFIX?.replace(/\/+$/, '')

const nextConfig: NextConfig = {
  transpilePackages: ['@joplot/ui', '@joplot/i18n'],
  assetPrefix: assetPrefix || undefined,
}

export default nextConfig
