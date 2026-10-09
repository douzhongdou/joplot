import type { NextConfig } from 'next'

/**
 * 同域多 zone：本应用被主应用（plot）反代到 /imagej。
 *
 * IMAGE_ASSET_PREFIX 建议设为一个同源路径前缀（例如 `/imagej-assets`），主应用会把该前缀
 * 反代回本应用的 /_next/static 等资源。用路径前缀而不是绝对 URL，可以避免浏览器跨源加载
 * 静态资源时的 CORS 限制。单独直接访问本应用时可以不配。
 */
const assetPrefix = process.env.IMAGE_ASSET_PREFIX?.replace(/\/+$/, '')

const nextConfig: NextConfig = {
  transpilePackages: ['@joplot/ui', '@joplot/i18n'],
  assetPrefix: assetPrefix || undefined,
  async redirects() {
    // 语言不进入对外 URL：既接住历史的 /zh、/ja，也挡住 proxy 内部 rewrite 用的
    // /zh-CN、/ja-JP 语言段——保证每个语言只有一份对外地址。
    return [
      { source: '/:lang(zh-CN|zh|en|ja-JP|ja)', destination: '/imagej', permanent: true },
      { source: '/:lang(zh-CN|zh|en|ja-JP|ja)/:path*', destination: '/:path*', permanent: true },
    ]
  },
  turbopack: {
    resolveAlias: {
      // these packages' `exports` map has no `import` condition; Turbopack needs the concrete
      // browser entry to resolve them.
      'itk-wasm': 'itk-wasm/dist/index.js',
      '@itk-wasm/image-io': '@itk-wasm/image-io/dist/index.js',
    },
  },
}

export default nextConfig
