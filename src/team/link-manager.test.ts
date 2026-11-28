import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { CONNECT_STUCK_MS, createLinkManager, LINK_REFRESH, PROBE_ANSWER_MS, reconnectDelayMs, SILENT_PROBE_MS, type LinkDeps } from './link-manager.ts'

const A = { server: 'wss://relay.test/v1/link', hostDeviceId: 'd-A', hostKey: 'key-A', name: 'Desk A' }
const B = { server: 'wss://relay.test/v1/link', hostDeviceId: 'd-B', hostKey: 'key-B', name: 'Desk B' }
const phone = { deviceId: 'd-phone', publicKey: 'pk', privateKey: 'sk', accessToken: 'token-phone' }

interface FakeClient {
  closed: boolean
  probes: (number | undefined)[]
  frames: number
  connected: boolean
  emit(event: string, data?: unknown): void
  drop(): void
}

function fakeClient(): FakeClient & Record<string, any> {
  const events: ((message: { event: string; data: unknown }) => void)[] = []
  const closes: (() => void)[] = []
  return {
    closed: false,
    probes: [],
    frames: 0,
    connected: true,
    onEvent(fn: (message: { event: string; data: unknown }) => void) { events.push(fn); return () => {} },
    onClose(fn: () => void) { closes.push(fn); return () => {} },
    async close() { this.closed = true },
    probe(ms?: number) { this.probes.push(ms) },
    getStats() { return { mode: 'Relay', connected: this.connected, bytesSent: 0, bytesReceived: 0 } },
    emit(event: string, data: unknown = {}) { for (const fn of events) fn({ event, data }) },
    drop() { for (const fn of closes) fn() },
  }
}

// React Native runs no JS timers while the app is in the background: timers that wait are
// recorded and never fire unless a test runs them. A zero wait runs at once, as on Android.
function pausedTimers(t: TestContext) {
  const waiting: { ms: number; run: () => void; cleared: boolean }[] = []
  const realSet = globalThis.setTimeout
  const realClear = globalThis.clearTimeout
  ;(globalThis as any).setTimeout = (fn: () => void, ms = 0) => {
    const entry = { ms, run: fn, cleared: false }
    if (ms === 0) queueMicrotask(() => { if (!entry.cleared) fn() })
    else waiting.push(entry)
    return entry
  }
  ;(globalThis as any).clearTimeout = (entry: any) => { if (entry && typeof entry === 'object') entry.cleared = true }
  t.after(() => { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear })
  return { pending: () => waiting.filter(entry => !entry.cleared) }
}

const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise(resolve => setImmediate(resolve)) }

function setup(options: {
  appState?: string
  open?: (attempt: number, onClient: (client: any) => void) => Promise<any> | any
  notices?: (payload: any) => unknown
  hello?: () => unknown
  saved?: { boot: string | null; seq: number } | null
} = {}) {
  let now = 1_000_000
  let state = options.appState ?? 'background'
  const clients: (FakeClient & Record<string, any>)[] = []
  const opened: string[] = []
  const calls: { endpoint: string; payload: unknown }[] = []
  const deps: LinkDeps = {
    async openLink(computer, _identity, onClient) {
      opened.push(computer.hostDeviceId)
      if (options.open) return options.open(opened.length, onClient)
      const client = fakeClient()
      onClient(client as any)
      clients.push(client)
      return client as any
    },
    relayFramesReceived: client => (client as unknown as FakeClient).frames,
    async callBot(_client: unknown, endpoint: string, payload?: unknown) {
      calls.push({ endpoint, payload })
      if (endpoint === 'hello') return (options.hello?.() ?? { api: 1, capabilities: [], boot: 'boot-1', seq: 3, plugin: { name: 'dsh-godbot' } }) as any
      if (endpoint === 'notices') return (options.notices?.(payload) ?? { boot: 'boot-1', seq: 3, notices: [] }) as any
      return {} as any
    },
    async setupPush() { return {} },
    appState: () => state,
    now: () => now,
    async loadCursor() { return options.saved ?? null },
    saveCursor(host, cursor) { saves.push({ host, ...cursor }) },
  }
  const saves: { host: string; boot: string | null; seq: number }[] = []
  const manager = createLinkManager(deps)
  const notified: { notice: unknown; host: string }[] = []
  manager.setNotifier((notice, host) => { notified.push({ notice, host }) })
  return {
    manager, clients, opened, calls, notified, saves,
    advance(ms: number) { now += ms },
    setAppState(next: string) { state = next },
  }
}

