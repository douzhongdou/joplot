import Papa from 'papaparse'
import * as XLSX from 'xlsx'

import type { RawCsvRow } from '../types'
import { buildDataset } from './workbench.ts'

function isExcelFile(file: File) {
  const name = file.name.trim().toLowerCase()
  return name.endsWith('.xlsx') || name.endsWith('.xls')
}

function normalizeHeaders(row: unknown[]): string[] {
  return row.map((cell, index) => {
    const header = String(cell ?? '').trim()
    return header || `column_${index + 1}`
  })
}

function normalizeRow(headers: string[], row: unknown[]): RawCsvRow {
  return headers.reduce<RawCsvRow>((accumulator, header, index) => {
    accumulator[header] = String(row[index] ?? '')
    return accumulator
  }, {})
}

function hasRowValue(row: RawCsvRow) {
  return Object.values(row).some((value) => value.trim() !== '')
}

async function parseCsvFile(file: File, datasetId: string) {
  const text = await file.text()

  return new Promise<ReturnType<typeof buildDataset>>((resolve, reject) => {
    Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (result) => {
        const headers = result.meta.fields ?? []
        const rows = (result.data as Record<string, string | undefined>[])
          .map((row) =>
            headers.reduce<RawCsvRow>((accumulator, header) => {
              accumulator[header] = row[header] ?? ''
              return accumulator
            }, {}),
          )

        resolve(buildDataset(headers, rows, file.name, datasetId))
      },
      error: (error: Error) => reject(error),
    })
  })
}

async function parseExcelFile(file: File, datasetId: string) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]

  if (!firstSheetName) {
    return buildDataset([], [], file.name, datasetId)
  }

  const worksheet = workbook.Sheets[firstSheetName]
  const grid = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  })

  const [headerRow = [], ...dataRows] = grid
  const headers = normalizeHeaders(headerRow)
  const rows = dataRows
    .map((row) => normalizeRow(headers, row))
    .filter((row) => hasRowValue(row))

  return buildDataset(headers, rows, file.name, datasetId)
}

export async function readSpreadsheetFile(file: File, datasetId: string) {
  if (isExcelFile(file)) {
    return parseExcelFile(file, datasetId)
  }

  return parseCsvFile(file, datasetId)
}
