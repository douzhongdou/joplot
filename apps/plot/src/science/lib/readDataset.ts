import { parseDelimitedText, readSuperDataset, toSuperDatasetId } from '../../superplot/lib/parse.ts'
import type { SuperDataset } from '../../superplot/types.ts'

/** CSV/TSV remains streaming; spreadsheet code is loaded only for Excel files. */
export async function readScienceDataset(file: File): Promise<SuperDataset> {
  if (!/\.xlsx?$/i.test(file.name)) return readSuperDataset(file)

  const XLSX = await import('xlsx')
  const Papa = (await import('papaparse')).default
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const name = workbook.SheetNames[0]
  if (!name) throw new Error('The workbook has no worksheets')
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  })
  // The existing column parser consumes one physical line per row.
  const safeRows = rows.map((row) => row.map((cell) => String(cell ?? '').replace(/[\r\n]+/g, ' ')))
  return parseDelimitedText(Papa.unparse(safeRows), {
    id: toSuperDatasetId(file.name),
    fileName: `${file.name} · ${name}`,
    fileSize: file.size,
  })
}
