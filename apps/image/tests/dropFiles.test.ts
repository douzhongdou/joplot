import test from 'node:test'
import assert from 'node:assert/strict'
import { readDroppedContent, readDirectory, type DropEntry } from '../src/imagej/lib/dropFiles.ts'

function fileEntry(name: string): DropEntry {
  return { isFile: true, isDirectory: false, name, file: (ok) => ok(new File([new Uint8Array([1, 2, 3])], name)) }
}

function dirEntry(name: string, children: DropEntry[]): DropEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let sent = false
      return { readEntries: (ok) => { if (sent) { ok([]); return } sent = true; ok(children) } }
    },
  }
}

function itemSource(entries: DropEntry[]) {
  return { items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })) }
}

test('readDroppedContent 把散落文件作为独立文件返回', async () => {
  const content = await readDroppedContent(itemSource([fileEntry('a.png'), fileEntry('b.tif')]))
  assert.deepEqual(content.files.map((file) => file.name), ['a.png', 'b.tif'])
  assert.equal(content.folders.length, 0)
})

test('readDroppedContent 递归展开文件夹（含子目录）', async () => {
  const folder = dirEntry('series', [fileEntry('01.tif'), dirEntry('nested', [fileEntry('02.tif')]), fileEntry('03.tif')])
  const content = await readDroppedContent(itemSource([folder]))
  assert.equal(content.folders.length, 1)
  assert.equal(content.folders[0]!.name, 'series')
  assert.deepEqual(content.folders[0]!.files.map((file) => file.name).sort(), ['01.tif', '02.tif', '03.tif'])
  assert.equal(content.files.length, 0)
})

test('readDroppedContent 混合拖放：文件夹与散落文件分开', async () => {
  const content = await readDroppedContent(itemSource([dirEntry('grp', [fileEntry('x.tif')]), fileEntry('loose.png')]))
  assert.deepEqual(content.files.map((file) => file.name), ['loose.png'])
  assert.deepEqual(content.folders.map((folder) => folder.name), ['grp'])
})

test('readDroppedContent 在没有 entry 时回退到 files 列表', async () => {
  const files = [new File([new Uint8Array([1])], 'fallback.png')]
  const content = await readDroppedContent({ files })
  assert.deepEqual(content.files.map((file) => file.name), ['fallback.png'])
  assert.equal(content.folders.length, 0)
})

test('readDirectory 读取空目录返回空数组', async () => {
  assert.deepEqual(await readDirectory(dirEntry('empty', [])), [])
})
