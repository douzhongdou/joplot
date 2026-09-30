// 图像工作台的本地化路由：通用能力来自 @joplot/i18n，这里只声明本应用的板块路径。
export * from '@joplot/i18n/config'

import { createLocalizedPath } from '@joplot/i18n/config'

export const IMAGEJ_ROUTE_SEGMENT = 'imagej'
export const getImagejPath = createLocalizedPath(IMAGEJ_ROUTE_SEGMENT)
