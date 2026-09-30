import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@joplot/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@joplot/ui/sheet'

interface Props {
  open: boolean
  eyebrow: string
  title: string
  closeLabel: string
  onClose: () => void
  children: ReactNode
}

export function MobileInspectorDrawer({ open, eyebrow, title, closeLabel, onClose, children }: Props) {
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className="max-h-[85vh] gap-0 rounded-t-2xl p-0 sm:hidden [&>button]:hidden"
      >
        <SheetHeader className="flex-row items-center justify-between gap-3 border-b px-5 py-4">
          <div className="grid min-w-0 gap-1 text-left">
            <span className="text-muted-foreground text-xs font-semibold uppercase tracking-[0.14em]">{eyebrow}</span>
            <SheetTitle className="text-lg">{title}</SheetTitle>
          </div>
          <SheetClose asChild>
            <Button variant="outline" size="icon" className="shrink-0 rounded-full" aria-label={closeLabel}>
              <X size={18} strokeWidth={2.1} />
            </Button>
          </SheetClose>
        </SheetHeader>

        <div className="max-h-[calc(85vh-5.25rem)] overflow-y-auto overscroll-contain">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
