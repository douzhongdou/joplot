import type { ReactNode } from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  eyebrow: string
  title: string
  closeLabel: string
  onClose: () => void
  children: ReactNode
}

export function MobileInspectorDrawer({ open, eyebrow, title, closeLabel, onClose, children }: Props) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 sm:hidden" aria-modal="true" role="dialog">
      <button
        type="button"
        className="absolute inset-0 bg-neutral/35 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label={closeLabel}
      />

      <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-hidden rounded-t-[1.75rem] border border-base-300 bg-base-100 shadow-[0_-20px_60px_rgba(15,23,42,0.18)]">
        <div className="flex items-center justify-between border-b border-base-300 px-5 py-4">
          <div className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-base-content/48">{eyebrow}</span>
            <strong className="text-lg font-semibold text-base-content">{title}</strong>
          </div>
          <button
            type="button"
            className="inline-grid size-10 place-items-center rounded-full border border-base-300 bg-base-100 text-base-content/70 transition hover:text-primary"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X size={18} strokeWidth={2.1} />
          </button>
        </div>

        <div className="max-h-[calc(85vh-5.25rem)] overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  )
}