test('the link outlives the screens while "Keep connected in background" holds it', async (t) => {
  pausedTimers(t)
  const h = setup()
  const release = h.manager.holdForScreen(A, phone)
  h.manager.holdForKeepAlive(A, phone)
  await settle()
  assert.deepEqual(h.opened, ['d-A'], 'the screens and the keep-alive share one link')
  assert.equal(h.manager.snapshot().online, true)

  // The person swipes the app away: React unmounts the screens and lets go.
  release()
  await settle()
  assert.equal(h.clients[0].closed, false, 'the keep-alive still holds the link')
  assert.equal(h.manager.snapshot().client, h.clients[0])

  // A screen that comes back finds the open link instead of opening a second one,
  // which the relay would answer by closing the first.
  const again = h.manager.holdForScreen(A, phone)
  await settle()
  assert.deepEqual(h.opened, ['d-A'])

  // Turning the keep-alive off leaves the link to the screen; letting go of both closes it.
  h.manager.releaseKeepAlive()
  assert.equal(h.clients[0].closed, false)
  again()
  assert.equal(h.clients[0].closed, true)
  assert.equal(h.manager.snapshot().client, undefined)
})

test('a screen alone closes the link when it goes away', async (t) => {
  pausedTimers(t)
  const h = setup({ appState: 'active' })
  const release = h.manager.holdForScreen(A, phone)
  await settle()
  release()
  assert.equal(h.clients[0].closed, true)
})

test('an in-flight keep-alive restore does not replace the computer selected on screen', async (t) => {
  pausedTimers(t)
  const h = setup()
  const release = h.manager.holdForScreen(B, phone)
  h.manager.holdForKeepAlive(A, phone)
  await settle()
  release()
  assert.deepEqual(h.opened, ['d-B'])
  assert.equal(h.manager.snapshot().host, 'd-B')
  assert.equal(h.clients[0].closed, false)
})

test('in the background a dropped link comes back on the beat, with no timer firing', async (t) => {
  const timers = pausedTimers(t)
  let fail = false
  const h = setup({
    open: (_attempt, onClient) => {
      if (fail) throw Object.assign(new Error('offline'), { code: 'SERVER_UNREACHABLE' })
      const client = fakeClient()
      onClient(client)
      h.clients.push(client)
      return client
    },
  })
  h.manager.holdForKeepAlive(A, phone)
  await settle()
  assert.equal(h.opened.length, 1)

  // The network goes: the first retry runs at once and fails; the next waits 2 s on a timer
  // that never fires in the background.
  fail = true
  h.clients[0].drop()
  await settle()
  assert.equal(h.opened.length, 2)
  assert.equal(h.manager.snapshot().client, undefined)
  assert.equal(timers.pending().length, 1)

  // A beat before the retry is due does nothing; after it, the beat reconnects.
  h.manager.tick('beat')
  await settle()
  assert.equal(h.opened.length, 2)
  h.advance(2_000)
  h.manager.tick('beat')
  await settle()
  assert.equal(h.opened.length, 3, 'the beat retried when the wait was over')

  // Retries in the background back off: 4 s now, so a beat after 2 s waits.
  h.advance(2_000)
  h.manager.tick('beat')
  await settle()
  assert.equal(h.opened.length, 3)

  // The network comes back: that tick retries at once, whatever the wait.
  fail = false
  h.manager.tick('network')
  await settle()
  assert.equal(h.opened.length, 4)
  assert.equal(h.manager.snapshot().online, true)
})

