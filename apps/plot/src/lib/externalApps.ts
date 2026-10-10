/**
 * 跨域入口地址。
 *
 * 图像工作台部署在另一个域名上，站点地址只能来自构建时注入的环境变量；本地开发不配这个
 * 变量，导航里的入口就会自动隐藏。
 */
export function imageAppUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_IMAGE_APP_URL?.trim().replace(/\/+$/, '')

  return value ? value : null
}
