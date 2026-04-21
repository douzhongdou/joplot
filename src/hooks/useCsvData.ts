import { useCallback, useState } from 'react'
import Papa from 'papaparse'
import type { CsvData } from '../types'
import { buildDataset } from '../lib/workbench'

export function useCsvData() {
  const [csv, setCsv] = useState<CsvData | null>(null)

  const parse = useCallback((file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (result) => {
        const headers = result.meta.fields ?? []
        const rows = (result.data as Record<string, string | undefined>[])
          .map((row) =>
            headers.reduce<Record<string, string>>((accumulator, header) => {
              accumulator[header] = row[header] ?? ''
              return accumulator
            }, {}),
          )

        setCsv(buildDataset(headers, rows, file.name))
      },
      error: (error) => console.error('CSV parse error:', error),
    })
  }, [])

  return { csv, parse }
}
