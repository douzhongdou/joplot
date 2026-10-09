import type { NextConfig } from 'next'

/**
 * 绘图工作台独占自己的域名，图像工作台部署在另一个域名上：两个应用之间不再互相反代。
 * 跨域入口（去图像工作台）通过 `NEXT_PUBLIC_IMAGE_APP_URL` 配置，见 README 的部署一节。
 */
const imageAppUrl = process.env.NEXT_PUBLIC_IMAGE_APP_URL?.replace(/\/+$/, '')

const nextConfig: NextConfig = {
  transpilePackages: ['@joplot/ui', '@joplot/i18n'],
  async redirects() {
    const redirects = [
      // 语言不进入对外 URL：既接住历史的 /zh、/en/function，也挡住 proxy 内部 rewrite 用的
      // /zh-CN、/ja-JP 语言段——保证每个语言只有一份可索引的对外地址。
      { source: '/:lang(zh-CN|zh|en|ja-JP|ja)', destination: '/', permanent: true },
      { source: '/:lang(zh-CN|zh|en|ja-JP|ja)/:path*', destination: '/:path*', permanent: true },
    ]

    // 图像工作台曾经反代在同一域名的 /imagej 下；域名拆开后把老地址永久导向新站点，
    // 免得外链和搜索结果断掉。没配该变量（例如本地开发）时不生成这条规则。
    if (imageAppUrl) {
      redirects.push(
        { source: '/imagej', destination: imageAppUrl, permanent: true },
        { source: '/imagej/:path*', destination: `${imageAppUrl}/:path*`, permanent: true },
      )
    }

    return redirects
  },
}

export default nextConfig
