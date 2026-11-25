// Modified for Godbot. See NOTICE.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { RpcClient } from '../../godbot/link/index.ts'
import { callBot, callBotState, openLink, relayFramesReceived, type TeamState } from '../connection.ts'
import { ensureUnlock } from './gate.ts'
import type { Hello } from './hello.ts'
import { createLinkManager, errorText, LINK_REFRESH, offline, type FeedHandler, type LinkSnapshot } from './link-manager.ts'
import { loadNoticeCursor, saveNoticeCursor } from './notice-cursor-store.ts'
import { OPTIMISTIC, optimistic, withWrites, type Write } from './optimistic.ts'
import { setupPushFor } from './push-link.ts'
import { hostText } from '../ui/i18n.ts'
import type { PhoneIdentity, SavedComputer } from '../store.ts'

export { errorText, helloError, offline, reconnectDelayMs, rejected } from './link-manager.ts'
export type { FeedHandler, Hello }

/** The app's one link to the active computer (link-manager.ts), shared by the screens and the keep-alive service. */
export const linkManager = createLinkManager({
  openLink: (computer, identity, onClient) => openLink(computer, identity, undefined, onClient),
  relayFramesReceived,
  callBot: (client, endpoint, payload) => callBot(client, endpoint, payload),
  setupPush: setupPushFor,
  appState: () => AppState.currentState,
  now: () => Date.now(),
  loadCursor: loadNoticeCursor,
  saveCursor: saveNoticeCursor,
})

// Feed events keep the app live; the poll only stays as a foreground fallback.
const POLL_MS = 15_000
// Writes that settle pending items without always bumping state.revision.
const PENDING_MUTATING = new Set([
  'approval-answer',
  'browser-give-back',
  'browser-takeover',
  'browser-stop',
  'answer-question',
  'view-reply',
  'dismiss-question',
  'dismiss-view',
  'secret-set',
  'secret-allow',
  'secret-cancel',
])

// Profile photos travel by reference and are fetched once per content hash
// (`avatars: 'ref'` on `state`, then the `avatar` endpoint per new ref).
const photoCache = new Map<string, string>()
const photoFetching = new Set<string>()

