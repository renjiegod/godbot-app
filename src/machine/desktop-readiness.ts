import type { Session } from './model.ts'

export function hasTurnServer(servers: Session['iceServers']) {
  return (
    servers?.some(({ urls }) => (Array.isArray(urls) ? urls : [urls]).some((url) => /^turns?:[^?\s]+/i.test(url))) ??
    false
  )
}

export function desktopIceConfig(servers: Session['iceServers'], relayOnly: boolean) {
  if (relayOnly && !hasTurnServer(servers)) throw new Error('The computer has no TURN relay available.')
  return { iceServers: servers ?? [], iceTransportPolicy: relayOnly ? ('relay' as const) : ('all' as const) }
}

export class DesktopReadiness {
  live = false
  private timer?: ReturnType<typeof setTimeout>
  private ended = false
  private readonly fail: (error: Error) => void
  constructor(fail: (error: Error) => void) {
    this.fail = fail
  }

  offerAccepted() {
    if (this.ended || this.live || this.timer) return
    this.timer = setTimeout(() => this.stop('Desktop sent no frames'), 25_000)
  }
  frameDecoded() {
    if (this.ended) return
    this.live = true
    clearTimeout(this.timer)
  }
  connectionChanged(state: string) {
    // Native libwebrtc may transiently fail as the answer and trickled candidates arrive.
    if (state === 'closed' || (this.live && (state === 'disconnected' || state === 'failed')))
      this.stop('Desktop connection failed')
  }
  private stop(message: string) {
    if (this.ended) return
    this.dispose()
    this.fail(new Error(message))
  }
  dispose() {
    this.ended = true
    this.live = false
    clearTimeout(this.timer)
  }
}
