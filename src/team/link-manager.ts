// Godbot: the one encrypted link to the active computer, kept outside React.
//
// The screens and "Keep connected in background" share it. Each holds it while it wants it,
// and it closes when nobody does. Outside React it outlasts the screens: when the person
// swipes the app away from Recents, Android destroys the activity and React Native unmounts
// every screen, but the keep-alive service keeps the process and this link. The service can
// also open it with no screen at all: after a reboot, or after Android killed the process and
// restarted the service.
//
// React Native runs JS timers only while the app is on screen. In the background nothing here
// may wait on a timer. The keep-alive service calls tick() about every 30 seconds, when the
// network comes back and when the screen turns on; tick() goes by the clock. It retries when a
// retry is due, gives up on an attempt that never finished, and drops a link that went silent:
// the Server pings every 25 seconds, so a link that hears nothing for 30 seconds is probed,
// and one that does not answer the probe is gone.
import type { RpcClient } from '../../godbot/link/index.ts'
import type { PhoneIdentity, SavedComputer } from '../store.ts'
import { hostText, t } from '../ui/i18n.ts'
import { checkHello, helloRequest, type Hello, type HelloVerdict } from './hello.ts'
import { createNoticeCursor, type NoticeCursorAnswer } from './notices.ts'

const RETRY_MS = 2_000
// A computer whose Godbot this app cannot talk to is asked again less and less often.
const INCOMPATIBLE_MAX_MS = 5 * 60_000
// In the background a failing network is retried less and less often, up to once a minute.
const BACKGROUND_MAX_MS = 60_000
// Silence after which tick() probes the link, and how long the probe may go unanswered.
export const SILENT_PROBE_MS = 30_000
export const PROBE_ANSWER_MS = 8_000
// An attempt still not settled after this is abandoned: its own timeouts are JS timers.
export const CONNECT_STUCK_MS = 45_000

/** A feed event of the manager's own: the team may have moved while the link was down. */
export const LINK_REFRESH = 'link.refresh'

export type FeedHandler = (event: string, data: any) => void
/** Why tick() runs: the periodic beat, or something that makes a dead link likely. */
export type TickReason = 'beat' | 'start' | 'network' | 'screen'

export interface LinkSnapshot {
  /** The computer the rest is about; null before anything held the link. */
  host: string | null
  /** The encrypted link, once it is up (calls can go before the handshake answers). */
  client: RpcClient | undefined
  /** The handshake passed: the computer runs a Godbot this app can talk to. */
  online: boolean
  hello: Hello | null
  error: string | null
  /** The computer refused this phone, or runs something else: no more retries. */
  fatal: boolean
}

export interface LinkDeps {
  /** Opens the link; `onClient` gets it before the handshake, so a stuck attempt can be closed. */
  openLink(computer: SavedComputer, identity: PhoneIdentity, onClient: (client: RpcClient) => void): Promise<RpcClient>
  /** All incoming WebSocket messages, including the relay's heartbeat control frames. */
  relayFramesReceived(client: RpcClient): number
  callBot<T>(client: RpcClient, endpoint: string, payload?: unknown): Promise<T>
  /** Hands the computer the push key and registers with the relay (push-link.ts). */
  setupPush(client: RpcClient, hostDeviceId: string): Promise<unknown>
  /** React Native's AppState.currentState. */
  appState(): string | null | undefined
  now(): number
  /** The notice cursor kept on the phone, so the keep-alive catches up after the process restarted. */
  loadCursor?(host: string): Promise<{ boot: string | null; seq: number } | null>
  saveCursor?(host: string, cursor: { boot: string | null; seq: number }): void
}

export function rejected(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  return code === 'NOT_PAIRED' || code === 'PAIRING_REJECTED'
}

/**
 * The wait before the next attempt. The first drop of a live link retries at once. On screen a
 * compatible computer is retried every 2 s; in the background the wait doubles up to a minute,
 * so a phone without network does not wake up every 2 s.
 */