// Holds the link while the screens are up and keeps the team state fresh. `call` runs one
// /api/bot endpoint. The link itself belongs to linkManager, so it outlives these screens when
// "Keep connected in background" is on.
export function useTeamLink(computer: SavedComputer, identity: PhoneIdentity) {
  const [team, setTeam] = useState<TeamState | null>(null)
  const [online, setOnline] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [hello, setHello] = useState<Hello | null>(null)
  const clientRef = useRef<RpcClient | undefined>(undefined)
  const revision = useRef<number>(-1)
  const writes = useRef<Write[]>([])
  const liveKey = useRef<string | undefined>(undefined)
  const modelsKey = useRef('')
  const boot = useRef<Hello['boot'] | undefined>(undefined)
  const pollRef = useRef<() => void>(() => {})
  const hostRef = useRef(computer.hostDeviceId)
  const switched = hostRef.current !== computer.hostDeviceId
  if (switched) {
    hostRef.current = computer.hostDeviceId
    clientRef.current = undefined
    revision.current = -1
    writes.current = []
    liveKey.current = undefined
    modelsKey.current = ''
    boot.current = undefined
    setTeam(null)
    setOnline(false)
    setLinkError(null)
    setPollError(null)
    setHello(null)
  }
  const onFeed = useCallback((handler: FeedHandler) => linkManager.onFeed(handler), [])
  const stateRequest = useCallback(() => ({
    since: revision.current,
    avatars: 'ref',
    live: liveKey.current,
    models: modelsKey.current,
    sessionOrder: true,
  }), [])

  function fetchPhoto(botId: string, ref: string) {
    if (photoFetching.has(ref)) return
    const client = clientRef.current
    if (client === undefined) return
    photoFetching.add(ref)
    void callBot<{ ref?: string | null; image?: string | null }>(client, 'avatar', { botId })
      .then(answer => {
        if (typeof answer.image === 'string') photoCache.set(typeof answer.ref === 'string' ? answer.ref : ref, answer.image)
        // Re-fill the current team now that this photo is cached.
        setTeam(prev => (prev === null ? prev : fillPhotos(prev, prev)))
      })
      .catch(() => {})
      .finally(() => photoFetching.delete(ref))
  }

  // Every bot whose photo came as a ref gets the cached image, or keeps the
  // previous team's photo while the fetch runs — never a blank avatar.
  function fillPhotos(team: TeamState, prev: TeamState | null): TeamState {
    if (!Array.isArray(team.bots)) return team
    const bots = team.bots.map(bot => {
      const ref = bot.avatar?.imageRef
      if (ref === undefined) return bot
      const cached = photoCache.get(ref)
      if (cached !== undefined) return bot.avatar?.image === cached ? bot : { ...bot, avatar: { ...bot.avatar, image: cached } }
      fetchPhoto(bot.id, ref)
      const kept = prev?.bots.find(entry => entry.id === bot.id)?.avatar?.image
      return kept !== undefined && kept !== bot.avatar?.image ? { ...bot, avatar: { ...bot.avatar, image: kept } } : bot
    })
    return bots.every((bot, index) => bot === team.bots[index]) ? team : { ...team, bots }
  }

  // One place every state answer goes through. An older in-flight poll must
  // not overwrite a newer write reply.
  const apply = useCallback((next: TeamState) => {
    if (next.revision < revision.current) return
    revision.current = next.revision
    if (typeof next.liveKey === 'string') liveKey.current = next.liveKey
    if (typeof next.modelsKey === 'string') modelsKey.current = next.modelsKey
    setTeam(prev => {
      const merged = next.unchanged === true && prev !== null ? { ...prev, ...next } : next
      return fillPhotos(withWrites(merged, writes.current), prev)
    })
  }, [])

  const call = useCallback(async (endpoint: string, payload: unknown = {}) => {
    const client = clientRef.current
    if (client === undefined) throw offline()
    await ensureUnlock(endpoint, payload)
    if (clientRef.current !== client) throw offline()
    try {
      if (endpoint === 'state' || endpoint === 'hello' || endpoint === 'notices') {
        return await callBot(client, endpoint, payload)
      }
      // Show the write's effect at once; the reply's state (or a full reload
      // on failure) puts the computer's truth back over it.
      const write: Write = { endpoint, payload: payload as Record<string, unknown> }
      if (OPTIMISTIC.has(endpoint)) writes.current.push(write)
      setTeam(prev => optimistic(prev, endpoint, write.payload))
      try {
        const answer = await callBotState<unknown>(client, endpoint, payload, stateRequest())
        writes.current = writes.current.filter(entry => entry !== write)
        if (answer.state !== undefined && clientRef.current === client) apply(answer.state)
        else if (PENDING_MUTATING.has(endpoint) && clientRef.current === client) pollRef.current()
        return answer.value
      } finally {
        writes.current = writes.current.filter(entry => entry !== write)
      }
    } catch (failure) {
      // Snap back to the computer's truth: forget the revision and re-read all.
      if (OPTIMISTIC.has(endpoint) && clientRef.current === client) {
        revision.current = -1
        pollRef.current()
      }
      throw localized(failure)
    }
  }, [apply, stateRequest])

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    revision.current = -1
    writes.current = []
    liveKey.current = undefined
    modelsKey.current = ''
    boot.current = undefined
    clientRef.current = undefined
    setTeam(null)
    setOnline(false)
    setLinkError(null)
    setPollError(null)
    setHello(null)
    const later = (run: () => void, ms: number) => { clearTimeout(timer); if (!stopped) timer = setTimeout(run, ms) }
    // One read at a time per client: a burst of feed events while a Bot works becomes one
    // read now and at most one more after it, not a pile of reads over a slow link.
    let reading: RpcClient | undefined
    let again = false
    const poll = async () => {
      const client = clientRef.current
      if (stopped || client === undefined) return
      if (reading === client) { again = true; return }
      reading = client
      again = false
      try {
        const next = await callBot<TeamState>(client, 'state', stateRequest())
        if (stopped || clientRef.current !== client) return
        apply(next)
        setPollError(null)
      } catch (failure) {
        if (!stopped && clientRef.current === client) setPollError(errorText(failure))
      } finally {
        if (reading === client) {
          reading = undefined
          if (!stopped && clientRef.current === client) {
            if (again) void poll()
            else later(() => void poll(), POLL_MS)
          }
        }
      }
    }
    pollRef.current = () => void poll()
    // The manager's state, as the screens show it. A new link reads the team at once.
    const sync = (snap: LinkSnapshot) => {
      if (stopped || snap.host !== computer.hostDeviceId) return
      if (snap.client !== clientRef.current) {
        clientRef.current = snap.client
        clearTimeout(timer)
        if (snap.client !== undefined) {
          const nextBoot = snap.hello?.boot
          if (boot.current !== nextBoot) {
            boot.current = nextBoot
            revision.current = -1
            liveKey.current = undefined
            modelsKey.current = ''
            writes.current = []
            setTeam(null)
            setPollError(null)
          }
          void poll()
        }
      }
      setOnline(snap.online)
      setHello(snap.hello)
      setLinkError(snap.error)
      if (snap.fatal) setTeam(null)
    }
    const unsubscribe = linkManager.subscribe(sync)
    const offFeed = linkManager.onFeed(event => {
      if (event === 'revision' || event === 'live' || event === LINK_REFRESH) void poll()
    })
    const release = linkManager.holdForScreen(computer, identity)
    // With "Keep connected in background" the link may already be up.
    sync(linkManager.snapshot())
    const foreground = AppState.addEventListener('change', status => {
      if (status !== 'active') { clearTimeout(timer); linkManager.background(); return }
      linkManager.foreground()
      if (clientRef.current !== undefined) void poll()
    })
    return () => {
      stopped = true
      clearTimeout(timer)
      foreground.remove()
      offFeed()
      unsubscribe()
      release()
      clientRef.current = undefined
    }
  }, [computer, identity, apply, stateRequest])

  const refresh = useCallback(() => pollRef.current(), [])
  const error = linkError ?? pollError

  return {
    team: switched ? null : team,
    online: switched ? false : online,
    linked: switched ? false : online,
    error: switched ? null : error,
    call,
    refresh,
    clientRef,
    hello: switched ? null : hello,
    onFeed,
  }
}

// Host errors mostly arrive in the plugin's English and are translated when the app knows
// them; the rest (Godbot writes some in Chinese) are shown exactly as they came.
function localized(failure: unknown): unknown {
  // The link dropping mid-call is the same state as being offline.
  if ((failure as { code?: unknown })?.code === 'TRANSPORT_CLOSED') return offline()
  if (failure instanceof Error) failure.message = hostText(failure.message)
  return failure
}
