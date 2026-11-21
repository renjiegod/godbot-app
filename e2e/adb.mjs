// Small adb + uiautomator helpers for the emulator scripts. No dependencies.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE = 'io.github.renjiegod.godbot'
export const ARTIFACTS = join(dirname(fileURLToPath(import.meta.url)), 'artifacts')
const ADB = process.env.ADB ?? (process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : 'adb')

export function adb(args, { input, binary = false, timeout = 60_000 } = {}) {
  const serial = process.env.ANDROID_SERIAL ? ['-s', process.env.ANDROID_SERIAL] : []
  return execFileSync(ADB, [...serial, ...args], { input, timeout, maxBuffer: 64 * 1024 * 1024, encoding: binary ? 'buffer' : 'utf8' })
}

/** Runs one command in the device shell; `command` is quoted for the remote sh already. */
export const shell = (command, options) => adb(['shell', command], options)

/** Quotes a value for the device's sh. */
export const quote = value => `'${String(value).replaceAll("'", `'\\''`)}'`

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const decode = value => value.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&#10;', '\n').replaceAll('&amp;', '&')

const UI_FILE = '/sdcard/godbot-ui.xml'

/** The window that has the input focus, as the window manager names it ('' when unknown). */
export function focusedWindow() {
  try { return /mCurrentFocus=(.*)/.exec(shell('dumpsys window | grep mCurrentFocus'))?.[1]?.trim() ?? '' } catch { return '' }
}

/**
 * The current screen as a flat list of uiautomator nodes (none when it cannot be read).
 *
 * `uiautomator dump` waits for the screen to go idle, and while the on-screen keyboard
 * is up it never does on these emulators: after 10 s it gives up ("could not get idle
 * state") and writes nothing. So the keyboard is closed first (Back closes only the
 * keyboard while it is up), but only in the app: in front of a system prompt such as
 * the PIN prompt, Back would cancel the prompt. The file is removed before each try:
 * reading the one a failed dump left behind would return a screen that is gone.
 */
export function dumpUi() {
  let xml = ''
  for (let attempt = 0; attempt < 3 && !xml.includes('<hierarchy'); attempt += 1) {
    if (keyboardShown() && focusedWindow().includes(PACKAGE)) shell('input keyevent 4; sleep 0.5')
    try {
      xml = shell(`rm -f ${UI_FILE}; uiautomator dump ${UI_FILE} >/dev/null 2>&1; cat ${UI_FILE} 2>/dev/null`)
    } catch { xml = '' /* the dump fails while the screen changes; try again */ }
  }
  const nodes = []
  // UIAutomator uses single-quoted attributes for text containing JSON quotes.
  for (const match of xml.matchAll(/<node\s+((?:[^"'<>]|"[^"]*"|'[^']*')*)>/g)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)]
      .map(([, key, double, single]) => [key, decode(double ?? single)]))
    const box = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(attrs.bounds ?? '')
    if (box === null) continue
    const [x1, y1, x2, y2] = box.slice(1).map(Number)
    nodes.push({ text: attrs.text ?? '', desc: attrs['content-desc'] ?? '', hint: attrs.hint ?? '', id: attrs['resource-id'] ?? '', cls: attrs.class ?? '', pkg: attrs.package ?? '', clickable: attrs.clickable === 'true', checked: attrs.checked === 'true', bounds: { x1, y1, x2, y2 } })
  }
  return { nodes, xml }
}

export const label = node => `${node.text}${node.desc ? ` [${node.desc}]` : ''}`

/** First node whose text, content description or input hint matches one of the patterns. */
export function find(nodes, ...patterns) {
  for (const pattern of patterns) {
    const test = typeof pattern === 'string' ? value => value === pattern : value => pattern.test(value)
    const hit = nodes.find(node => test(node.text) || test(node.desc) || (node.hint !== '' && test(node.hint)))
    if (hit) return hit
  }
  return undefined
}

/** A node matching `pattern` on the same row as `anchor` (vertically overlapping, to its right). */
export function findInRow(nodes, anchor, ...patterns) {
  const row = nodes.filter(node => node.bounds.y1 < anchor.bounds.y2 + 4 && node.bounds.y2 > anchor.bounds.y1 - 4 && node !== anchor)
  return find(row, ...patterns)
}

/** An input field by its placeholder: uiautomator reports it as `hint`, or as the text while empty. */
export function field(nodes, ...patterns) {
  const inputs = nodes.filter(node => node.cls.endsWith('EditText'))
  return find(inputs, ...patterns)
}

export const center = node => [Math.round((node.bounds.x1 + node.bounds.x2) / 2), Math.round((node.bounds.y1 + node.bounds.y2) / 2)]

export function keyboardShown() {
  try { return /mInputShown=true/.test(shell('dumpsys input_method')) } catch { return false }
}

/** Closes the app's on-screen keyboard; never navigates back, never touches a system prompt. */
export async function hideKeyboard() {
  if (!keyboardShown() || !focusedWindow().includes(PACKAGE)) return
  shell('input keyevent 4')
  await sleep(400)
}

/** Selects all text in the focused field and deletes it. */
export function clearFocused() {
  shell('input keycombination 113 29')
  shell('input keyevent 67')
}

export function tap(node) {
  const { x1, y1, x2, y2 } = node.bounds
  shell(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`)
}

