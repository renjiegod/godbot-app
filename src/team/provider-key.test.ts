import assert from 'node:assert/strict'
import test from 'node:test'
import { keyEditable, keyOutside, keyState } from './provider-key.ts'

test('a provider whose route names no key shows no key state, field or hint', () => {
  // What `providers` answers for a custom route added without a key.
  assert.equal(keyState(null), null)
  assert.equal(keyEditable(null), false)
  assert.equal(keyOutside(null), false)
  assert.equal(keyState(undefined), null)
})

test('a key Godbot keeps can be typed, replaced or removed', () => {
  assert.equal(keyState({ configured: false, writable: true }), 'missing')
  assert.equal(keyState({ configured: true, writable: true }), 'set')
  assert.equal(keyEditable({ configured: false, writable: true }), true)
  assert.equal(keyOutside({ configured: true, writable: true }), false)
})

test('a key from outside Godbot is named as such and offers no field', () => {
  assert.equal(keyState({ configured: true, writable: false }), 'outside')
  assert.equal(keyState({ configured: false, writable: false }), 'missing')
  assert.equal(keyEditable({ configured: true, writable: false }), false)
  assert.equal(keyOutside({ configured: true, writable: false }), true)
})
