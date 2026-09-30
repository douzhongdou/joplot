import type { NextConfig } from 'next'

/**
 * 同域多 zone：绘图工作台是主应用（域名根），图像工作台挂在 /imagej。
 *
 * 部署时把 IMAGE_APP_ORIGIN 指向图像应用的部署源（例如 https://joplot-image.vercel.app），
 * 这里会把 /imagej* 以及图像应用的静态资源前缀 /imagej-assets* 反代过去；本地不配则走各自的
 * dev server。图像应用构建时需设置 IMAGE_ASSET_PREFIX=/imagej-assets（见该应用的 next.config.ts）。
 */
const imageAppOrigin = process.env.IMAGE_APP_ORIGIN?.replace(/\/+$/, '')

/** 图像应用静态资源的同源前缀，必须与 apps/image 的 IMAGE_ASSET_PREFIX 保持一致。 */
const IMAGE_ASSET_PATH = '/imagej-assets'

const nextConfig: NextConfig = {
  transpilePackages: ['@joplot/ui', '@joplot/i18n'],
  async redirects() {
    // 语言不再进入 URL：把历史 /zh、/en/function 之类的路径永久重定向到去掉语言前缀的地址。
    return [
      { source: '/:lang(zh|en|ja)', destination: '/', permanent: true },
      { source: '/:lang(zh|en|ja)/:path*', destination: '/:path*', permanent: true },
    ]
  },
  async rewrites() {
    if (!imageAppOrigin) {
      return []
    }

    return [
      {
        source: '/imagej',
        destination: `${imageAppOrigin}/imagej`,
      },
      {
        source: '/imagej/:path*',
        destination: `${imageAppOrigin}/imagej/:path*`,
      },
      {
        // 图像应用的 /_next/static 等资源：浏览器请求同源的 /imagej-assets/*，这里转发到该应用。
        source: `${IMAGE_ASSET_PATH}/:path*`,
        destination: `${imageAppOrigin}/:path*`,
      },
    ]
  },
}

export default nextConfig