export function reconnectDelayMs(hadLink: boolean, failStreak: number, incompatible = false, background = false): number {
  if (incompatible) return Math.min(RETRY_MS * 2 ** Math.min(failStreak, 16), INCOMPATIBLE_MAX_MS)
  if (hadLink && failStreak === 0) return 0
  if (background) return Math.min(RETRY_MS * 2 ** Math.min(Math.max(failStreak - 1, 0), 16), BACKGROUND_MAX_MS)
  return RETRY_MS
}

/** What to tell the person when the computer's answer to `hello` rules this app out. */
export function helloError(verdict: Exclude<HelloVerdict, { ok: true }>): string {
  if (verdict.reason === 'not-godbot') return t('This computer runs {name}, not Godbot. Pair with a computer that runs Godbot.', { name: verdict.name })
  if (verdict.reason === 'update-app') return t('Update this app to use it with the Godbot on this computer.')
  return t('Update Godbot on the computer to use this phone.')
}

export function errorText(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  if (rejected(error)) return t('The computer did not accept this phone. Show a new QR code on the computer and scan it again.')
  if (code === 'HOST_OFFLINE') return t('The computer is not connected to the Server. Check that Godbot is open and phone access is on.')
  if (code === 'SERVER_UNREACHABLE') return t('Could not reach the Server. Check the network. If the computer\'s Server address changed, pair again under Computers.')
  return hostText(error instanceof Error ? error.message : String(error))
}

export const offline = () => Object.assign(new Error(t('Not connected to the computer yet.')), { code: 'link/offline' })

function sameTarget(a: { computer: SavedComputer; identity: PhoneIdentity }, computer: SavedComputer, identity: PhoneIdentity): boolean {
  return a.computer.hostDeviceId === computer.hostDeviceId && a.computer.server === computer.server && a.computer.hostKey === computer.hostKey
    && a.identity.deviceId === identity.deviceId && a.identity.accessToken === identity.accessToken
}

interface Attempt { gen: number; at: number; client?: RpcClient }

export type LinkManager = ReturnType<typeof createLinkManager>

