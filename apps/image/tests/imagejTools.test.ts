import test from 'node:test'
import assert from 'node:assert/strict'
import { TOOLS, groupTools } from '../src/imagej/lib/tools.ts'

test('工具分组：三族各自成块，族内保持注册顺序，且不漏掉任何工具', () => {
  const groups = groupTools()
  assert.deepEqual(groups.map((entry) => entry.group), ['navigate', 'region', 'path'])
  for (const entry of groups) {
    assert.ok(entry.tools.length > 0)
    for (const tool of entry.tools) assert.equal(tool.group, entry.group)
  }
  // 分组只是换个顺序渲染，全体工具必须还在，且顺序与注册表一致。
  assert.deepEqual(
    groups.flatMap((entry) => entry.tools.map((tool) => tool.id)),
    TOOLS.map((tool) => tool.id),
  )
})

test('工具分组：注册表里没有工具时返回空数组', () => {
  assert.deepEqual(groupTools([]), [])
})
