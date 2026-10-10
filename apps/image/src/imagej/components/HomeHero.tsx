import { FolderOpen, ImagePlus } from 'lucide-react'
import { Button } from '@joplot/ui/button'
import type { ImagejCopy } from '../lib/i18n'
import styles from './HomeHero.module.css'

interface Props {
  copy: Pick<ImagejCopy, 'title' | 'openImage' | 'dropHint' | 'tabs'>
  onOpenFile: () => void
  onOpenFolder: () => void
}

/** 首页只提供导入入口；文件拖放由工作台外层统一处理。 */
export function HomeHero({ copy, onOpenFile, onOpenFolder }: Props) {
  return (
    <section className={styles.home}>
      <div className={styles.start}>
        <ImagePlus className={styles.icon} size={32} strokeWidth={1.3} aria-hidden="true" />
        <h1>{copy.title}</h1>
        <div className={styles.actions}>
          <Button data-home-action type="button" onClick={onOpenFile} className={styles.openButton}>
            <ImagePlus size={16} aria-hidden="true" />{copy.openImage}
          </Button>
          <Button data-home-action type="button" variant="ghost" onClick={onOpenFolder} className={styles.folderButton}>
            <FolderOpen size={16} aria-hidden="true" />{copy.tabs.openFolder}
          </Button>
        </div>
        <p className={styles.dropHint}>{copy.dropHint}</p>
        <p className={styles.formats}>PNG · JPEG · TIFF · FITS · RAW</p>
      </div>
    </section>
  )
}
