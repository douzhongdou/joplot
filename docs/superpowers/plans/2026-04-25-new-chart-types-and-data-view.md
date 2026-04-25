# New Chart Types & Data View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Add area/radar/heatmap chart types, default spline drawMode, and a data view with virtual scrolling.

**Architecture:** Extend existing ChartKind + DrawMode types, add new Plotly trace branches in ChartCard, create DataView/DataTable components with TanStack Table, wire up Navbar tab switching.

**Tech Stack:** React 19, TypeScript, Plotly.js, Tailwind CSS 4, Vite, @tanstack/react-table, @tanstack/react-virtual

---

### Task 1: Install TanStack dependencies

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Install packages**

```bash
cd d:/HQL/code/tool/joplot && pnpm add @tanstack/react-table @tanstack/react-virtual
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @tanstack/react-table and @tanstack/react-virtual"
```

---

### Task 2: Extend types — ChartKind, DrawMode, i18n

**Files:**
- Modify: `src/types.ts`
- Modify: `src/i18n/dictionaries/en.ts`
- Modify: `src/i18n/dictionaries/zh-CN.ts`
- Modify: `src/i18n/dictionaries/ja-JP.ts`

- [ ] **Step 1: Update types.ts**

In `src/types.ts`, change:
```typescript
export type ChartKind = 'line' | 'scatter' | 'bar' | 'stats' | 'area' | 'radar' | 'heatmap'
export type DrawMode = 'lines' | 'spline' | 'lines+markers' | 'markers'
```

- [ ] **Step 2: Update en.ts — add new chart kinds, drawModes, dataView**

Add to `chartKinds`:
```typescript
area: 'Area Chart',
radar: 'Radar Chart',
heatmap: 'Heatmap',
```

Add to `drawModes`:
```typescript
spline: 'Smooth Curve',
```

Add new `dataView` section:
```typescript
dataView: {
  tabLabel: 'Data',
  emptyState: 'Upload a data file first',
},
```

- [ ] **Step 3: Update zh-CN.ts**

Add to `chartKinds`:
```typescript
area: '面积图',
radar: '雷达图',
heatmap: '热力图',
```

Add to `drawModes`:
```typescript
spline: '平滑曲线',
```

Add new `dataView` section:
```typescript
dataView: {
  tabLabel: '数据',
  emptyState: '请先上传数据文件',
},
```

- [ ] **Step 4: Update ja-JP.ts** (same pattern as en, with Japanese)

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/i18n/dictionaries/
git commit -m "feat: extend ChartKind with area/radar/heatmap, DrawMode with spline, add i18n"
```

---

### Task 3: Update workbench defaults — spline as default drawMode

**Files:**
- Modify: `src/lib/workbench.ts`

- [ ] **Step 1: Change createCard default drawMode**

In `createCard()` at line 317, change:
```typescript
// Before:
drawMode: kind === 'scatter' ? 'markers' : 'lines',
// After:
drawMode: kind === 'scatter' ? 'markers' : 'spline',
```

Also update `createCardTitle()` to handle new types:
```typescript
case 'area':
  return '面积图'
case 'radar':
  return '雷达图'
case 'heatmap':
  return '热力图'
```

- [ ] **Step 2: Update tests**

Run: `pnpm test` to check existing tests pass with default change.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workbench.ts tests/
git commit -m "feat: change default drawMode to spline, add title fallbacks for new chart kinds"
```

---

### Task 4: Implement area chart rendering

**Files:**
- Modify: `src/components/ChartCard.tsx`

- [ ] **Step 1: Add area chart branch in plotData**

In the `plotData` useMemo (line 124), after the `bar` check, add area chart handling:

In the **aggregate path** (line 130-154), after the bar check:
```typescript
if (card.kind === 'area') {
  return {
    type: 'scattergl' as const,
    mode: card.drawMode === 'lines' ? 'lines' : card.drawMode === 'markers' ? 'markers' : 'lines',
    x: series.x,
    y: series.y,
    fill: 'tozeroy',
    fillcolor: `${color}33`,
    marker: { color, size: 6 },
    line: { color, width: card.lineWidth, shape: card.drawMode === 'spline' ? 'spline' : 'linear' },
    name: series.name,
    connectgaps: false,
  }
}
```

