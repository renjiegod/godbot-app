// Own one Android touch sequence. Rotation, a modal, or responder termination may
// cancel it before Android delivers its original touch-up.
export class TrackpadHold {
  active = false
  private timer?: ReturnType<typeof setTimeout>
  start(onHold: () => void) {
    this.finish()
    this.active = true
    this.timer = setTimeout(() => {
      if (this.active) onHold()
    }, 450)
  }
  disarm() {
    clearTimeout(this.timer)
    this.timer = undefined
  }
  finish() {
    const active = this.active
    this.active = false
    this.disarm()
    return active
  }
}
