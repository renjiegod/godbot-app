import assert from 'node:assert/strict'
import test from 'node:test'
import type { RpcClient } from '../../godbot/link/index.ts'
import { MachineConnection, type MachineState } from '../machine/session.ts'
import { machinePairingUri, pairingUri, generateKeyPair, deviceIdFor } from '../../godbot/link/index.ts'
import { previewPairing } from './pairing-link.ts'
import { allThemes } from '../../godbot/client/team-ui/themes.js'
import { contrastRatio, machinePalette } from '../machine/contrast.ts'
import { TrackpadHold } from '../machine/trackpad-hold.ts'
import { desktopIceConfig, DesktopReadiness } from '../machine/desktop-readiness.ts'

test('initial ICE checking/disconnect/failure may recover before the first frame, but live loss ends immediately', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const errors: string[] = []
  const media = new DesktopReadiness((error) => errors.push(error.message))
  t.mock.timers.tick(80_000)
  media.offerAccepted()
  for (const state of ['checking', 'disconnected', 'checking', 'connecting', 'failed', 'connecting'])
    media.connectionChanged(state)
  t.mock.timers.tick(24_999)
  assert.deepEqual(errors, [])
  media.frameDecoded()
  t.mock.timers.tick(10_000)
  assert.equal(media.live, true)
  media.connectionChanged('disconnected')
  media.connectionChanged('failed')
  media.frameDecoded()
  assert.equal(media.live, false)
  assert.deepEqual(errors, ['Desktop connection failed'])
})

test('first-frame wait is bounded and owner cancellation clears it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const errors: string[] = []
  const canceled = new DesktopReadiness((error) => errors.push(error.message))
  canceled.offerAccepted()
  canceled.dispose()
  canceled.connectionChanged('closed')
  const unanswered = new DesktopReadiness((error) => errors.push(error.message))
  unanswered.offerAccepted()
  unanswered.connectionChanged('failed')
  t.mock.timers.tick(25_000)
  assert.deepEqual(errors, ['Desktop sent no frames'])
  assert.equal(unanswered.live, false)
})

test('relay-only connections require a TURN server while the automatic route works with STUN alone', () => {
  const stun = [{ urls: 'stun:example.test:3478' }]
  const turn = [{ urls: ['stun:example.test:3478', 'turns:example.test:5349?transport=tcp'] }]
  assert.throws(() => desktopIceConfig(stun, true), /no TURN relay/)
  assert.throws(() => desktopIceConfig(undefined, true), /no TURN relay/)
  assert.equal(desktopIceConfig(stun, false).iceTransportPolicy, 'all')
  assert.equal(desktopIceConfig(turn, true).iceTransportPolicy, 'relay')
})

test('machine and legacy team offers round-trip separately and reject mismatched keys', () => {
  const { publicKey } = generateKeyPair()
  const offer = {
    name: 'Workstation',
    hostDeviceId: deviceIdFor(publicKey),
    hostKey: publicKey,
    code: 'temporary-code',
    server: 'wss://example.test/v1/link',
  }
  assert.equal(previewPairing(machinePairingUri(offer)).kind, 'machine')
  assert.equal(previewPairing(pairingUri(offer)).kind, 'team')
  assert.throws(() => previewPairing(machinePairingUri({ ...offer, hostKey: generateKeyPair().publicKey })))
})

test('disposing an in-flight open releases its late host session without reactivating the UI', async () => {
  const seen: MachineState[] = [],
    methods: string[] = []
  let open!: (value: unknown) => void,
    closed = false
  const client = {
    onClose: () => {},
    close: async () => {
      closed = true
    },
    rpc: async (method: string) => {
      methods.push(method)
      if (method === 'computer.hello')
        return {
          version: 1,
          kind: 'computer',
          name: 'Host',
          os: 'Linux',
          account: 'user',
          desktop: false,
          terminal: true,
        }
      if (method === 'session.open')
        return new Promise((resolve) => {
          open = resolve
        })
      return { ok: true }
    },
  } as unknown as RpcClient
  const connection = new MachineConnection((s) => seen.push(s))
  await connection.connect(async (capture) => {
    capture(client)
    return client
  })
  const pending = connection.start('terminal', 'unique')
  connection.dispose()
  open({ sessionId: 'late', mode: 'terminal', state: 'approved' })
  await pending
  assert.equal(closed, true)
  assert.ok(methods.includes('session.close'))
  assert.ok(seen.every((s) => !s.session))
})