export function longPress(node, ms = 1200) {
  const { x1, y1, x2, y2 } = node.bounds
  const x = Math.round((x1 + x2) / 2)
  const y = Math.round((y1 + y2) / 2)
  shell(`input swipe ${x} ${y} ${x} ${y} ${ms}`)
}

/** Types text into the focused field (adb input text cannot take spaces or quotes as is). */
export function typeText(text) {
  const escaped = String(text).replace(/[\\'"`$&|;<>()*~!?#]/g, char => `\\${char}`).replaceAll(' ', '%s')
  shell(`input text ${escaped}`)
}

let size
/** The screen's width and height in pixels. */
export function screenSize() {
  if (size === undefined) {
    const match = /(\d+)x(\d+)\s*$/.exec(shell('wm size').trim())
    size = match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 1080, height: 2400 }
  }
  return size
}

let area
/**
 * The band of the screen a tap reaches the app in: below the status bar and a screen
 * header, above the navigation bar (read from the window manager's insets).
 */
export function tappableArea() {
  if (area === undefined) {
    const { height } = screenSize()
    let statusBottom = Math.round(height * 0.06)
    let navTop = Math.round(height * 0.94)
    try {
      const text = shell('dumpsys window')
      const nav = /type=navigationBars frame=\[\d+,(\d+)\]\[\d+,\d+\]/.exec(text)
      const status = /type=statusBars frame=\[\d+,\d+\]\[\d+,(\d+)\]/.exec(text)
      if (nav && Number(nav[1]) > height / 2) navTop = Number(nav[1])
      if (status) statusBottom = Number(status[1])
    } catch { /* keep the estimates */ }
    // A screen's own header (Back, the title) sits under the status bar.
    area = { top: statusBottom + 160, bottom: navTop }
  }
  return area
}

/**
 * Swipes the content until `check(nodes)` finds something a tap can reach. A row under
 * the navigation bar is in the dump too, but a tap there lands on the bar: on the Home
 * button, for a row in the middle.
 */
export async function scrollTo(check, what, { swipes = 8 } = {}) {
  const { width, height } = screenSize()
  const { top, bottom } = tappableArea()
  const x = Math.round(width / 2)
  for (let i = 0; i <= swipes; i += 1) {
    const found = check(dumpUi().nodes)
    const middle = found ? (found.bounds.y1 + found.bounds.y2) / 2 : 0
    if (found && middle >= top + 24 && middle <= bottom - 24) return found
    // Slow swipes, so the list does not fling past what was found.
    if (found && middle < top + 24) shell(`input swipe ${x} ${Math.round(height * 0.4)} ${x} ${Math.round(height * 0.6)} 800`)
    else if (found) shell(`input swipe ${x} ${Math.round(height * 0.6)} ${x} ${Math.round(height * 0.4)} 800`)
    else shell(`input swipe ${x} ${Math.round(height * 0.7)} ${x} ${Math.round(height * 0.3)} 400`)
    await sleep(700)
  }
  throw new Error(`Could not scroll to ${what}`)
}

/** Polls the screen until `check(nodes)` returns something truthy. */
export async function waitFor(check, what, { timeout = 30_000, every = 1_000 } = {}) {
  const started = Date.now()
  let last = { nodes: [] }
  while (Date.now() - started < timeout) {
    last = dumpUi()
    const found = check(last.nodes)
    if (found) return found
    await sleep(every)
  }
  const seen = last.nodes.map(label).filter(Boolean).slice(0, 60).join(' | ')
  throw new Error(`Timed out after ${timeout} ms waiting for ${what}. On screen: ${seen}`)
}

export function screenshot(name) {
  mkdirSync(ARTIFACTS, { recursive: true })
  const path = join(ARTIFACTS, `${name}.png`)
  writeFileSync(path, adb(['exec-out', 'screencap', '-p'], { binary: true }))
  return path
}

export function saveUi(name) {
  mkdirSync(ARTIFACTS, { recursive: true })
  const { xml } = dumpUi()
  const path = join(ARTIFACTS, `${name}.xml`)
  writeFileSync(path, xml)
  return path
}

export function install(apk) {
  adb(['install', '-r', '-g', apk], { timeout: 180_000 })
}

export function launch() {
  shell(`monkey --pct-syskeys 0 -p ${PACKAGE} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`)
}

export function openUrl(url) {
  shell(`am start -W -a android.intent.action.VIEW -d ${quote(url)} ${PACKAGE}`)
}
