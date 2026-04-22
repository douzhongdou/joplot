import appIcon from '../icon.svg'
import { FileUploader } from './FileUploader'

interface Props {
  activeFileName: string | null
  datasetCount: number
  onFiles: (files: File[]) => void | Promise<void>
}

export function AppNavbar({
  activeFileName,
  datasetCount,
  onFiles,
}: Props) {
  const statusText = activeFileName
    ? `${activeFileName} · 已加载 ${datasetCount} 份 CSV`
    : '未加载数据集'

  return (
    <header className="grid h-[var(--navbar-height)] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-base-300 bg-base-100 px-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="size-11 overflow-hidden rounded-2xl">
          <img src={appIcon} alt="" className="block size-full object-contain" />
        </div>

        <div className="grid min-w-0 gap-0.5">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-base-content">joplot</h1>
          <p className="truncate text-sm text-base-content/60">{statusText}</p>
        </div>
      </div>

      <FileUploader hasDatasets={datasetCount > 0} onFiles={onFiles} />
    </header>
  )
}
