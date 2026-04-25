import { useMemo, useRef, useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useI18n } from '../i18n'
import type { CsvData } from '../types'

interface Props {
  dataset: CsvData
}

export function DataTable({ dataset }: Props) {
  const { formatNumber } = useI18n()
  const [sorting, setSorting] = useState<SortingState>([])
  const parentRef = useRef<HTMLDivElement>(null)

  const columns = useMemo(() => {
    const columnHelper = createColumnHelper<Record<string, string>>()
    return dataset.headers.map((header) =>
      columnHelper.accessor((row) => row[header] ?? '', {
        id: header,
        header: () => header,
        cell: (info) => info.getValue(),
        size: 160,
      }),
    )
  }, [dataset.headers])

  const data = useMemo(
    () => dataset.rows.map((row) => row.raw),
    [dataset.rows],
  )

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const { rows } = table.getRowModel()

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 20,
  })

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-base-200">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  className="h-10 cursor-pointer select-none whitespace-nowrap border-b border-base-300 px-4 text-left font-semibold text-base-content/70 hover:text-base-content"
                  style={{ width: header.getSize() }}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {{ asc: ' \u2191', desc: ' \u2193' }[header.column.getIsSorted() as string] ?? ''}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]

            return (
              <tr
                key={row.id}
                className="border-b border-base-300/50 hover:bg-base-200/50"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start - (rowVirtualizer.getVirtualItems()[0]?.start ?? 0)}px)`,
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="max-w-[200px] truncate px-4 text-base-content/80"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="sticky bottom-0 border-t border-base-300 bg-base-100 px-4 py-2 text-xs text-base-content/55">
        {formatNumber(dataset.rowCount)} rows
      </div>
    </div>
  )
}
