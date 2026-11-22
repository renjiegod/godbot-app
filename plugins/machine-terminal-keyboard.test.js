const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')

function keyboard() {
  const element = new EventTarget()
  let keyListener
  const term = { element, onKey: (fn) => { keyListener = fn } }
  const source = readFileSync(join(__dirname, '../src/machine/terminal-keyboard.js'), 'utf8')
  runInNewContext(source, { term })
  const input = (inputType, data, isComposing = false) => {
    const event = Object.assign(new Event('beforeinput', { cancelable: true }), { inputType, data, isComposing })
    element.dispatchEvent(event)
    return event.defaultPrevented
  }
  return {
    accept: (key, extra = {}) => keyListener({ domEvent: { key, ...extra } }),
    event: (type) => element.dispatchEvent(new Event(type)),
    input,
  }
}

test('only the browser insertion of an already accepted hardware key is suppressed', () => {
  const k = keyboard()
  for (const key of 'bookkeeper') {
    k.event('keydown')
    k.accept(key)
    assert.equal(k.input('insertText', key), true)
    assert.equal(k.input('insertText', key), false)
    k.event('keyup')
  }
  k.accept('a')
  assert.equal(k.input('insertText', 'A'), false)
  for (const end of ['keyup', 'blur', 'keydown']) {
    k.accept('x')
    k.event(end)
    assert.equal(k.input('insertText', 'x'), false)
  }
})

test('IME preedit, commit, cancel, paste and soft-keyboard input keep their native events', () => {
  const k = keyboard()
  k.accept('n', { keyCode: 229 })
  assert.equal(k.input('insertText', 'n'), false)
  k.accept('你', { isComposing: true })
  assert.equal(k.input('insertText', '你'), false)
  k.accept('n')
  assert.equal(k.input('insertCompositionText', 'ni', true), false)
  assert.equal(k.input('insertCompositionText', '', true), false)
  assert.equal(k.input('insertText', '你好'), false)
  assert.equal(k.input('insertFromPaste', 'n'), false)
  assert.equal(k.input('insertText', 'n', true), false)
  k.event('keyup')
  assert.equal(k.input('insertText', '你'), false)
})