export function createLinkManager(deps: LinkDeps) {
  let target: { computer: SavedComputer; identity: PhoneIdentity } | null = null
  let screens = 0
  let keep = false
  // Something else has the phone's one relay connection (pairing a computer).
  let paused = 0
  let snap: LinkSnapshot = { host: null, client: undefined, online: false, hello: null, error: null, fatal: false }
  const listeners = new Set<(snapshot: LinkSnapshot) => void>()
  const feed = new Set<FeedHandler>()
  let notifier: ((notice: unknown, host: string) => void) | null = null

  // Everything below belongs to the current target and starts over in stop().
  let gen = 0
  let attempt: Attempt | null = null
  let hadLink = false
  let failStreak = 0
  let incompatible = false
  let nextAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let heard = { frames: -1, at: 0 }
  let probedAt = 0
  let cursor = createNoticeCursor()

  const wanted = () => target !== null && (screens > 0 || keep) && !snap.fatal && paused === 0

  function set(patch: Partial<LinkSnapshot>): void {
    snap = { ...snap, ...patch }
    for (const listener of [...listeners]) listener(snap)
  }

  function emit(event: string, data: unknown): void {
    // What arrives while the app is not on screen becomes a system notification.
    if (event === 'notice' && notifier !== null && snap.host !== null && deps.appState() !== 'active') {
      try { notifier(data, snap.host) } catch { /* a notification is best effort */ }
    }
    for (const handler of [...feed]) handler(event, data)
  }

  function schedule(): void {
    const delay = reconnectDelayMs(hadLink, failStreak, incompatible, deps.appState() === 'background')
    failStreak += 1
    nextAt = deps.now() + delay
    clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; void connect() }, delay)
  }

  async function connect(): Promise<void> {
    if (!wanted() || attempt !== null || snap.client !== undefined) return
    const mine: Attempt = { gen, at: deps.now() }
    attempt = mine
    const current = () => attempt === mine && mine.gen === gen
    const { computer, identity } = target!
    try {
      // A process the keep-alive brought back (no screen) picks up the notices it missed while
      // it was gone. A screen starts from now: it shows what waits anyway, without a pile of banners.
      if (cursor.snapshot().boot === null && keep && screens === 0 && deps.loadCursor !== undefined) {
        const saved = await deps.loadCursor(computer.hostDeviceId).catch(() => null)
        if (!current()) return
        if (saved !== null && cursor.snapshot().boot === null) cursor = createNoticeCursor(saved)
      }
      const client = await deps.openLink(computer, identity, created => { mine.client = created })
      if (!current()) { void client.close(); return }
      mine.client = client
      heard = { frames: deps.relayFramesReceived(client), at: deps.now() }
      probedAt = 0
      // The screens read the team now, alongside the handshake: each is a round trip.
      set({ client, online: false, error: null })
      const answer = await deps.callBot<Hello>(client, 'hello', helloRequest()).catch(() => null)
      if (!current()) { void client.close(); return }
      attempt = null
      const verdict = checkHello(answer)
      if (!verdict.ok || answer === null) {
        set({ client: undefined, online: false, error: helloError(verdict.ok ? { ok: false, reason: 'update-godbot' } : verdict) })
        void client.close()
        // DS Bot on the other end will not turn into Godbot by retrying.
        if (!verdict.ok && verdict.reason === 'not-godbot') { set({ fatal: true }); return }
        incompatible = true
        schedule()
        return
      }
      hadLink = true
      incompatible = false
      failStreak = 0
      nextAt = 0
      set({ online: true, hello: answer, error: null })
      // Push: hand this computer the phone's key and tell the relay where to push.
      void deps.setupPush(client, computer.hostDeviceId).catch(() => {})
      const host = computer.hostDeviceId
      const save = () => { try { deps.saveCursor?.(host, cursor.snapshot()) } catch { /* best effort */ } }
      const { sameBoot, since } = cursor.connect(answer)
      save()
      client.onEvent(({ event, data }: { event: string; data: any }) => {
        if (snap.client !== client) return
        if (event === 'notice') {
          if (!cursor.acceptLive(answer.boot, data)) return
          save()
        }
        emit(event, data)
      })
      // Notices that went out while the link was down come back once.
      void deps.callBot(client, 'notices', { boot: answer.boot, since }).then(reply => {
        if (snap.client !== client) return
        const { reset, replay } = cursor.acceptCatchUp(answer.boot, sameBoot, reply as NoticeCursorAnswer)
        save()
        if (reset || replay.length > 0) emit(LINK_REFRESH, {})
        if (!reset) for (const entry of replay) emit('notice', entry)
      }).catch(() => {})
      client.onClose(() => {
        if (snap.client !== client) return
        set({ client: undefined, online: false })
        schedule()
      })
    } catch (failure) {
      if (!current()) return
      attempt = null
      set({ error: errorText(failure) })
      if (rejected(failure)) { set({ fatal: true }); return }
      schedule()
    } finally {
      if (attempt === mine) attempt = null
    }
  }

  /** Closes the link and forgets the target's progress; the target itself stays. */
  function stop(): void {
    gen += 1
    clearTimeout(timer)
    timer = undefined
    const client = snap.client
    const pending = attempt
    attempt = null
    hadLink = false
    failStreak = 0
    incompatible = false
    nextAt = 0
    heard = { frames: -1, at: 0 }
    probedAt = 0
    cursor = createNoticeCursor()
    set({ client: undefined, online: false, hello: null, error: null, fatal: false })
    void client?.close()
    if (pending?.client !== undefined && pending.client !== client) void pending.client.close()
  }

  function setTarget(computer: SavedComputer, identity: PhoneIdentity): void {
    if (target !== null && sameTarget(target, computer, identity)) {
      target = { computer, identity }
      return
    }
    stop()
    target = { computer, identity }
    set({ host: computer.hostDeviceId })
  }

  /** Drops a link that stopped answering and retries. */
  function drop(client: RpcClient): void {
    if (snap.client !== client) return
    set({ client: undefined, online: false })
    void client.close()
    schedule()
  }

  function checkAlive(client: RpcClient, now: number, urgent: boolean): void {
    let stats: { connected: boolean } | undefined
    try { stats = client.getStats?.() } catch { return }
    if (stats === undefined) return
    if (!stats.connected) { drop(client); return }
    const frames = deps.relayFramesReceived(client)
    if (frames !== heard.frames) {
      heard = { frames, at: now }
      probedAt = 0
      if (!urgent) return
    } else if (probedAt !== 0) {
      if (now - probedAt >= PROBE_ANSWER_MS) drop(client)
      return
    }
    // A new network or a screen that just turned on often means a dead socket: ask now.
    if (urgent || now - heard.at >= SILENT_PROBE_MS) {
      probedAt = now
      client.probe?.()
    }
  }

  return {
    snapshot: (): LinkSnapshot => snap,
    subscribe(listener: (snapshot: LinkSnapshot) => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    onFeed(handler: FeedHandler): () => void {
      feed.add(handler)
      return () => { feed.delete(handler) }
    },
    /** Turns notices into system notifications while the app is not on screen. */
    setNotifier(next: ((notice: unknown, host: string) => void) | null): void { notifier = next },

    /** A screen wants the link to this computer; the returned function lets go. */
    holdForScreen(computer: SavedComputer, identity: PhoneIdentity): () => void {
      setTarget(computer, identity)
      screens += 1
      void connect()
      let held = true
      return () => {
        if (!held) return
        held = false
        screens -= 1
        if (!wanted()) stop()
      }
    },
    /** "Keep connected in background" wants the link, until releaseKeepAlive(). */
    holdForKeepAlive(computer: SavedComputer, identity: PhoneIdentity): void {
      // The screen may have selected a different computer while the task read storage.
      if (screens === 0) setTarget(computer, identity)
      keep = true
      void connect()
    },
    releaseKeepAlive(): void {
      keep = false
      if (!wanted()) stop()
    },
    /**
     * Pairing opens its own connection with this phone's identity, and the relay keeps one
     * per phone: the link closes and stays closed until the returned function is called.
     */
    pause(): () => void {
      paused += 1
      stop()
      let held = true
      return () => {
        if (!held) return
        held = false
        paused -= 1
        // After the screens that follow had their say (a new computer was just paired).
        void Promise.resolve().then(() => { if (wanted()) void connect() })
      }
    },
    keepsAlive: (): boolean => keep,

    /** The app came on screen: retry at once, or make a half-open link declare itself. */
    foreground(): void {
      if (target === null) return
      failStreak = 0
      if (snap.fatal) set({ fatal: false })
      const client = snap.client
      if (client === undefined) {
        clearTimeout(timer)
        void connect()
        return
      }
      client.probe?.(2_500)
    },
    /** The app left the screen: its timers stop anyway, and tick() takes over. */
    background(): void {
      clearTimeout(timer)
      timer = undefined
    },
    /** The keep-alive service's beat; decides by the clock, never by a timer. */
    tick(reason: TickReason = 'beat'): void {
      if (!wanted()) return
      const now = deps.now()
      const urgent = reason === 'network' || reason === 'screen'
      if (attempt !== null) {
        if (now - attempt.at < CONNECT_STUCK_MS) return
        const stuck = attempt
        attempt = null
        if (snap.client !== undefined) set({ client: undefined, online: false })
        void stuck.client?.close()
      } else if (snap.client !== undefined) {
        checkAlive(snap.client, now, urgent)
        return
      } else if (!urgent && reason !== 'start' && now < nextAt) {
        return
      }
      if (urgent) failStreak = 0
      clearTimeout(timer)
      timer = undefined
      void connect()
    },
  }
}
