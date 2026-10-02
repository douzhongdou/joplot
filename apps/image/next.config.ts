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
  turbopack: {
    rules: {
      // VTK.js 以字符串形式导入 .glsl 着色器源码；用 raw-loader 把内容作为模块默认导出，
      // 等价 webpack 的 asset/source。Turbopack 内置的 type:'raw' 对这些深层导入不生效。
      '*.glsl': { loaders: ['raw-loader'], as: '*.js' },
    },
    resolveAlias: {
      // these packages' `exports` map has no `import` condition; Turbopack needs the concrete
      // browser entry to resolve them.
      'itk-wasm': 'itk-wasm/dist/index.js',
      '@itk-wasm/image-io': '@itk-wasm/image-io/dist/index.js',
    },
  },
}

export default nextConfig
