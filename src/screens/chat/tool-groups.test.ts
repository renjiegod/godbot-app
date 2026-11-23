import assert from 'node:assert/strict'
import test from 'node:test'
import { groupToolRows, type ItemRow } from './tool-groups.ts'

const tool = (key: string, turn = 1, sessionId = 'a'): ItemRow => ({
  key, item: { kind: 'tool', turn, sessionId },
})
const reply: ItemRow = { key: 'reply', item: { kind: 'bot', text: 'Progress update' } }

test('groups adjacent tools without crossing a reply, turn, or session', () => {
  const [one, two, three, four, five, six] = [tool('1'), tool('2'), tool('3'), tool('4', 2), tool('5', 2, 'b'), tool('6', 2, 'b')]
  assert.deepEqual(groupToolRows([one, two, reply, three, four, five, six]), [
    { key: 'tools:1', tools: [one, two] }, reply, three, four, { key: 'tools:5', tools: [five, six] },
  ])
})

test('keeps the group key as live calls arrive and settle', () => {
  const first = tool('1')
  const second = tool('2')
  assert.deepEqual(groupToolRows([first]), [first])
  const [group] = groupToolRows([first, second])
  const [appended] = groupToolRows([first, { ...second, item: { ...second.item, status: 'completed' } }, tool('3')])
  assert.equal(group.key, appended.key)
})
