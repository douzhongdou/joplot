import { type ReactNode, useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'

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
  triggerSize?: 'sm' | 'default'
}

// Radix Select forbids empty-string item values; map them to a sentinel.
const EMPTY_VALUE = '__selectmenu_empty__'

export function SelectMenu<T extends string = string>({
  value,
  options,
  onChange,
  placeholder,
  triggerAriaLabel,
  renderTrigger,
  buttonClassName,
  menuClassName,
  align = 'left',
  triggerSize = 'default',
}: Props<T>) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  )
  const resolvedPlaceholder = placeholder ?? t('common.selectPlaceholder')
  const radixValue = value === '' ? EMPTY_VALUE : (value ?? '')

  return (
    <Select
      value={radixValue}
      onValueChange={(nextValue) => onChange((nextValue === EMPTY_VALUE ? '' : nextValue) as T)}
      open={open}
      onOpenChange={setOpen}
    >
      <SelectTrigger
        aria-label={triggerAriaLabel}
        size={triggerSize}
        className={cn(
          'w-full',
          !selectedOption && 'text-muted-foreground',
          // renderTrigger supplies its own icon; hide the appended chevron.
          renderTrigger && '[&>svg]:hidden',
          buttonClassName,
        )}
      >
        {renderTrigger ? (
          <span className="flex min-w-0 flex-1 items-center justify-center">
            {renderTrigger(selectedOption, open)}
          </span>
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-left"
            title={selectedOption?.label ?? resolvedPlaceholder}
          >
            {selectedOption?.label ?? resolvedPlaceholder}
          </span>
        )}
      </SelectTrigger>
      <SelectContent align={align === 'right' ? 'end' : 'start'} className={menuClassName}>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value === '' ? EMPTY_VALUE : option.value}
            disabled={option.disabled}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate" title={option.label}>
                {option.label}
              </span>
              {option.description && (
                <span className="text-muted-foreground block truncate text-xs">
                  {option.description}
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
