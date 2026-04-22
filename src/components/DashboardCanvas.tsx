import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { ChartCard, DashboardLayout } from '../types'

const GRID_COLUMNS = 12
const GRID_ROW_HEIGHT = 72
const MIN_ROWS = 10

interface GestureState {
  cardId: string
  mode: 'drag' | 'resize'
  originX: number
  originY: number
  startLayout: DashboardLayout
}

interface Props {
  cards: ChartCard[]
  selectedCardId: string | null
  onSelectCard: (cardId: string) => void
  onLayoutChange: (cardId: string, layout: DashboardLayout) => void
  renderCard: (card: ChartCard, controls: {
    selected: boolean
    onSelect: () => void
    onDragStart: (event: ReactPointerEvent<HTMLElement>) => void
    onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  }) => ReactNode
}

export function DashboardCanvas({
  cards,
  selectedCardId,
  onSelectCard,
  onLayoutChange,
  renderCard,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [gesture, setGesture] = useState<GestureState | null>(null)

  const totalRows = useMemo(() => {
    const occupiedRows = cards.map((card) => card.layout.y + card.layout.h)
    return Math.max(MIN_ROWS, ...occupiedRows)
  }, [cards])

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth)
      }
    }

    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!gesture || !containerWidth) {
      return
    }

    const cellWidth = containerWidth / GRID_COLUMNS
    const activeGesture = gesture

    function handlePointerMove(event: globalThis.PointerEvent) {
      const deltaColumns = Math.round((event.clientX - activeGesture.originX) / cellWidth)
      const deltaRows = Math.round((event.clientY - activeGesture.originY) / GRID_ROW_HEIGHT)

      const nextLayout =
        activeGesture.mode === 'drag'
          ? {
              ...activeGesture.startLayout,
              x: activeGesture.startLayout.x + deltaColumns,
              y: activeGesture.startLayout.y + deltaRows,
            }
          : {
              ...activeGesture.startLayout,
              w: activeGesture.startLayout.w + deltaColumns,
              h: activeGesture.startLayout.h + deltaRows,
            }

      onLayoutChange(activeGesture.cardId, nextLayout)
    }

    function handlePointerUp() {
      setGesture(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [containerWidth, gesture, onLayoutChange])

  function beginGesture(card: ChartCard, mode: GestureState['mode'], event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    onSelectCard(card.id)
    setGesture({
      cardId: card.id,
      mode,
      originX: event.clientX,
      originY: event.clientY,
      startLayout: card.layout,
    })
  }

  return (
    <section className="min-h-full">
      <div
        ref={containerRef}
        className="grid gap-4 bg-base-200 px-5 py-6"
        style={{
          gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${totalRows}, minmax(${GRID_ROW_HEIGHT}px, ${GRID_ROW_HEIGHT}px))`,
          backgroundImage: `
            linear-gradient(color-mix(in oklab, var(--color-base-content) 6%, transparent) 1px, transparent 1px),
            linear-gradient(90deg, color-mix(in oklab, var(--color-base-content) 6%, transparent) 1px, transparent 1px)
          `,
          backgroundSize: `100% ${GRID_ROW_HEIGHT}px, calc(100% / ${GRID_COLUMNS}) 100%`,
        }}
      >
        {cards.map((card) => (
          <div
            key={card.id}
            className="min-h-0 min-w-0"
            style={{
              gridColumn: `${card.layout.x + 1} / span ${card.layout.w}`,
              gridRow: `${card.layout.y + 1} / span ${card.layout.h}`,
            }}
          >
            {renderCard(card, {
              selected: selectedCardId === card.id,
              onSelect: () => onSelectCard(card.id),
              onDragStart: (event) => beginGesture(card, 'drag', event),
              onResizeStart: (event) => beginGesture(card, 'resize', event),
            })}
          </div>
        ))}
      </div>
    </section>
  )
}
