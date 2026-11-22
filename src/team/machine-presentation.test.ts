import assert from 'node:assert/strict'
import test from 'node:test'
import { deviceIdFor, generateKeyPair, machinePairingUri, pairingUri, randomToken } from '../../godbot/link/index.ts'
import { machineEndReason, machineError } from '../machine/model.ts'
import { getLang, setLang, t } from '../ui/i18n.ts'
import { previewPairing } from './pairing-link.ts'

test('machine entry reviews only machine offers, and the general pairing entry still accepts both kinds', () => {
  const { publicKey } = generateKeyPair()
  const offer = { hostDeviceId: deviceIdFor(publicKey), hostKey: publicKey, code: randomToken(18), name: 'Local Mac', server: 'wss://example.test/v1/link' }
  assert.equal(previewPairing(machinePairingUri(offer), true).kind, 'machine')
  assert.throws(() => previewPairing(pairingUri(offer), true), /This code pairs a Godbot team/)
  assert.equal(previewPairing(pairingUri(offer)).kind, 'team')
  assert.equal(previewPairing(machinePairingUri(offer)).kind, 'machine')
})

test('machine controls, known host reasons and failure diagnostics use the selected phone language', () => {
  const saved = getLang()
  try {
    const labels = [
      'Desktop', 'Online', 'Reconnect', 'Display', 'Direct', 'Pair a remote computer',
      'On your Mac or Linux computer, open Godbot Computer Host and create a pairing offer. Scan its QR code or paste its link here.',
      'This code pairs a Godbot team. Create a pairing offer in Godbot Computer Host to pair a remote computer.',
      'Desktop sent no frames', 'Desktop connection failed', 'Incompatible computer host', 'Terminal input queue is full',
      'Terminal input was not acknowledged', 'Could not initialize the terminal renderer', 'Unexpected terminal document',
      'Terminal renderer stopped', 'Could not load the terminal renderer', 'Computer locked',
      'Sharing paused for a private prompt', 'Display disconnected', 'Desktop locked or display changed',
      'Sharing ended because the desktop is locked, protected, or unavailable',
    ]
    setLang('en')
    for (const key of labels) assert.equal(t(key), key)
    setLang('zh')
    for (const key of labels) assert.match(t(key), /\p{Script=Han}/u, key)
    assert.notEqual(t('Text to send'), t('Send text'))
    assert.match(t(machineError({ code: 'INPUT_REVOKED' })), /控制权限已撤销/u)
    assert.deepEqual(['Left arrow', 'Right arrow', 'Backspace', 'Enter'].map(key => t(key)), ['向左键', '向右键', '退格键', '回车键'])
    for (const [reason, label] of [
      ['denied', 'Request declined on the computer'], ['revoked', 'Access ended by the computer'],
      ['local_approval', 'Sharing paused for a private prompt'], ['local_management', 'Sharing paused for a private prompt'],
      ['host_stopped', 'Connection lost'], ['expired', 'Connection lost'], ['disconnected', 'Connection lost'],
      ['pty_failed', 'Terminal session failed'], ['desktop_failed', 'Desktop connection failed'],
    ]) {
      assert.equal(machineEndReason(reason), label)
      assert.match(t(machineEndReason(reason)), /\p{Script=Han}/u, reason)
    }
    for (const msg of ['Computer locked', 'Display disconnected', 'New platform-specific message', '__proto__']) {
      assert.equal(machineEndReason(msg), msg)
    }
    assert.equal(t(machineEndReason('New platform-specific message')), 'New platform-specific message')
  } finally {
    setLang(saved)
  }
})