test('a silent link is probed, and dropped when the probe goes unanswered', async (t) => {
  pausedTimers(t)
  const h = setup()
  h.manager.holdForKeepAlive(A, phone)
  await settle()
  const first = h.clients[0]
  first.frames = 100

  h.manager.tick('beat')
  assert.deepEqual(first.probes, [], 'traffic since the last beat: nothing to do')
  // The relay pings every 25 s; 30 s without a frame is worth a probe.
  h.advance(SILENT_PROBE_MS)
  h.manager.tick('beat')
  assert.equal(first.probes.length, 1)

  // An answer keeps the link.
  first.frames = 140
  h.advance(PROBE_ANSWER_MS)
  h.manager.tick('beat')
  assert.equal(first.closed, false)

  // Silence again, a probe, and no answer: the link is gone and the next one opens.
  h.advance(SILENT_PROBE_MS)
  h.manager.tick('beat')
  assert.equal(first.probes.length, 2)
  h.advance(PROBE_ANSWER_MS)
  h.manager.tick('beat')
  assert.equal(first.closed, true)
  await settle()
  assert.equal(h.opened.length, 2, 'the first retry after a live link runs at once')
  assert.equal(h.manager.snapshot().client, h.clients[1])
})

test('relay heartbeats keep an idle link open without any encrypted application traffic', async (t) => {
  pausedTimers(t)
  const h = setup()
  h.manager.holdForKeepAlive(A, phone)
  await settle()
  const first = h.clients[0]
  for (let beat = 0; beat < 4; beat += 1) {
    h.advance(SILENT_PROBE_MS)
    first.frames += 1
    h.manager.tick('beat')
  }
  assert.equal(first.getStats().bytesReceived, 0)
  assert.deepEqual(first.probes, [])
  assert.equal(first.closed, false)
  assert.equal(h.manager.snapshot().client, first)
})

test('the network coming back or the screen turning on probes the link at once', async (t) => {
  pausedTimers(t)
  const h = setup()
  h.manager.holdForKeepAlive(A, phone)
  await settle()
  const client = h.clients[0]
  client.frames = 10
  h.manager.tick('network')
  assert.equal(client.probes.length, 1)
  // No answer by the follow-up beat: the socket died with the old network.
  h.advance(PROBE_ANSWER_MS)
  h.manager.tick('beat')
  assert.equal(client.closed, true)

  await settle()
  const next = h.clients[1]
  next.frames = 5
  h.manager.tick('screen')
  next.frames = 9
  h.advance(PROBE_ANSWER_MS)
  h.manager.tick('beat')
  assert.equal(next.closed, false, 'an answered probe keeps the link')

  // A socket that already reports itself closed is dropped on the next beat.
  next.connected = false
  h.manager.tick('beat')
  assert.equal(next.closed, true)
})

test('an attempt that never settles is given up on the beat', async (t) => {
  pausedTimers(t)
  const stuck = fakeClient()
  const h = setup({
    open: (attempt, onClient) => {
      if (attempt === 1) { onClient(stuck); return new Promise(() => {}) }
      const client = fakeClient()
      onClient(client)
      h.clients.push(client)
      return client
    },
  })
  h.manager.holdForKeepAlive(A, phone)
  await settle()
  h.advance(CONNECT_STUCK_MS - 1)
  h.manager.tick('beat')
  await settle()
  assert.equal(h.opened.length, 1, 'still within its time')
  h.advance(1)
  h.manager.tick('beat')
  await settle()
  assert.equal(stuck.closed, true)
  assert.equal(h.opened.length, 2)
  assert.equal(h.manager.snapshot().online, true)
})

test('the beat also retries when the socket connects but the computer never answers hello', async (t) => {
  pausedTimers(t)
  let helloCalls = 0
  const h = setup({
    hello: () => ++helloCalls === 1 ? new Promise(() => {}) : { api: 1, capabilities: [], boot: 'boot-1', seq: 3, plugin: { name: 'dsh-godbot' } },
  })
  h.manager.holdForKeepAlive(A, phone)
  await settle()
  assert.equal(h.manager.snapshot().client, undefined, 'the client is unavailable until hello passes')
  assert.equal(h.manager.snapshot().online, false)

  h.clients[0].frames += 1
  h.advance(CONNECT_STUCK_MS)
  h.manager.tick('beat')
  await settle()
  assert.equal(h.clients[0].closed, true)
  assert.equal(h.manager.snapshot().client, h.clients[1])
  assert.equal(h.manager.snapshot().online, true)
})

