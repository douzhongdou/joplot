import type { NextConfig } from 'next'

/**
 * 图像工作台现在部署在自己的域名上，根路径就是工作台本身；不再被绘图工作台反代到
 * `/imagej`，因此不需要 `assetPrefix`——静态资源走本站的绝对路径即可。
 *
 * 跨域入口（回到绘图工作台）通过 `NEXT_PUBLIC_PLOT_APP_URL` 配置，见 README 的部署一节。
 */
const nextConfig: NextConfig = {
  transpilePackages: ['@joplot/ui', '@joplot/i18n'],
  async redirects() {
    return [
      // 语言不进入对外 URL：既接住历史的 /zh、/ja，也挡住 proxy 内部 rewrite 用的
      // /zh-CN、/ja-JP 语言段——保证每个语言只有一份对外地址。
      { source: '/:lang(zh-CN|zh|en|ja-JP|ja)', destination: '/', permanent: true },
      { source: '/:lang(zh-CN|zh|en|ja-JP|ja)/:path*', destination: '/:path*', permanent: true },
      // 工作台曾经挂在 /imagej（同域反代时期），旧地址一律导回根路径。
      { source: '/imagej', destination: '/', permanent: true },
      { source: '/imagej/:path*', destination: '/', permanent: true },
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
