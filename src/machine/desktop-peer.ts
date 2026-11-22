import { MediaStream, RTCPeerConnection } from 'react-native-webrtc'
import type { RpcClient } from '../../godbot/link/index.ts'
import { DESKTOP_CONSENT_TIMEOUT_MS, type Display, type Session } from './model.ts'
import { desktopIceConfig, DesktopReadiness } from './desktop-readiness.ts'

type Candidate = { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null }
type Signal = { type: 'answer'; sdp: string } | { type: 'candidate'; candidate: Candidate }
type Input = {
  type: 'move' | 'button' | 'wheel' | 'text' | 'key' | 'reset'
  x?: number
  y?: number
  button?: number
  down?: boolean
  dx?: number
  dy?: number
  text?: string
  code?: string
}
export interface DesktopStats {
  live: boolean
  offerAccepted?: boolean
  route?: string
  codec?: string
  width?: number
  height?: number
  bytes?: number
  drops?: number
  kbps?: number
  fps?: number
  rtt?: number
}

export function connectDesktop(
  client: RpcClient,
  session: Session,
  display: Display,
  generation: number,
  relayOnly: boolean,
  quality: 'balanced' | 'low',
  onStream: (url: string) => void,
  onStats: (stats: DesktopStats) => void,
  onError: (err: unknown) => void,
) {
  const abort = new AbortController(),
    { signal } = abort
  const pc = new RTCPeerConnection(desktopIceConfig(session.iceServers, relayOnly))
  const channel = pc.createDataChannel('godbot-input-v1', { ordered: true })
  const params = { sessionId: session.sessionId, displayId: display.id, generation }
  const candidates: Candidate[] = []
  let offered = false,
    stream: MediaStream | undefined
  let tail = Promise.resolve()
  let timer: ReturnType<typeof setInterval> | undefined
  const readiness = new DesktopReadiness(fail)
  function close() {
    if (signal.aborted) return
    abort.abort()
    readiness.dispose()
    clearInterval(timer)
    // If the channel can still transmit, release held keys before closing the transport.
    try {
      if (channel.readyState === 'open')
        channel.send(JSON.stringify({ type: 'reset', displayId: display.id, revision: display.revision }))
    } catch {
      // A concurrent transport loss can close the channel between the state read and send.
    }
    channel.close()
    pc.close()
    stream?.release(false)
  }
  function fail(error: unknown) {
    if (signal.aborted) return
    try {
      close()
    } finally {
      onError(error)
    }
  }
  function sendCandidate(candidate: Candidate) {
    if (!offered) {
      candidates.push(candidate)
      return
    }
    tail = tail
      .then(async () => {
        if (!signal.aborted)
          await client.rpc('desktop.signal', { ...params, signal: { type: 'candidate', candidate } }, { signal })
      })
      .catch(fail)
  }
  pc.addEventListener('icecandidate', (e) => {
    if (e.candidate) sendCandidate(e.candidate.toJSON())
  })
  pc.addEventListener('track', (e) => {
    if (signal.aborted || !e.track) return
    stream = e.streams[0] ?? new MediaStream()
    if (!e.streams[0]) stream.addTrack(e.track)
    onStream(stream.toURL())
  })
  pc.addEventListener('connectionstatechange', () => readiness.connectionChanged(pc.connectionState))
  pc.addEventListener('iceconnectionstatechange', () => readiness.connectionChanged(pc.iceConnectionState))
  pc.addTransceiver('video', { direction: 'recvonly' })
  async function negotiate() {
    const offer = await pc.createOffer()
    if (signal.aborted) return
    await pc.setLocalDescription(offer)
    await client.rpc(
      'desktop.signal',
      { ...params, quality, signal: { type: 'offer', sdp: offer.sdp } },
      { signal, timeoutMs: DESKTOP_CONSENT_TIMEOUT_MS },
    )
    if (signal.aborted) return
    offered = true
    readiness.offerAccepted()
    for (const c of candidates.splice(0)) sendCandidate(c)
    let cursor = 0
    const queued: Candidate[] = []
    while (!signal.aborted) {
      const batch = await client.rpc<{ cursor: number; signals: Signal[] }>(
        'desktop.poll',
        { ...params, cursor, waitMs: 900 },
        { signal, timeoutMs: 6000 },
      )
      for (const entry of batch.signals) {
        if (signal.aborted) return
        if (entry.type === 'answer') {
          await pc.setRemoteDescription(entry)
          for (const c of queued.splice(0)) await pc.addIceCandidate(c)
        } else if (pc.remoteDescription) await pc.addIceCandidate(entry.candidate)
        else queued.push(entry.candidate)
      }
      cursor = batch.cursor
      if (!batch.signals.length) await new Promise((resolve) => setTimeout(resolve, 80))
    }
  }
  void negotiate().catch(fail)
  let reading = false
  let previousBytes = 0,
    previousAt = Date.now()
  timer = setInterval(async () => {
    if (reading || signal.aborted) return
    reading = true
    try {
      const stats = await pc.getStats()
      if (signal.aborted) return
      const values = [...stats.values()]
      const inbound = values.find((r) => r.type === 'inbound-rtp' && (r.kind === 'video' || r.mediaType === 'video'))
      const transport = values.find((r) => r.type === 'transport' && r.selectedCandidatePairId)
      const pair =
        stats.get(transport?.selectedCandidatePairId) ??
        values.find((r) => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded')
      if (inbound?.framesDecoded > 0) readiness.frameDecoded()
      const at = Date.now()
      const bytes = inbound?.bytesReceived
      const kbps =
        typeof bytes === 'number' && at > previousAt
          ? Math.round(((bytes - previousBytes) * 8) / (at - previousAt))
          : undefined
      if (typeof bytes === 'number') {
        previousBytes = bytes
        previousAt = at
      }
      onStats({
        offerAccepted: offered,
        width: inbound?.frameWidth,
        height: inbound?.frameHeight,
        bytes,
        drops: inbound?.framesDropped,
        kbps,
        live: readiness.live,
        route: pair
          ? [stats.get(pair.localCandidateId), stats.get(pair.remoteCandidateId)].some(
              (c) => c?.candidateType === 'relay',
            )
            ? 'TURN'
            : 'Direct'
          : undefined,
        codec: stats.get(inbound?.codecId)?.mimeType?.split('/')[1],
        fps: inbound?.framesPerSecond,
        rtt: pair?.currentRoundTripTime === undefined ? undefined : Math.round(pair.currentRoundTripTime * 1000),
      })
    } catch {
      // An unavailable stats sample does not change the negotiated route. Startup
      // retains its independent first-frame timer even when native getStats stalls.
    } finally {
      reading = false
    }
  }, 1000)
  return {
    send(event: Input) {
      if (!signal.aborted && channel.readyState === 'open' && (event.type !== 'move' || channel.bufferedAmount < 16384))
        channel.send(JSON.stringify({ ...event, displayId: display.id, revision: display.revision }))
    },
    close,
  }
}
export type DesktopPeer = ReturnType<typeof connectDesktop>