test('transient hello failures close the client and retry at the foreground interval', async (t) => {
  pausedTimers(t)
  const failures = [
    Object.assign(new Error('Hello timed out'), { code: 'RPC_TIMEOUT' }),
    Object.assign(new Error('Transport closed'), { code: 'TRANSPORT_CLOSED' }),
  ]
  const h = setup({ appState: 'active', hello: () => {
    const failure = failures.shift()
    if (failure) throw failure
  } })
  h.manager.holdForScreen(A, phone)

  for (const [attempt, message] of ['Connection timed out', 'Not connected to the computer yet.'].entries()) {
    await settle()
    assert.equal(h.manager.snapshot().error, message)
    assert.equal(h.manager.snapshot().fatal, false)
    assert.equal(h.clients[attempt].closed, true)
    h.advance(2_000)
    h.manager.tick('beat')
  }
  await settle()
  assert.equal(h.manager.snapshot().client, h.clients[2])
  assert.equal(h.manager.snapshot().online, true)
  assert.equal(h.manager.snapshot().error, null)
})

test('a missing hello endpoint still asks for an upgrade and backs off', async (t) => {
  const timers = pausedTimers(t)
  const h = setup({ appState: 'active', hello: () => {
    throw Object.assign(new Error('Unknown endpoint hello'), { code: 'bot/not-found' })
  } })
  h.manager.holdForScreen(A, phone)
  await settle()
  assert.equal(h.manager.snapshot().error, 'Update Godbot on the computer to use this phone.')
  assert.deepEqual(timers.pending().map(timer => timer.ms), [2_000])

  h.advance(2_000)
  h.manager.tick('beat')
  await settle()
  assert.equal(h.clients[1].closed, true)
  assert.deepEqual(timers.pending().map(timer => timer.ms), [4_000])
})

test('notices become system notifications only while the app is not on screen, also the ones missed', async (t) => {
  pausedTimers(t)
  const h = setup({
    notices: () => ({ boot: 'boot-1', seq: 5, notices: [{ kind: 'approval', seq: 4, text: 'missed' }, { kind: 'question', seq: 5, text: 'missed too' }] }),
  })
  const feed: string[] = []
  h.manager.onFeed(event => { feed.push(event) })
  h.manager.holdForKeepAlive(A, phone)
  await settle()
  // The catch-up after the handshake asks from the computer's cursor and replays what it missed.
  assert.deepEqual(h.calls.find(call => call.endpoint === 'notices')?.payload, { boot: 'boot-1', since: 3 })
  assert.deepEqual(h.notified.map(entry => (entry.notice as { text: string }).text), ['missed', 'missed too'])
  assert.ok(h.notified.every(entry => entry.host === 'd-A'))
  assert.deepEqual(feed, [LINK_REFRESH, 'notice', 'notice'])

  h.clients[0].emit('notice', { kind: 'approval', seq: 6, text: 'live' })
  assert.equal(h.notified.length, 3)
  // A notice already seen is not shown twice.
  h.clients[0].emit('notice', { kind: 'approval', seq: 6, text: 'live' })
  assert.equal(h.notified.length, 3)
  // On screen, the app shows its own banner instead.
  h.setAppState('active')
  h.clients[0].emit('notice', { kind: 'approval', seq: 7, text: 'on screen' })
  assert.equal(h.notified.length, 3)
  assert.equal(feed.filter(event => event === 'notice').length, 4)
})

test('switching to another computer closes the old link and the keep-alive follows', async (t) => {
  pausedTimers(t)
  const h = setup()
  h.manager.holdForKeepAlive(A, phone)
  await settle()
  const release = h.manager.holdForScreen(B, phone)
  await settle()
  assert.equal(h.clients[0].closed, true)
  assert.deepEqual(h.opened, ['d-A', 'd-B'])
  assert.equal(h.manager.snapshot().host, 'd-B')
  release()
  await settle()
  assert.equal(h.clients[1].closed, false, 'the keep-alive now holds the link to B')
})

