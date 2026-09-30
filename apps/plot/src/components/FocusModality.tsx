'use client'

import { useEffect } from 'react'

export function FocusModality() {
  useEffect(() => {
    const root = document.documentElement
    const usePointer = () => { root.dataset.inputModality = 'pointer' }
    const useKeyboard = (event: KeyboardEvent) => {
      if (!event.altKey && !event.ctrlKey && !event.metaKey) {
        root.dataset.inputModality = 'keyboard'
      }
    }

    window.addEventListener('pointermove', usePointer, true)
    window.addEventListener('pointerdown', usePointer, true)
    window.addEventListener('keydown', useKeyboard, true)
    return () => {
      window.removeEventListener('pointermove', usePointer, true)
      window.removeEventListener('pointerdown', usePointer, true)
      window.removeEventListener('keydown', useKeyboard, true)
    }
  }, [])

  return null
}
