import type { RpcClient } from '../../godbot/link/index.ts'
import { DESKTOP_CONSENT_TIMEOUT_MS, machineEndReason, machineError, machineHello, type ComputerHello, type Mode, type Session } from './model.ts'

export interface MachineState {
  connecting: boolean
  hello?: ComputerHello
  session?: Session
  error?: string
}
export class MachineConnection {
  client?: RpcClient
  private closed = false
  private heartbeat?: ReturnType<typeof setTimeout>
  private serial = 0
  private controlVersion = 0
  private updatingControl = false
  private state: MachineState = { connecting: true }
  private update: (value: MachineState) => void
  constructor(update: (value: MachineState) => void) {
    this.update = update
  }
  private publish(patch: Partial<MachineState>) {
    this.state = { ...this.state, ...patch }
    if (!this.closed) this.update(this.state)
  }
  async connect(open: (capture: (client: RpcClient) => void) => Promise<RpcClient>) {
    try {
      const client = await open((c) => {
        this.client = c
        if (this.closed) void c.close()
      })
      if (this.closed) return
      client.onClose(() => {
        if (!this.closed) this.lost('Connection lost')
      })
      const hello = await machineHello(client)
      if (this.closed) return
      this.publish({ connecting: false, hello, error: undefined })
      return hello
    } catch (e) {
      if (!this.closed) this.lost(machineError(e))
    }
  }
  async refresh() {
    if (!this.client || this.closed) return
    try {
      const hello = await machineHello(this.client)
      this.publish({ hello, error: undefined })
    } catch (error) {
      if (!this.closed) this.publish({ error: machineError(error) })
    }
  }
  private lost(reason: string) {
    this.serial++
    clearTimeout(this.heartbeat)
    this.publish({ connecting: false, hello: undefined, session: undefined, error: reason })
    this.closed = true
    void this.client?.close()
  }
  private accept(session: Session) {
    if (session.state === 'denied' || session.state === 'closed') {
      clearTimeout(this.heartbeat)
      this.publish({ session: undefined, error: machineEndReason(session.reason) })
      return false
    }
    const reason = session.controlReason
    const showControlReason = (reason === 'INPUT_DENIED' || reason === 'INPUT_REVOKED')
      && this.state.session?.controlReason !== reason
    this.publish({ session, ...(showControlReason && { error: machineError({ code: reason }) }) })
    return true
  }
  async start(mode: Mode, requestId: string) {
    if (this.closed || this.state.connecting || this.state.session || !this.client) return
    const serial = ++this.serial
    try {
      this.publish({ connecting: true, error: undefined })
      const session = await this.client.rpc<Session>('session.open', { mode, requestId })
      if (this.closed || serial !== this.serial) {
        await this.client.rpc('session.close', { sessionId: session.sessionId }).catch(() => {})
        return
      }
      this.publish({ connecting: false })
      if (this.accept(session)) this.scheduleRenew(session.sessionId, serial)
    } catch (e) {
      if (serial === this.serial) this.publish({ connecting: false, error: machineError(e) })
    }
  }
  private scheduleRenew(sessionId: string, serial: number) {
    this.heartbeat = setTimeout(async () => {
      if (this.closed || serial !== this.serial || !this.client) return
      try {
        const version = this.controlVersion
        const session = await this.client.rpc<Session>('session.renew', { sessionId }, { timeoutMs: 3000 })
        if (this.closed || serial !== this.serial) return
        const staleControl = session.state === 'approved' && (version !== this.controlVersion || this.updatingControl)
        if (staleControl || this.accept(session)) this.scheduleRenew(sessionId, serial)
      } catch (e) {
        if (!this.closed && serial === this.serial) this.lost(machineError(e))
      }
    }, 1500)
  }
  async control(grant: boolean) {
    const current = this.state.session
    if (!current || this.closed || !this.client) return
    if (this.updatingControl) {
      // Closing the session dismisses an unresolved OS chooser on the target.
      if (!grant && current.controlPending) await this.end()
      return
    }
    const version = ++this.controlVersion
    this.updatingControl = true
    this.publish({ session: { ...current, control: false, controlPending: grant, controlReason: undefined }, error: undefined })
    try {
      const session = await this.client.rpc<Session>(
        grant ? 'desktop.requestControl' : 'desktop.releaseControl',
        { sessionId: current.sessionId },
        { timeoutMs: grant ? DESKTOP_CONSENT_TIMEOUT_MS : 6000 },
      )
      if (version === this.controlVersion && this.state.session?.sessionId === current.sessionId) this.accept(session)
    } catch (e) {
      if (version === this.controlVersion && this.state.session?.sessionId === current.sessionId)
        this.publish({ session: { ...current, control: false, controlPending: false }, error: machineError(e) })
    } finally {
      if (version === this.controlVersion) this.updatingControl = false
    }
  }
  async end(reason?: string) {
    ++this.serial
    ++this.controlVersion
    this.updatingControl = false
    clearTimeout(this.heartbeat)
    const session = this.state.session
    this.publish({ session: undefined, connecting: false, error: reason })
    if (session)
      await this.client?.rpc('session.close', { sessionId: session.sessionId }, { timeoutMs: 2500 }).catch(() => {})
  }
  dispose() {
    this.closed = true
    ++this.serial
    ++this.controlVersion
    this.updatingControl = false
    clearTimeout(this.heartbeat)
    void this.client?.close()
  }
}
