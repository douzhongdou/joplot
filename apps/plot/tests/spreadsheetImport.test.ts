import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'

import { ParseFailureError, readSpreadsheetFile } from '../src/lib/spreadsheetImport.ts'

test('readSpreadsheetFile parses csv files into a dataset', async () => {
  const file = new File(
    ['name,value\nNorth,10\nSouth,20\n'],
    'regions.csv',
    { type: 'text/csv' },
  )

  const dataset = await readSpreadsheetFile(file, 'regions')

  assert.deepEqual(dataset.headers, ['name', 'value'])
  assert.equal(dataset.fileName, 'regions.csv')
  assert.equal(dataset.rowCount, 2)
  assert.deepEqual(dataset.rows.map((row) => row.raw), [
    { name: 'North', value: '10' },
    { name: 'South', value: '20' },
  ])
})

test('readSpreadsheetFile parses the first worksheet from xlsx files into a dataset', async () => {
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.json_to_sheet([
    { month: 'Jan', revenue: 12, note: '' },
    { month: 'Feb', revenue: 18, note: 'promo' },
  ])
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Summary')

  const file = new File(
    [XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })],
    'report.xlsx',
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  )

  const dataset = await readSpreadsheetFile(file, 'report')

  assert.deepEqual(dataset.headers, ['month', 'revenue', 'note'])
  assert.equal(dataset.fileName, 'report.xlsx')
  assert.equal(dataset.rowCount, 2)
  assert.deepEqual(dataset.rows.map((row) => row.raw), [
    { month: 'Jan', revenue: '12', note: '' },
    { month: 'Feb', revenue: '18', note: 'promo' },
  ])
})

test('readSpreadsheetFile rejects csv-like files that do not produce usable chart data', async () => {
  const file = new File(
    ['PK\u0003\u0004word/document.xml'],
    'fake.csv',
    { type: 'text/csv' },
  )

  await assert.rejects(
    () => readSpreadsheetFile(file, 'fake'),
    (error: unknown) => (
      error instanceof ParseFailureError
      && error.reason === 'invalid_format'
    ),
  )
})
