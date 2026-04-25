import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACCEPTED_UPLOAD_TYPES,
  buildUploadHint,
  getUploadCopy,
  isCsvLikeFile,
  pickCsvFiles,
  pickFirstCsvFile,
} from '../src/lib/upload.ts'

test('isCsvLikeFile accepts csv and excel extensions case-insensitively', () => {
  assert.equal(isCsvLikeFile({ name: 'sales.CSV' }), true)
  assert.equal(isCsvLikeFile({ name: 'sales.csv' }), true)
  assert.equal(isCsvLikeFile({ name: 'sales.xlsx' }), true)
  assert.equal(isCsvLikeFile({ name: 'sales.XLS' }), true)
})

test('isCsvLikeFile accepts spreadsheet mime types', () => {
  assert.equal(
    isCsvLikeFile({
      name: 'upload',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    true,
  )
  assert.equal(
    isCsvLikeFile({
      name: 'legacy',
      type: 'application/vnd.ms-excel',
    }),
    true,
  )
})

test('isCsvLikeFile rejects non-spreadsheet files', () => {
  assert.equal(isCsvLikeFile({ name: 'notes.txt' }), false)
  assert.equal(isCsvLikeFile({ name: 'archive.zip' }), false)
})

test('pickCsvFiles returns every csv or excel candidate from a mixed list in original order', () => {
  const files = [
    { name: 'notes.txt' },
    { name: 'report.csv' },
    { name: 'backup.CSV' },
    { name: 'sheet.xlsx' },
    { name: 'legacy.xls' },
  ]

  assert.deepEqual(pickCsvFiles(files), [
    { name: 'report.csv' },
    { name: 'backup.CSV' },
    { name: 'sheet.xlsx' },
    { name: 'legacy.xls' },
  ])
})

test('pickFirstCsvFile returns the first supported spreadsheet file from a mixed list', () => {
  const files = [
    { name: 'notes.txt' },
    { name: 'report.xlsx' },
    { name: 'backup.csv' },
  ]

  assert.deepEqual(pickFirstCsvFile(files), { name: 'report.xlsx' })
})

test('pickFirstCsvFile returns null when the list has no supported spreadsheet file', () => {
  assert.equal(
    pickFirstCsvFile([
      { name: 'notes.txt' },
      { name: 'report.pdf' },
    ]),
    null,
  )
})

test('buildUploadHint describes page-wide multi-file drag upload in Chinese by default', () => {
  assert.equal(
    buildUploadHint(false),
    '拖拽一个或多个 CSV / Excel 到页面任意位置，或点击上传',
  )
})

test('buildUploadHint switches to add-more wording after datasets are loaded', () => {
  assert.equal(
    buildUploadHint(true),
    '拖拽一个或多个 CSV / Excel 到页面任意位置，或点击添加',
  )
})

test('buildUploadHint supports english and japanese dictionaries', () => {
  assert.equal(
    buildUploadHint(false, 'en'),
    'Drag one or more CSV or Excel files anywhere on the page, or click Upload',
  )
  assert.equal(
    buildUploadHint(true, 'ja-JP'),
    '1 件以上の CSV / Excel をページ上の任意の場所にドロップするか、追加をクリックしてください',
  )
})

test('accepted upload types include csv and excel extensions', () => {
  assert.equal(ACCEPTED_UPLOAD_TYPES, '.csv,.xlsx,.xls')
})

test('getUploadCopy exposes localized upload UI labels for supported formats', () => {
  assert.deepEqual(getUploadCopy('zh-CN'), {
    upload: '拖拽一个或多个 CSV / Excel 到页面任意位置，或点击上传',
    add: '拖拽一个或多个 CSV / Excel 到页面任意位置，或点击添加',
    uploadButton: '上传数据',
    addButton: '添加数据',
    importTitle: '导入数据',
    importDescription: '支持一次导入多个 CSV 或 Excel 文件。',
    overlayBadge: '拖拽上传',
    overlayTitle: '把 CSV / Excel 拖到这里，松开后自动出图',
    heroTitle: '把 CSV 拖进来，立刻出图',
    heroSubtitle: '支持直接拖拽或点击上传。导入后自动生成图表，可以继续复制或下载。',
    sampleButton: '查看示例数据',
    sampleTitle: '示例数据',
    sampleDescription: '内置一份 CSV 示例，可直接载入。',
    proofPoints: ['支持 CSV / Excel', '本地处理', '一键复制图片', '无需注册'],
  })
})

test('getUploadCopy provides hero and sample copy for english growth homepage', () => {
  assert.equal(getUploadCopy('en').heroTitle, 'Drop in a CSV and get a chart instantly')
  assert.equal(getUploadCopy('en').sampleButton, 'Open sample data')
  assert.equal(getUploadCopy('en').sampleTitle, 'Sample data')
})