test('target chooser stays cancellable and its late control reply cannot enable input', async () => {
  let current: MachineState = { connecting: true }
  const connection = new MachineConnection((state) => {
    current = state
  })
  const hostSession = { sessionId: 'screen', mode: 'desktop', state: 'approved', control: false }
  let finishControl!: (value: unknown) => void
  let timeout = 0
  let ended = false
  const client = {
    close() {},
    onClose() {},
    async rpc(method: string, _params: unknown, options?: { timeoutMs: number }) {
      if (method === 'computer.hello')
        return { kind: 'computer', version: 1, name: 'Desk', os: 'Linux', account: 'user' }
      if (method === 'session.open') return hostSession
      if (method === 'session.close') {
        ended = true
        return {}
      }
      if (method === 'desktop.requestControl') {
        timeout = options?.timeoutMs ?? 0
        return new Promise((done) => {
          finishControl = done
        })
      }
      throw new Error('Unexpected method ' + method)
    },
  } as unknown as RpcClient
  try {
    await connection.connect(async (capture) => {
      capture(client)
      return client
    })
    await connection.start('desktop', 'screen-request')
    const request = connection.control(true)
    assert.ok(timeout >= 95_000)
    assert.equal(current.session?.controlPending, true)
    assert.equal(current.session?.control, false)
    await connection.control(false)
    assert.equal(ended, true)
    finishControl({ ...hostSession, control: true })
    await request
    assert.equal(current.session, undefined)
  } finally {
    connection.dispose()
  }
})

test('declined OS input remains visible while the existing view session stays approved', async () => {
  let current: MachineState = { connecting: true }
  const connection = new MachineConnection((state) => {
    current = state
  })
  const session = { sessionId: 'screen', state: 'approved', mode: 'desktop', control: false }
  const client = {
    close() {},
    onClose() {},
    async rpc(method: string) {
      if (method === 'computer.hello')
        return { kind: 'computer', version: 1, name: 'Desk', os: 'Linux', account: 'user' }
      if (method === 'session.open') return session
      if (method === 'desktop.requestControl') return { ...session, controlReason: 'INPUT_DENIED' }
      throw new Error('Unexpected method ' + method)
    },
  } as unknown as RpcClient
  try {
    await connection.connect(async (capture) => {
      capture(client)
      return client
    })
    await connection.start('desktop', 'screen-request')
    await connection.control(true)
    assert.equal(current.error, 'The computer declined control. You can still view its screen.')
    assert.equal(current.session?.state, 'approved')
    assert.equal(current.session?.control, false)
  } finally {
    connection.dispose()
  }
})

test('a canceled drag cannot fire its hold callback or turn its trailing touch-up into a click', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pad = new TrackpadHold()
  let downs = 0
  pad.start(() => {
    downs++
  })
  t.mock.timers.tick(400)
  assert.equal(pad.finish(), true)
  t.mock.timers.tick(100)
  assert.equal(downs, 0)
  assert.equal(pad.finish(), false)
  pad.start(() => {
    downs++
  })
  t.mock.timers.tick(450)
  assert.equal(downs, 1)
  assert.equal(pad.finish(), true)
  assert.equal(pad.active, false)
  assert.equal(pad.finish(), false)
})

test('machine secondary text, accents and control boundaries remain readable on the actual theme surfaces', () => {
  for (const theme of Object.values(allThemes())) {
    for (const mode of [theme.light, theme.dark]) {
      for (const accent of [mode.accent, '#888888', '#ffffff']) {
        const colors = machinePalette({
          main: mode.bg,
          card: mode.card,
          sidebar: mode.sidebar,
          ink: mode.text,
          accent,
          accentInk: '#141414',
        })
        assert.ok(contrastRatio(colors.ink2, colors.main) >= 4.5)
        assert.ok(contrastRatio(colors.cardSecondary, colors.card) >= 4.5)
        assert.ok(contrastRatio(colors.accentInk, colors.accent) >= 4.5)
        assert.ok(contrastRatio(colors.line2, colors.card) >= 3)
        assert.ok(contrastRatio(colors.padLine, colors.sidebar) >= 3)
      }
    }
  }
})