test('a computer that refused the phone is not retried by the beat, but is once on return to the screen', async (t) => {
  pausedTimers(t)
  let refuse = true
  const h = setup({
    open: (_attempt, onClient) => {
      if (refuse) throw Object.assign(new Error('Not paired'), { code: 'NOT_PAIRED' })
      const client = fakeClient()
      onClient(client)
      return client
    },
  })
  h.manager.holdForKeepAlive(A, phone)
  await settle()
  assert.equal(h.manager.snapshot().fatal, true)
  h.advance(10 * 60_000)
  h.manager.tick('network')
  await settle()
  assert.equal(h.opened.length, 1)
  refuse = false
  h.manager.foreground()
  await settle()
  assert.equal(h.opened.length, 2)
  assert.equal(h.manager.snapshot().online, true)
})

test('reconnectDelayMs backs off in the background up to a minute, and keeps the 2 s rhythm on screen', () => {
  assert.equal(reconnectDelayMs(true, 0, false, true), 0)
  assert.equal(reconnectDelayMs(false, 0, false, true), 2_000)
  assert.equal(reconnectDelayMs(true, 1, false, true), 2_000)
  assert.equal(reconnectDelayMs(true, 2, false, true), 4_000)
  assert.equal(reconnectDelayMs(true, 5, false, true), 32_000)
  assert.equal(reconnectDelayMs(true, 6, false, true), 60_000)
  assert.equal(reconnectDelayMs(true, 50, false, true), 60_000)
  assert.equal(reconnectDelayMs(true, 6), 2_000)
  assert.equal(reconnectDelayMs(true, 3, true, true), 16_000, 'an incompatible computer keeps its own backoff')
})

test('a process the keep-alive brought back catches up from the saved cursor; a screen starts from now', async (t) => {
  pausedTimers(t)
  // The computer is still on boot-1 and is at notice 3; the phone last saw notice 1.
  const notices = (payload: { since: number }) => ({
    boot: 'boot-1', seq: 3,
    notices: [{ kind: 'approval', seq: 2, text: 'while the phone was off' }, { kind: 'question', seq: 3, text: 'also missed' }].filter(entry => entry.seq > payload.since),
  })
  const restarted = setup({ saved: { boot: 'boot-1', seq: 1 }, notices })
  restarted.manager.holdForKeepAlive(A, phone)
  await settle()
  assert.deepEqual(restarted.calls.find(call => call.endpoint === 'notices')?.payload, { boot: 'boot-1', since: 1 })
  assert.deepEqual(restarted.notified.map(entry => (entry.notice as { text: string }).text), ['while the phone was off', 'also missed'])
  assert.deepEqual(restarted.saves.at(-1), { host: 'd-A', boot: 'boot-1', seq: 3 }, 'the cursor is saved as it moves')

  // Opened from the launcher, the app starts from the computer's cursor: no old notices.
  const opened = setup({ saved: { boot: 'boot-1', seq: 1 }, notices, appState: 'active' })
  const release = opened.manager.holdForScreen(A, phone)
  opened.manager.holdForKeepAlive(A, phone)
  await settle()
  assert.deepEqual(opened.calls.find(call => call.endpoint === 'notices')?.payload, { boot: 'boot-1', since: 3 })
  assert.equal(opened.notified.length, 0)
  release()

  // A computer that restarted since (another boot) replays nothing.
  const rebooted = setup({ saved: { boot: 'boot-0', seq: 9 }, notices })
  rebooted.manager.holdForKeepAlive(A, phone)
  await settle()
  assert.deepEqual(rebooted.calls.find(call => call.endpoint === 'notices')?.payload, { boot: 'boot-1', since: 3 })
  assert.equal(rebooted.notified.length, 0)
})

test('pairing borrows the relay connection: the link closes and comes back after', async (t) => {
  pausedTimers(t)
  const h = setup()
  h.manager.holdForKeepAlive(A, phone)
  await settle()
  const resume = h.manager.pause()
  assert.equal(h.clients[0].closed, true)
  // Nothing reconnects while the pairing runs: not the beat, not the network, not the screen.
  h.advance(10 * 60_000)
  h.manager.tick('network')
  h.manager.foreground()
  await settle()
  assert.deepEqual(h.opened, ['d-A'])
  // The newly paired computer takes over as the screens come back.
  resume()
  const release = h.manager.holdForScreen(B, phone)
  await settle()
  assert.deepEqual(h.opened, ['d-A', 'd-B'])
  assert.equal(h.manager.snapshot().host, 'd-B')
  release()
})
