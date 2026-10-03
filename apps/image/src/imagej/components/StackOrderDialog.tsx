'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@joplot/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@joplot/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@joplot/ui/table'
import type { ImagejCopy } from '../lib/i18n'

/**
 * 「调整 Stack 顺序」弹窗：用上下箭头重排 stack 里的页面，应用后按新顺序重建。
 */
export function StackOrderDialog({ open, onOpenChange, names, fileLabel, copy, onApply }: {
  open: boolean
  onOpenChange(open: boolean): void
  names: readonly string[]
  fileLabel: string
  copy: ImagejCopy['reorder']
  onApply(order: number[]): void
}) {
  const [order, setOrder] = useState<number[]>([])

  useEffect(() => { if (open) setOrder(names.map((_, index) => index)) }, [open, names])

  const move = (from: number, to: number) => setOrder((prev) => {
    if (to < 0 || to >= prev.length) return prev
    const next = [...prev]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item!)
    return next
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.hint}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto rounded-[var(--radius-field)] border border-base-300">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-base-100">
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>{fileLabel}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.map((fileIndex, position) => (
                <TableRow key={fileIndex}>
                  <TableCell className="tabular-nums text-base-content/55">{position + 1}</TableCell>
                  <TableCell className="max-w-[20rem] truncate" title={names[fileIndex]}>{names[fileIndex]}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`${copy.up} ${position + 1}`} disabled={position === 0} onClick={() => move(position, position - 1)}>
                        <ChevronUp size={14} />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`${copy.down} ${position + 1}`} disabled={position === order.length - 1} onClick={() => move(position, position + 1)}>
                        <ChevronDown size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{copy.cancel}</Button>
          <Button type="button" onClick={() => { onApply(order); onOpenChange(false) }}>{copy.apply}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
