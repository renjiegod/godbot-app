import assert from 'node:assert/strict'
import test from 'node:test'
import { checkHello, GODBOT_PLUGIN, helloRequest, SUPPORTED_API } from './hello.ts'

const godbot = { api: 1, apiMin: 1, apiMax: 1, capabilities: ['rpc'], boot: 'b', seq: 0, plugin: { name: GODBOT_PLUGIN, version: '0.2.0-rc.3' } }

test('the phone names the API versions it speaks', () => {
  assert.deepEqual(helloRequest(), { api: SUPPORTED_API })
  assert.deepEqual(SUPPORTED_API, [1])
})

test('a Godbot computer that speaks API 1 is accepted', () => {
  assert.deepEqual(checkHello(godbot), { ok: true })
  assert.deepEqual(checkHello({ ...godbot, plugin: undefined }), { ok: false, reason: 'update-godbot' })
})

test('no common API version asks to update Godbot, or this app when the computer is newer', () => {
  assert.deepEqual(checkHello({ ...godbot, api: null, apiMin: 1, apiMax: 1 }), { ok: false, reason: 'update-godbot' })
  assert.deepEqual(checkHello({ ...godbot, api: null, apiMin: 2, apiMax: 3 }), { ok: false, reason: 'update-app' })
  assert.deepEqual(checkHello({ ...godbot, api: 2 }), { ok: false, reason: 'update-godbot' })
})

test('a missing or broken answer means the computer is too old', () => {
  assert.deepEqual(checkHello(null), { ok: false, reason: 'update-godbot' })
  assert.deepEqual(checkHello('hello'), { ok: false, reason: 'update-godbot' })
  assert.deepEqual(checkHello([]), { ok: false, reason: 'update-godbot' })
  assert.deepEqual(checkHello({ api: 1 }), { ok: false, reason: 'update-godbot' })
  assert.deepEqual(checkHello({ ...godbot, boot: '' }), { ok: false, reason: 'update-godbot' })
})

test('DS Bot on the other end is named, not mistaken for an old Godbot', () => {
  assert.deepEqual(checkHello({ ...godbot, plugin: { name: 'ds-bot', version: '0.3.8' } }), { ok: false, reason: 'not-godbot', name: 'ds-bot' })
})
