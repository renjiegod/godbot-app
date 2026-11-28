import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { layoutShortLabels, phaseTone, statusText, tint } from './work-board-theme.ts'

test('tint derives translucent rgba colors across hex and rgb theme tokens', () => {
  assert.equal(tint('#4d6bfe', 0.14), 'rgba(77,107,254,0.14)')
  assert.equal(tint('#abc', 0.2), 'rgba(170,187,204,0.2)')
  assert.equal(tint('rgb(10, 20, 30)', 0.5), 'rgba(10,20,30,0.5)')
})

test('phaseTone and statusText map board phases and catalog statuses', () => {
  const p = { accent: '#111', danger: '#222', star: '#333', green: '#444', ink2: '#555', ink3: '#666' }
  assert.equal(phaseTone('doing', p), '#111')
  assert.equal(phaseTone('attention', p), '#222')
  assert.equal(phaseTone('review', p), '#333')
  assert.equal(phaseTone('done', p), '#444')
  assert.equal(phaseTone('todo', p), '#555')
  assert.equal(phaseTone('history', p), '#666')
  assert.equal(statusText({ statusId: 'qa', mark: 'working', phase: 'doing' }, { statuses: [{ id: 'qa', name: 'QA Pass' }] }), 'QA Pass')
  assert.equal(statusText({ mark: 'reported', phase: 'review' }), 'Awaiting review')
  assert.equal(Object.keys(layoutShortLabels).length, 5)
})

test('Android work board screens integrate theme tokens, BotMark/RoomAvatar, and accessibility hooks', () => {
  const board = readFileSync(new URL('../screens/work-board.tsx', import.meta.url), 'utf8')
  const mgmt = readFileSync(new URL('../screens/work-board-management.tsx', import.meta.url), 'utf8')
  assert.match(board, /accessibilityLabel=\{c\.id \+ ' ' \+ c\.title/)
  assert.match(board, /<OwnerAvatar/)
  assert.match(board, /<StatusPill/)
  assert.match(board, /<PriorityBadge/)
  assert.match(board, /<BoardManagementSheet/)
  assert.match(board, /<ModalOptionPicker/)
  assert.match(mgmt, /<BotMark/)
  assert.match(mgmt, /<RoomAvatar/)
  assert.match(mgmt, /<CheckIcon/)
})
