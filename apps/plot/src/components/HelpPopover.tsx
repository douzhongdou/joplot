import {
  CircleHelp,
  Mouse,
  Move,
  SquareDashedMousePointer,
  Maximize2,
} from 'lucide-react'
import { useI18n } from '../i18n'
import { Button } from '@joplot/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@joplot/ui/popover'

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

export function HelpPopover() {
  const { t } = useI18n()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('help.label')}>
          <CircleHelp size={17} strokeWidth={2.1} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <HelpContent />
      </PopoverContent>
    </Popover>
  )
}
