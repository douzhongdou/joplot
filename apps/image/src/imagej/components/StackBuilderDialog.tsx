'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { Button } from '@joplot/ui/button'
import { Checkbox } from '@joplot/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@joplot/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@joplot/ui/table'
import type { ImagejCopy } from '../lib/i18n'

export interface StackRow {
  id: string
  title: string
  /** 文件最后修改时间（毫秒）；未知为 0。 */
  modified: number
  /** 文件字节数合计。 */
  size: number
  /** 该 tab 包含的文件数（合并后即 stack 页数）。 */
  pages: number
}

type SortKey = 'title' | 'modified' | 'size' | 'pages'

function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * 「创建 Stack」弹窗：在表格里勾选多个图像合成一个 Stack。
 *
 * 表格支持按文件名（自然序）、修改时间、大小、页数排序，方便在大量图像里挑。
 */
export function StackBuilderDialog({ open, onOpenChange, rows, copy, onCreate }: {
  open: boolean
  onOpenChange(open: boolean): void
  rows: readonly StackRow[]
  copy: ImagejCopy['stackBuilder']
  onCreate(ids: string[]): void
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('title')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  /* 每次打开重置选择与排序。 */
  useEffect(() => {
    if (!open) return
    setSelected(new Set())
    setSortKey('title')
    setSortDir('asc')
  }, [open])

  const sorted = useMemo(() => {
    const direction = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (sortKey === 'title') return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) * direction
      return (a[sortKey] - b[sortKey]) * direction
    })
  }, [rows, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }
  const toggleRow = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const allSelected = rows.length > 0 && selected.size === rows.length
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)))

  const sortableHead = (key: SortKey, label: string, className?: string) => (
    <TableHead className={className}>
      <Button type="button" variant="ghost" size="sm" className="-ml-2 h-7 gap-1 px-2" onClick={() => toggleSort(key)}>
        {label}
        {key === sortKey
          ? (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
          : <ChevronsUpDown size={12} className="text-base-content/35" />}
      </Button>
    </TableHead>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.hint}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto rounded-[var(--radius-field)] border border-base-300">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-base-100">
              <TableRow>
                <TableHead className="w-9">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label={copy.selectAll} />
                </TableHead>
                {sortableHead('title', copy.file)}
                {sortableHead('modified', copy.modified)}
                {sortableHead('size', copy.size)}
                {sortableHead('pages', copy.pages, 'text-right')}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <TableRow key={row.id} data-state={selected.has(row.id) ? 'selected' : undefined} className="cursor-pointer" onClick={() => toggleRow(row.id)}>
                  <TableCell className="w-9">
                    <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggleRow(row.id)} aria-label={row.title} onClick={(event) => event.stopPropagation()} />
                  </TableCell>
                  <TableCell className="max-w-[18rem] truncate font-medium" title={row.title}>{row.title}</TableCell>
                  <TableCell className="text-base-content/70">{row.modified ? new Date(row.modified).toLocaleString() : '—'}</TableCell>
                  <TableCell className="text-base-content/70">{formatBytes(row.size)}</TableCell>
                  <TableCell className="text-right tabular-nums text-base-content/70">{row.pages}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <span className="mr-auto self-center text-xs text-base-content/55">{selected.size} / {rows.length}</span>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{copy.cancel}</Button>
          <Button type="button" disabled={selected.size < 2} onClick={() => { onCreate([...selected]); onOpenChange(false) }}>{copy.create}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
