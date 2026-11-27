import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelOption } from '../connection.ts'
import { boltsOf, shownOptions, shownValue, speedOf } from './model-options.ts'

// The speed control the computer describes for a Codex model with two extra tiers.
const SPEED: ModelOption = {
  id: 'speed', type: 'select', name: 'Speed', defaultValue: 'standard',
  values: [{ id: 'standard', name: 'Standard' }, { id: 'fast', name: 'Fast', description: '2x speed, increased usage' }, { id: 'ultrafast', name: 'Ultrafast' }],
}
const MAX_MODE: ModelOption = { id: 'acp:max_mode', type: 'toggle', name: 'Max Mode', defaultValue: false }

test('a Bot runs at its own speed when the model offers it, else at the agent default', () => {
  assert.deepEqual(speedOf([SPEED], undefined), { option: SPEED, valueId: 'standard', picked: false, bolts: 0 })
  assert.deepEqual(speedOf([SPEED], { speed: 'fast' }), { option: SPEED, valueId: 'fast', picked: true, bolts: 1 })
  assert.equal(speedOf([SPEED], { speed: 'ultrafast' })?.bolts, 2)
  // A pick another model offered is not this model's speed.
  assert.deepEqual(speedOf([{ ...SPEED, values: SPEED.values?.slice(0, 2) }], { speed: 'ultrafast' })?.valueId, 'standard')
  assert.equal(speedOf([{ ...SPEED, values: SPEED.values?.slice(0, 1) }], undefined), undefined)
  assert.equal(speedOf(undefined, { speed: 'fast' }), undefined)
})

test('only options with a choice show, speed first', () => {
  const lonely: ModelOption = { id: 'acp:x', type: 'select', values: [{ id: 'a' }] }
  assert.deepEqual(shownOptions([MAX_MODE, lonely, SPEED]).map(option => option.id), ['speed', 'acp:max_mode'])
  assert.equal(boltsOf(SPEED, 'standard'), 0)
  assert.equal(boltsOf(SPEED, 'missing'), 0)
})

test('a control shows the pick, or the agent default while the Bot has none', () => {
  assert.deepEqual(shownValue(SPEED, { speed: 'fast' }), { value: 'fast', picked: true })
  assert.deepEqual(shownValue(SPEED, { speed: 'warp' }), { value: 'standard', picked: false })
  assert.deepEqual(shownValue(MAX_MODE, { 'acp:max_mode': true }), { value: true, picked: true })
  assert.deepEqual(shownValue(MAX_MODE, undefined), { value: false, picked: false })
})
