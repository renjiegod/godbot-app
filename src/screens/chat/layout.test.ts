import assert from 'node:assert/strict'
import test from 'node:test'
import { chatLayout } from './layout.ts'

test('the Web conversation default applies to Bot chats and keeps group bubbles', () => {
  for (const preference of [undefined, 'conversation', 'unknown']) {
    assert.equal(chatLayout(preference, true), 'conversation')
    assert.equal(chatLayout(preference, false), 'bubble')
  }
})

test('explicit Web layout preferences apply to Bot and group chats', () => {
  for (const preference of ['bubble', 'flat'] as const) {
    assert.equal(chatLayout(preference, true), preference)
    assert.equal(chatLayout(preference, false), preference)
  }
})