In the **raw path** (line 156-181), after the bar check:
```typescript
if (card.kind === 'area') {
  return {
    type: 'scattergl' as const,
    mode: card.drawMode === 'lines' ? 'lines' : card.drawMode === 'markers' ? 'markers' : 'lines',
    x,
    y,
    fill: 'tozeroy',
    fillcolor: `${series.color}33`,
    marker: { color: series.color, size: 6 },
    line: { color: series.color, width: card.lineWidth, shape: card.drawMode === 'spline' ? 'spline' : 'linear' },
    name: series.label,
    connectgaps: false,
  }
}
```

- [ ] **Step 2: Update scattergl traces for spline drawMode**

For existing `line` and `scatter` kinds, update the `line` property to include shape:
```typescript
line: { color: series.color, width: card.lineWidth, shape: card.drawMode === 'spline' ? 'spline' : 'linear' },
```

- [ ] **Step 3: Add kindLabels entry**

In ChartCard, add `area` to `kindLabels`:
```typescript
area: t('chartKinds.area'),
radar: t('chartKinds.radar'),
heatmap: t('chartKinds.heatmap'),
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ChartCard.tsx
git commit -m "feat: render area chart with fill and spline drawMode support"
```

---

### Task 5: Implement radar chart rendering

**Files:**
- Modify: `src/components/ChartCard.tsx`

- [ ] **Step 1: Add radar chart branch in plotData**

After area chart handling, add radar:
```typescript
if (card.kind === 'radar') {
  return validSeries.map(({ series, rows }) => {
    const theta = rows.map((row) => row.raw[card.xColumn] ?? '')
    const r = rows.map((row) => row.numeric[series.yColumn!])
    // Close the polygon
    const closedTheta = theta.length > 0 ? [...theta, theta[0]] : theta
    const closedR = r.length > 0 ? [...r, r[0]] : r

    return {
      type: 'scatterpolar' as const,
      mode: card.drawMode === 'markers' ? 'markers' : 'lines+markers',
      theta: closedTheta,
      r: closedR,
      fill: 'toself',
      fillcolor: `${series.color}22`,
      marker: { color: series.color, size: 6 },
      line: { color: series.color, width: card.lineWidth },
      name: series.label,
    }
  })
}
```

For aggregate mode with radar:
```typescript
if (card.kind === 'radar') {
  return toPlotSeries(aggregateResult).map((series, index) => {
    const color = getChartColor(index)
    const closedX = series.x.length > 0 ? [...series.x, series.x[0]] : series.x
    const closedY = series.y.length > 0 ? [...series.y, series.y[0]] : series.y

    return {
      type: 'scatterpolar' as const,
      mode: 'lines+markers',
      theta: closedX,
      r: closedY,
      fill: 'toself',
      fillcolor: `${color}22`,
      marker: { color, size: 6 },
      line: { color, width: card.lineWidth },
      name: series.name,
    }
  })
}
```

- [ ] **Step 2: Update plotLayout for radar**

Add polar axis config when card.kind is 'radar':
```typescript
polar: card.kind === 'radar' ? {
  radialaxis: { visible: card.showAxes, gridcolor: resolveThemeColor('--chart-grid', 'rgba(15, 23, 42, 0.08)') },
  angularaxis: { gridcolor: resolveThemeColor('--chart-grid', 'rgba(15, 23, 42, 0.08)') },
} : undefined,
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ChartCard.tsx
git commit -m "feat: render radar chart with scatterpolar and closed polygon"
```

---

### Task 6: Implement heatmap rendering

**Files:**
- Modify: `src/components/ChartCard.tsx`

- [ ] **Step 1: Add heatmap branch in plotData**

