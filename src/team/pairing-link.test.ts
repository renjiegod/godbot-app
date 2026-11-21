import assert from 'node:assert/strict'
import test from 'node:test'
import { deviceIdFor, generateKeyPair, pairingUri, randomToken } from '../../godbot/link/index.ts'
import { isPairingLink, previewPairing, serverLabel } from './pairing-link.ts'

function offer(server = 'wss://relay.example.org/v1/link') {
  const keys = generateKeyPair()
  return { server, hostDeviceId: deviceIdFor(keys.publicKey), hostKey: keys.publicKey, code: randomToken(18), name: 'Studio Mac' }
}

test('Godbot computers show godbot:// pairing links', () => {
  const uri = pairingUri(offer())
  assert.ok(uri.startsWith('godbot://pair?'), uri)
  assert.equal(isPairingLink(uri), true)
})

test('both pairing schemes parse to the same offer', () => {
  const expected = offer()
  const godbot = pairingUri(expected)
  const dsbot = godbot.replace(/^godbot:/, 'dsbot:')
  for (const uri of [godbot, dsbot]) {
    assert.equal(isPairingLink(uri), true)
    const preview = previewPairing(uri)
    assert.equal(preview.offer.hostDeviceId, expected.hostDeviceId)
    assert.equal(preview.offer.hostKey, expected.hostKey)
    assert.equal(preview.offer.code, expected.code)
    assert.equal(preview.offer.server, expected.server)
    assert.equal(preview.name, 'Studio Mac')
    assert.equal(preview.server, 'relay.example.org')
  }
})

test('other links are not pairing links, and a forged key is refused', () => {
  assert.equal(isPairingLink('https://example.org/pair'), false)
  assert.equal(isPairingLink('godbot://chat?bot=1'), false)
  assert.equal(isPairingLink(undefined), false)
  const real = offer()
  const other = generateKeyPair()
  const forged = pairingUri({ ...real, hostKey: other.publicKey })
  assert.throws(() => previewPairing(forged))
})

test('the confirmation names a plain ws:// relay as unencrypted', () => {
  assert.equal(serverLabel('ws://127.0.0.1:8787/v1/link'), '127.0.0.1:8787 (ws)')
  assert.equal(serverLabel('wss://relay.example.org:8443/v1/link'), 'relay.example.org:8443')
})
