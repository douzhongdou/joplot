import type { NextConfig } from 'next'

/**
 * 同域多 zone：绘图工作台是主应用（域名根），图像工作台挂在 /imagej。
 * 部署时把 IMAGE_APP_ORIGIN 指向图像应用的部署源（例如 https://joplot-image.vercel.app），
 * 这里就会把 /imagej* 反代过去；本地不配该项则走各自的 dev server。
 */
const imageAppOrigin = process.env.IMAGE_APP_ORIGIN?.replace(/\/+$/, '')

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
    ]
  },
}

export default nextConfig
