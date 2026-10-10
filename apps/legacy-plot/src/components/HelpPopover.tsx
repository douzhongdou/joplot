import { useEffect, useRef, useState } from 'react'
import {
  CircleHelp,
  Mouse,
  Move,
  SquareDashedMousePointer,
  Maximize2,
} from 'lucide-react'
import { useI18n } from '../i18n'

export function HelpPopover() {
  const { t } = useI18n()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      if (target && rootRef.current?.contains(target)) return
      setOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const items = [
    {
      icon: SquareDashedMousePointer,
      action: t('help.boxSelect.action'),
      description: t('help.boxSelect.description'),
    },
    {
      icon: Mouse,
      action: t('help.scrollZoom.action'),
      description: t('help.scrollZoom.description'),
    },
    {
      icon: Move,
      action: t('help.middlePan.action'),
      description: t('help.middlePan.description'),
    },
    {
      icon: Maximize2,
      action: t('help.doubleClickReset.action'),
      description: t('help.doubleClickReset.description'),
    },
  ]

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="flex size-9 items-center justify-center rounded-xl border-0 bg-transparent text-base-content/72 transition hover:bg-transparent hover:text-base-content focus-visible:ring-0"
        aria-label={t('help.label')}
        onClick={() => setOpen((current) => !current)}
      >
        <CircleHelp size={17} strokeWidth={2.1} className="shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-[calc(var(--radius-box)+0.25rem)] border border-base-300 bg-base-100 p-4 shadow-xl">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-base-content/45">
            {t('help.title')}
          </div>
          <div className="grid gap-3">
            {items.map(({ icon: Icon, action, description }) => (
              <div key={action} className="flex items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-base-200 text-base-content/65">
                  <Icon size={16} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-base-content">{action}</div>
                  <div className="text-xs text-base-content/55">{description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
