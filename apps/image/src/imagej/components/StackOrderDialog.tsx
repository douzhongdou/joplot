'use client'

import { useEffect, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { Button } from '@joplot/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@joplot/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@joplot/ui/table'
import type { ImagejCopy } from '../lib/i18n'

function SortableRow({ id, position, name, dragLabel }: { id: number; position: number; name: string; dragLabel: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-10 bg-base-200 shadow-sm' : 'bg-base-100'}
    >
      <TableCell className="w-14 tabular-nums text-base-content/55">{position + 1}</TableCell>
      <TableCell className="w-8">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={dragLabel}
          className="cursor-grab touch-none active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </Button>
      </TableCell>
      <TableCell className="max-w-[20rem] truncate" title={name}>{name}</TableCell>
    </TableRow>
  )
}

/**
 * 「调整 Stack 顺序」弹窗：用 dnd-kit 拖拽行重排页面，应用后按新顺序重建。
 * 拖拽手柄同时支持键盘（Space 提起、方向键移动）。
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrder((prev) => {
      const from = prev.indexOf(Number(active.id))
      const to = prev.indexOf(Number(over.id))
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.hint}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto rounded-[var(--radius-field)] border border-base-300">
          <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-base-100">
                <TableRow>
                  <TableHead className="w-14">#</TableHead>
                  <TableHead className="w-8" />
                  <TableHead>{fileLabel}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <SortableContext items={order} strategy={verticalListSortingStrategy}>
                  {order.map((fileIndex, position) => (
                    <SortableRow key={fileIndex} id={fileIndex} position={position} name={names[fileIndex] ?? ''} dragLabel={copy.drag} />
                  ))}
                </SortableContext>
              </TableBody>
            </Table>
          </DndContext>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{copy.cancel}</Button>
          <Button type="button" onClick={() => { onApply(order); onOpenChange(false) }}>{copy.apply}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
