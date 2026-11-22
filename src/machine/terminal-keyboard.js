// xterm already sends accepted physical keys to the PTY. If WebView also inserts
// one into the hidden textarea, LatinIME can offer it back as a composition.
;(() => {
  const surface = term.element
  let acceptedKey = null
  const clear = () => { acceptedKey = null }
  surface.addEventListener('keydown', clear, true)
  surface.addEventListener('keyup', clear, true)
  surface.addEventListener('blur', clear, true)
  term.onKey(({ domEvent }) => {
    if (!domEvent.isComposing && domEvent.keyCode !== 229 && domEvent.key?.length === 1)
      acceptedKey = domEvent.key
  })
  surface.addEventListener('beforeinput', (event) => {
    if (acceptedKey !== null && event.inputType === 'insertText' && !event.isComposing && event.data === acceptedKey) {
      event.preventDefault()
      clear()
    }
  }, true)
})()
