interface LayoutShape {
  x: number
  y: number
  w: number
  h: number
}

interface CardLike<TLayout extends LayoutShape = LayoutShape> {
  id: string
  layout: TLayout
}

export const MOBILE_BREAKPOINT = 920
export const MOBILE_GRID_COLUMNS = 12

export function isMobileViewport(width: number) {
  return width <= MOBILE_BREAKPOINT
}

export function toResponsiveCardLayout<T extends CardLike>(cards: T[], mobile: boolean): T[] {
  if (!mobile) {
    return cards
  }

  let nextY = 0

  return cards.map((card) => {
    const nextCard = {
      ...card,
      layout: {
        ...card.layout,
        x: 0,
        y: nextY,
        w: MOBILE_GRID_COLUMNS,
      },
    }

    nextY += card.layout.h
    return nextCard
  })
}

export function shouldShowMobileInspector(
  hasDatasets: boolean,
  selectedCardId: string | null,
  mobile: boolean,
) {
  return hasDatasets && mobile && Boolean(selectedCardId)
}
