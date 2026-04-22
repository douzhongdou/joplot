export interface ClipboardPort {
  write?: (items: unknown[]) => Promise<void>
  writeText?: (text: string) => Promise<void>
}

export interface ClipboardItemPort {
  new (items: Record<string, Blob>): unknown
}

export type ClipboardCopyMode = 'binary' | 'html' | 'text'

interface CopyPngOptions {
  blob: Blob
  dataUrl: string
  clipboard?: ClipboardPort
  ClipboardItemCtor?: ClipboardItemPort | null
}

export async function copyPngDataUrlToClipboard({
  blob,
  dataUrl,
  clipboard,
  ClipboardItemCtor,
}: CopyPngOptions): Promise<ClipboardCopyMode> {
  if (ClipboardItemCtor && clipboard?.write) {
    try {
      await clipboard.write([
        new ClipboardItemCtor({
          [blob.type || 'image/png']: blob,
        }),
      ])
      return 'binary'
    } catch {
      try {
        await clipboard.write([
          new ClipboardItemCtor({
            'text/html': new Blob(
              [`<img src="${dataUrl}" alt="PlotNow chart" />`],
              { type: 'text/html' },
            ),
            'text/plain': new Blob([dataUrl], { type: 'text/plain' }),
          }),
        ])
        return 'html'
      } catch {
        // Fall through to plain-text clipboard support below.
      }
    }
  }

  if (clipboard?.writeText) {
    await clipboard.writeText(dataUrl)
    return 'text'
  }

  throw new Error('Clipboard copy is not supported in this browser')
}