For heatmap, we need X × Y matrix from data:
```typescript
if (card.kind === 'heatmap') {
  // Use first series for heatmap
  const entry = validSeries[0]
  if (!entry) return []

  const xValues = [...new Set(entry.rows.map((row) => row.raw[card.xColumn] ?? ''))]
  // For Y axis, use a second column if available, or row index
  const yColumn = entry.series.yColumn
  const yValues = yColumn
    ? [...new Set(entry.rows.map((row) => row.raw[yColumn] ?? ''))]
    : entry.rows.map((_, i) => String(i))

  // Build z matrix
  const z: number[][] = yValues.map((yVal) =>
    xValues.map((xVal) => {
      const matchingRows = entry.rows.filter((row) => {
        const xMatch = (row.raw[card.xColumn] ?? '') === xVal
        const yMatch = yColumn ? (row.raw[yColumn] ?? '') === yVal : true
        return xMatch && yMatch
      })
      // Default aggregation: count
      return matchingRows.length
    })
  )

  return [{
    type: 'heatmap' as const,
    x: xValues,
    y: yValues,
    z,
    colorscale: 'Viridis',
    showscale: true,
  }]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ChartCard.tsx
git commit -m "feat: render heatmap with X×Y matrix from raw data"
```

---

### Task 7: Create DataTable component

**Files:**
- Create: `src/components/DataTable.tsx`

- [ ] **Step 1: Write the DataTable component**

```tsx
import { useMemo } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useState, useRef } from 'react'
import type { CsvData } from '../types'

interface Props {
  dataset: CsvData
}

export function DataTable({ dataset }: Props) {
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
      })
    )
  }, [dataset.headers])

  const data = useMemo(
    () => dataset.rows.map((row) => row.raw),
    [dataset.rows]
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
                  className="h-10 border-b border-base-300 px-4 text-left font-semibold text-base-content/70 cursor-pointer select-none hover:text-base-content"
                  style={{ width: header.getSize() }}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                  {{ asc: ' ↑', desc: ' ↓' }[header.column.getIsSorted() as string] ?? ''}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            return (
              <tr
                key={row.id}
                className="h-9 border-b border-base-300/50 hover:bg-base-200/50"
                style={{ height: virtualRow.size }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 text-base-content/80 truncate max-w-[200px]">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="sticky bottom-0 bg-base-100 border-t border-base-300 px-4 py-2 text-xs text-base-content/55">
        {dataset.rowCount.toLocaleString()} rows
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/DataTable.tsx
git commit -m "feat: DataTable component with TanStack Table and virtual scrolling"
```

---

### Task 8: Create DataView component with file tabs

**Files:**
- Create: `src/components/DataView.tsx`

- [ ] **Step 1: Write the DataView component**

```tsx
import { useMemo } from 'react'
import { DataTable } from './DataTable'
import type { CsvData } from '../types'
import { useI18n } from '../i18n'

interface Props {
  datasets: CsvData[]
  activeDatasetId: string | null
  onSelectDataset: (id: string) => void
}

export function DataView({ datasets, activeDatasetId, onSelectDataset }: Props) {
  const { t } = useI18n()

  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId) ?? datasets[0] ?? null,
    [datasets, activeDatasetId]
  )

  if (datasets.length === 0) {
    return (
      <div className="grid h-full place-items-center text-base-content/55">
        {t('dataView.emptyState')}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end gap-0 border-b border-base-300 bg-base-100 px-4 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
        {datasets.map((dataset) => (
          <button
            key={dataset.id}
            type="button"
            className={`shrink-0 max-w-40 truncate border-b-2 px-4 py-3 text-sm font-medium transition ${
              dataset.id === activeDataset?.id
                ? 'border-primary text-primary'
                : 'border-transparent text-base-content/60 hover:text-base-content'
            }`}
            title={dataset.fileName}
            onClick={() => onSelectDataset(dataset.id)}
          >
            {dataset.fileName}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {activeDataset && <DataTable dataset={activeDataset} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/DataView.tsx
git commit -m "feat: DataView component with scrollable file tabs"
```

---

### Task 9: Wire up AppNavbar tab switch + App state

**Files:**
- Modify: `src/components/AppNavbar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Update AppNavbar to accept viewMode props**

Update AppNavbar to accept `viewMode` and `onChangeViewMode` props:
```tsx
interface Props {
  viewMode: 'chart' | 'data'
  onChangeViewMode: (mode: 'chart' | 'data') => void
}

