import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildUploadHint,
  isCsvLikeFile,
  pickCsvFiles,
  pickFirstCsvFile,
} from '../src/lib/upload.ts'

test('isCsvLikeFile accepts csv extension case-insensitively', () => {
  assert.equal(isCsvLikeFile({ name: 'sales.CSV' }), true)
  assert.equal(isCsvLikeFile({ name: 'sales.csv' }), true)
})

test('isCsvLikeFile rejects non-csv files', () => {
  assert.equal(isCsvLikeFile({ name: 'sales.xlsx' }), false)
  assert.equal(isCsvLikeFile({ name: 'notes.txt' }), false)
})

test('pickCsvFiles returns every csv candidate from a mixed list in original order', () => {
  const files = [
    { name: 'notes.txt' },
    { name: 'report.csv' },
    { name: 'backup.CSV' },
    { name: 'sheet.xlsx' },
  ]

  assert.deepEqual(pickCsvFiles(files), [
    { name: 'report.csv' },
    { name: 'backup.CSV' },
  ])
})

test('pickFirstCsvFile returns the first csv candidate from a mixed list', () => {
  const files = [
    { name: 'notes.txt' },
    { name: 'report.csv' },
    { name: 'backup.csv' },
  ]

  assert.deepEqual(pickFirstCsvFile(files), { name: 'report.csv' })
})

test('pickFirstCsvFile returns null when the list has no csv file', () => {
  assert.equal(
    pickFirstCsvFile([
      { name: 'notes.txt' },
      { name: 'report.xlsx' },
    ]),
    null,
  )
})

test('buildUploadHint describes page-wide multi-file drag upload in Chinese by default', () => {
  assert.equal(
    buildUploadHint(false),
    '拖拽一个或多个 CSV 到页面任意位置，或点击上传',
  )
})

test('buildUploadHint switches to add-more wording after datasets are loaded', () => {
  assert.equal(
    buildUploadHint(true),
    '拖拽一个或多个 CSV 到页面任意位置，或点击添加',
  )
})

test('buildUploadHint supports english and japanese dictionaries', () => {
  assert.equal(
    buildUploadHint(false, 'en'),
    'Drag one or more CSV files anywhere on the page, or click Upload',
  )
  assert.equal(
    buildUploadHint(true, 'ja-JP'),
    '1 件以上の CSV をページ上の任意の場所にドラッグするか、追加をクリックしてください',
  )
})
