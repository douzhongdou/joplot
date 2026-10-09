import { redirect } from 'next/navigation'
import { IMAGEJ_PATH } from '../../src/i18n/config'

/** 图像工作台只有一个板块：根路径直接进入 /imagej。 */
export default function ImagejHomePage() {
  redirect(IMAGEJ_PATH)
}
