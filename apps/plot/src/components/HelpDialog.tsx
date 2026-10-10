'use client'

import { useState } from 'react'
import {
  CircleHelp,
  Mouse,
  Move,
  SquareDashedMousePointer,
  Maximize2,
} from 'lucide-react'
import { useI18n } from '../i18n'
import { Button } from '@joplot/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@joplot/ui/dialog'

export function HelpContent() {
  const { t } = useI18n()

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
    <div>
      <div className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wider">
        {t('help.title')}
      </div>
      <div className="grid gap-3">
        {items.map(({ icon: Icon, action, description }) => (
          <div key={action} className="flex items-start gap-3">
            <div className="bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
              <Icon size={16} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{action}</div>
              <div className="text-muted-foreground text-xs">{description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 操作说明弹窗；开关由外部控制（例如从菜单项打开）。 */
export function HelpDialog({ open, onOpenChange }: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('help.label')}</DialogTitle>
        </DialogHeader>
        <HelpContent />
      </DialogContent>
    </Dialog>
  )
}

/** 顶栏帮助图标按钮：点击打开操作说明弹窗。 */
export function HelpButton() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('help.label')}
        onClick={() => setOpen(true)}
      >
        <CircleHelp size={17} strokeWidth={2.1} />
      </Button>
      <HelpDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
