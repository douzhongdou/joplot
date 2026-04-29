import { ChartColumn, SlidersHorizontal, TableProperties } from 'lucide-react'
import { useI18n } from '../i18n'

interface Props {
  activeView: 'chart' | 'data'
  actionsOpen: boolean
  onSelectView: (mode: 'chart' | 'data') => void
  onToggleActions: () => void
}

const itemClass = 'inline-flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1 text-[11px] font-semibold leading-none transition'

export function MobileBottomNav({
  activeView,
  actionsOpen,
  onSelectView,
  onToggleActions,
}: Props) {
  const { t } = useI18n()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-base-300 bg-base-100/96 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.35rem)] pt-1.5 backdrop-blur-xl sm:hidden">
      <div className="mx-auto grid h-12 max-w-md grid-cols-3 gap-1">
        <button
          type="button"
          className={`${itemClass} ${activeView === 'chart' && !actionsOpen ? 'bg-primary text-primary-content' : 'text-base-content/68 hover:text-base-content'}`}
          onClick={() => onSelectView('chart')}
        >
          <ChartColumn size={16} strokeWidth={2.1} />
          <span>{t('dataView.chartLabel')}</span>
        </button>

        <button
          type="button"
          className={`${itemClass} ${activeView === 'data' ? 'bg-primary text-primary-content' : 'text-base-content/68 hover:text-base-content'}`}
          onClick={() => onSelectView('data')}
        >
          <TableProperties size={16} strokeWidth={2.1} />
          <span>{t('dataView.tabLabel')}</span>
        </button>

        <button
          type="button"
          className={`${itemClass} ${actionsOpen ? 'bg-primary text-primary-content' : 'text-base-content/68 hover:text-base-content'}`}
          onClick={onToggleActions}
        >
          <SlidersHorizontal size={16} strokeWidth={2.1} />
          <span>{t('mobileNav.actions')}</span>
        </button>
      </div>
    </nav>
  )
}
