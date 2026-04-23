import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useI18n } from '../i18n'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  description?: string
  disabled?: boolean
}

interface Props<T extends string = string> {
  value: T | null
  options: Array<SelectOption<T>>
  onChange: (value: T) => void
  placeholder?: string
  triggerAriaLabel?: string
  renderTrigger?: (selectedOption: SelectOption<T> | null, open: boolean) => ReactNode
  buttonClassName?: string
  menuClassName?: string
  align?: 'left' | 'right'
}

export function SelectMenu<T extends string = string>({
  value,
  options,
  onChange,
  placeholder,
  triggerAriaLabel,
  renderTrigger,
  buttonClassName = '',
  menuClassName = '',
  align = 'left',
}: Props<T>) {
  const { t } = useI18n()
  const rootRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const enabledOptions = useMemo(
    () => options.filter((option) => !option.disabled),
    [options],
  )
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )
  const resolvedPlaceholder = placeholder ?? t('common.selectPlaceholder')

  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null

      if (target && rootRef.current?.contains(target)) {
        return
      }

      setOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1)
      return
    }

    const selectedIndex = enabledOptions.findIndex((option) => option.value === selectedOption?.value)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
  }, [enabledOptions, open, selectedOption])

  useEffect(() => {
    if (!open || activeIndex < 0) {
      return
    }

    optionRefs.current[activeIndex]?.scrollIntoView({
      block: 'nearest',
    })
  }, [activeIndex, open])

  function commitSelection(nextValue: T) {
    onChange(nextValue)
    setOpen(false)
  }

  function moveActiveIndex(direction: 1 | -1) {
    if (enabledOptions.length === 0) {
      return
    }

    setActiveIndex((current) => {
      if (current < 0) {
        return 0
      }

      return (current + direction + enabledOptions.length) % enabledOptions.length
    })
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      moveActiveIndex(1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      moveActiveIndex(-1)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setOpen((current) => !current)
    }
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActiveIndex(1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActiveIndex(-1)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const activeOption = enabledOptions[activeIndex]

      if (activeOption) {
        commitSelection(activeOption.value)
      }
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        className={`flex h-12 w-full items-center gap-3 rounded-[var(--radius-field)] border border-base-300 bg-base-100 px-4 text-left text-sm text-base-content transition hover:border-primary/25 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${buttonClassName}`.trim()}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        {renderTrigger ? (
          renderTrigger(selectedOption, open)
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate text-base font-medium">
              {selectedOption?.label ?? resolvedPlaceholder}
            </span>
            <ChevronDown
              size={16}
              strokeWidth={2.1}
              className={`shrink-0 text-base-content/55 transition ${open ? 'rotate-180 text-primary' : ''}`}
              aria-hidden="true"
            />
          </>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-30 mt-2 max-h-64 min-w-full overflow-auto rounded-[calc(var(--radius-box)+0.25rem)] border border-base-300 bg-base-100 p-2 ${align === 'right' ? 'right-0' : 'left-0'} ${menuClassName}`.trim()}
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
        >
          <div className="grid gap-1">
            {options.map((option) => {
              const optionIndex = enabledOptions.findIndex((item) => item.value === option.value)
              const selected = option.value === value
              const active = optionIndex >= 0 && optionIndex === activeIndex

              return (
                <button
                  key={option.value}
                  ref={(node) => {
                    if (optionIndex >= 0) {
                      optionRefs.current[optionIndex] = node
                    }
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-field)] px-3 py-2 text-left transition ${
                    option.disabled
                      ? 'cursor-not-allowed text-base-content/35'
                      : selected
                        ? 'bg-primary/12 text-primary'
                        : active
                          ? 'bg-base-200 text-base-content'
                          : 'text-base-content hover:bg-base-200'
                  }`}
                  onPointerEnter={() => {
                    if (optionIndex >= 0) {
                      setActiveIndex(optionIndex)
                    }
                  }}
                  onClick={() => {
                    if (!option.disabled) {
                      commitSelection(option.value)
                    }
                  }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{option.label}</span>
                    {option.description && (
                      <span className="block truncate text-xs text-base-content/55">{option.description}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