export function AppNavbar({ viewMode, onChangeViewMode }: Props) {
  const { language, setLanguage, t } = useI18n()
  // ... existing code ...

  return (
    <header className="flex h-[var(--navbar-height)] items-center justify-between gap-4 border-b border-base-300 bg-base-100 px-5">
      <div className="flex min-w-0 items-center gap-3">
        {/* existing logo */}
        <div className="flex items-center gap-1 ml-4">
          <button
            type="button"
            className={`inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold transition ${
              viewMode === 'chart'
                ? 'bg-primary text-primary-content'
                : 'text-base-content/60 hover:text-base-content'
            }`}
            onClick={() => onChangeViewMode('chart')}
          >
            Chart
          </button>
          <button
            type="button"
            className={`inline-flex h-9 items-center rounded-lg px-4 text-sm font-semibold transition ${
              viewMode === 'data'
                ? 'bg-primary text-primary-content'
                : 'text-base-content/60 hover:text-base-content'
            }`}
            onClick={() => onChangeViewMode('data')}
          >
            {t('dataView.tabLabel')}
          </button>
        </div>
      </div>
      {/* existing language selector */}
    </header>
  )
}
```

- [ ] **Step 2: Update App.tsx to manage viewMode and render DataView**

Add state:
```typescript
const [viewMode, setViewMode] = useState<'chart' | 'data'>('chart')
```

Pass to AppNavbar:
```tsx
<AppNavbar viewMode={viewMode} onChangeViewMode={setViewMode} />
```

In the main content area, conditionally render:
```tsx
{hasDatasets && viewMode === 'data' && (
  <DataView
    datasets={datasets}
    activeDatasetId={activeDatasetId}
    onSelectDataset={setActiveDatasetId}
  />
)}
```

When switching to chart mode, render existing DashboardCanvas. When switching to data mode, render DataView instead. Hide CardInspector in data mode.

- [ ] **Step 3: Commit**

```bash
git add src/components/AppNavbar.tsx src/App.tsx
git commit -m "feat: wire up chart/data view mode toggle in Navbar and App"
```

---

### Task 10: Update WorkbenchHeader and CardInspector for new chart types

**Files:**
- Modify: `src/components/WorkbenchHeader.tsx`
- Modify: `src/components/CardInspector.tsx`

- [ ] **Step 1: Add new chart type options to WorkbenchHeader**

Add new Lucide icons and componentOptions:
```tsx
import { /* existing icons */ ChartArea, Radar, Grid3X3 } from 'lucide-react'

const componentOptions = [
  { kind: 'line', label: t('chartKinds.line'), icon: ChartLine },
  { kind: 'area', label: t('chartKinds.area'), icon: ChartArea },
  { kind: 'scatter', label: t('chartKinds.scatter'), icon: ChartScatter },
  { kind: 'bar', label: t('chartKinds.bar'), icon: ChartColumn },
  { kind: 'radar', label: t('chartKinds.radar'), icon: Radar },
  { kind: 'heatmap', label: t('chartKinds.heatmap'), icon: Grid3X3 },
  { kind: 'stats', label: t('chartKinds.stats'), icon: BadgeInfo },
]
```

- [ ] **Step 2: Add new chart type options to CardInspector kindOptions**

```tsx
const kindOptions = [
  { value: 'line', label: t('chartKinds.line') },
  { value: 'area', label: t('chartKinds.area') },
  { value: 'scatter', label: t('chartKinds.scatter') },
  { value: 'bar', label: t('chartKinds.bar') },
  { value: 'radar', label: t('chartKinds.radar') },
  { value: 'heatmap', label: t('chartKinds.heatmap') },
  { value: 'stats', label: t('chartKinds.stats') },
]
```

- [ ] **Step 3: Add spline to drawModeOptions**

```tsx
const drawModeOptions = [
  { value: 'spline', label: t('drawModes.spline') },
  { value: 'lines', label: t('drawModes.lines') },
  { value: 'lines+markers', label: t('drawModes.lines+markers') },
  { value: 'markers', label: t('drawModes.markers') },
]
```

- [ ] **Step 4: Commit**

```bash
git add src/components/WorkbenchHeader.tsx src/components/CardInspector.tsx
git commit -m "feat: add area/radar/heatmap options to header and inspector, spline to drawModes"
```

---

### Task 11: Typecheck and tests

- [ ] **Step 1: Run typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Run tests**

```bash
pnpm test
```

- [ ] **Step 3: Fix any failures**

- [ ] **Step 4: Build verification**

```bash
pnpm build
```

- [ ] **Step 5: Final commit (if fixes needed)**

```bash
git add -A
git commit -m "fix: resolve type errors and test failures for new chart types and data view"
```
