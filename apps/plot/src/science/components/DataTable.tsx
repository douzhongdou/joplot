'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DatasetSummary, ScienceValue } from '../types.ts'
import type { ComputeHost, ComputeResult } from '../compute/host.ts'
import { valueRowCount, type DataTablePage } from '../lib/dataTable.ts'
import type { ScienceCopy } from '../lib/i18n.ts'

export type DataTableSource =
  | { kind: 'dataset'; dataset: DatasetSummary }
  | { kind: 'value'; value: ScienceValue }

export function dataTableTitle(source: DataTableSource): string {
  return source.kind === 'dataset' ? source.dataset.fileName : source.value.name
}

/** Worker 单页上限 200（`pageBounds` 会截断），取满以减少往返。 */
const PAGE_SIZE = 200
const ROW_HEIGHT = 30

/**
 * 主区域的表格视图：整块区域就是表格本身，没有卡片/标题/分页。
 * 数据按可视范围从 Worker 分页拉取，行由 TanStack Table 渲染、react-virtual 只挂载可见行。
 */
export function DataTable({
  source,
  host,
  copy,
  revision,
}: {
  source: DataTableSource
  host: Pick<ComputeHost, 'datasetPage' | 'valuePage'>
  copy: ScienceCopy
  /** 计算结果对象：身份变化意味着数据被重算，缓存页需要重取。 */
  revision: ComputeResult | null
}) {
  const sourceId = source.kind === 'dataset' ? source.dataset.id : source.value.id
  const estimatedTotal = source.kind === 'dataset' ? source.dataset.rowCount : valueRowCount(source.value)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<Record<number, DataTablePage>>({})
  const [error, setError] = useState('')
  /** 与 state 同步的缓存，供取页回调读取「已加载/在途」而无需等 React 提交。 */
  const pagesRef = useRef<Record<number, DataTablePage>>({})
  const inFlightRef = useRef<Set<number>>(new Set())
  /** 每次失效自增；旧世代的响应一律丢弃，避免清缓存后又被写回。 */
  const generationRef = useRef(0)

  const loadPage = useCallback((index: number) => {
    if (pagesRef.current[index] || inFlightRef.current.has(index)) {
      return
    }
    const generation = generationRef.current
    const offset = index * PAGE_SIZE
    inFlightRef.current.add(index)
    const request = source.kind === 'dataset'
      ? host.datasetPage(sourceId, offset, PAGE_SIZE)
      : host.valuePage(sourceId, offset, PAGE_SIZE)
    void request.then((page) => {
      if (generation !== generationRef.current) return
      pagesRef.current = { ...pagesRef.current, [index]: page }
      setPages(pagesRef.current)
    }).catch((cause: unknown) => {
      if (generation !== generationRef.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (generation === generationRef.current) {
        inFlightRef.current.delete(index)
      }
    })
  }, [host, source.kind, sourceId])

  // 结果重算 → 丢弃缓存页（保留滚动位置）；下面的取页 effect 会按需重拉。
  useEffect(() => {
    generationRef.current += 1
    inFlightRef.current = new Set()
    pagesRef.current = {}
    setPages({})
    setError('')
  }, [revision])

  const page = pages[0] ?? Object.values(pages)[0]
  const headers = page?.headers ?? []
  const total = page?.total ?? estimatedTotal
  const ready = headers.length > 0

  const rowVirtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const virtualItems = rowVirtualizer.getVirtualItems()
  const rangeStart = virtualItems.length > 0 ? virtualItems[0].index : 0
  const rangeEnd = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1

  // 只拉可视范围覆盖到的页（外加相邻各一页，滚动前先备好）。
  // 没有可视项（0 行数据 / 滚动容器尚未挂载）时至少拉第 0 页——表头只来自它。
  useEffect(() => {
    if (rangeEnd < rangeStart) {
      loadPage(0)
      return
    }
    const first = Math.max(0, Math.floor(rangeStart / PAGE_SIZE) - 1)
    const last = Math.floor(rangeEnd / PAGE_SIZE) + 1
    for (let index = first; index <= last; index += 1) {
      loadPage(index)
    }
  }, [loadPage, rangeStart, rangeEnd, revision])

  const data = useMemo(() => {
    const rows: string[][] = []
    for (let index = rangeStart; index <= rangeEnd; index += 1) {
      const loaded = pages[Math.floor(index / PAGE_SIZE)]
      rows.push(loaded ? loaded.rows[index - loaded.offset] ?? [] : [])
    }
    return rows
  }, [pages, rangeStart, rangeEnd])

  const columns = useMemo<ColumnDef<string[]>[]>(() => [
    {
      id: '#',
      size: 72,
      header: () => '#',
      // 行号取自 row id（窗口内的绝对下标），换页/滚动都保持连续。
      cell: (info) => Number(info.row.id) + 1,
    },
    ...headers.map((header, columnIndex): ColumnDef<string[]> => ({
      id: `col-${columnIndex}`,
      size: 160,
      header: () => header,
      accessorFn: (row: string[]) => row[columnIndex] ?? '',
      cell: (info) => info.getValue() as string,
    })),
  ], [headers])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (_row, index) => String(rangeStart + index),
  })

  const rows = table.getRowModel().rows
  const totalSize = rowVirtualizer.getTotalSize()
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0

  if (!ready) {
    return (
      <div ref={scrollRef} className="h-[70vh] min-h-[320px] overflow-auto lg:h-auto lg:min-h-0 lg:flex-1">
        <p className="p-6 text-center text-xs text-base-content/40">
          {error ? `${copy.error}: ${error}` : estimatedTotal === 0 ? copy.emptyData : copy.loadingData}
        </p>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="h-[70vh] min-h-[320px] overflow-auto lg:h-auto lg:min-h-0 lg:flex-1">
      {error ? (
        <p role="alert" className="px-4 pt-3 text-xs text-destructive">{copy.error}: {error}</p>
      ) : null}

      <table className="w-max min-w-full border-collapse text-left text-xs">
        <caption className="sr-only">{dataTableTitle(source)}</caption>
        <thead className="sticky top-0 z-10">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  style={{ width: header.getSize(), minWidth: header.getSize() }}
                  className="h-9 whitespace-nowrap border-b border-base-300 bg-muted px-3 text-left font-semibold text-base-content/70"
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden="true" style={{ height: paddingTop }}>
              <td colSpan={columns.length} />
            </tr>
          )}
          {virtualItems.map((virtualRow) => {
            const row = rows[virtualRow.index - rangeStart]
            if (!row) return null
            return (
              <tr
                key={row.id}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className="border-b border-base-300/40 hover:bg-muted/50"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="max-w-72 truncate whitespace-nowrap px-3 py-1.5 font-mono">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            )
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden="true" style={{ height: paddingBottom }}>
              <td colSpan={columns.length} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
