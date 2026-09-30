// 语言与本地化路由的通用能力来自 @joplot/i18n，这里只补充 plot 自己的板块路径。
export * from '@joplot/i18n/config'

import { createLocalizedPath } from '@joplot/i18n/config'

export const FUNCTION_STUDIO_ROUTE_SEGMENT = 'function'
export const getFunctionStudioPath = createLocalizedPath(FUNCTION_STUDIO_ROUTE_SEGMENT)

export const SUPER_PLOT_ROUTE_SEGMENT = 'super-plot'
export const getSuperPlotPath = createLocalizedPath(SUPER_PLOT_ROUTE_SEGMENT)

export const SCIENCE_ROUTE_SEGMENT = 'science'
export const getSciencePath = createLocalizedPath(SCIENCE_ROUTE_SEGMENT)

// 图像工作台已迁移到独立应用（apps/image），这里保留路径构造器供导航跳转使用。
export const IMAGEJ_ROUTE_SEGMENT = 'imagej'
export const getImagejPath = createLocalizedPath(IMAGEJ_ROUTE_SEGMENT)
