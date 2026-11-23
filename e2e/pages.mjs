// Every page of the app against a real Godbot: pair through a fresh link, then on each page
// read, write, and check through the computer's own team channel that the write arrived.
// Screenshots go to e2e/artifacts/pages-<page>.png and the results to pages-results.json.
//
//   GODBOT_E2E_CONTROL   the test computer's control server (default http://127.0.0.1:47781):
//                        GET /info, POST /pair -> {uri}, POST /channel {endpoint, payload}
//   GODBOT_E2E_APK       the APK to install (default: the release build)
//   ANDROID_SERIAL       the emulator
//   --only a,b           run only these pages
//
// Gated writes (keys, secrets, connectors, capabilities) ask for the screen lock: the script
// sets PIN 1234 for the run, enters it when asked, and clears it at the end.
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  adb, ARTIFACTS, clearFocused, dumpUi, field, find, findInRow, focusedWindow, hideKeyboard, install, launch, openUrl,
  PACKAGE, saveUi, screenshot, scrollTo, shell, sleep, tap, typeText, waitFor,
} from './adb.mjs'
// The app's own wording for the update phase (Node runs the TypeScript as is).
import { pluginUpdateText } from '../src/team/plugin-update.ts'
import { setLang } from '../src/ui/i18n.ts'

setLang('en')

const APP = dirname(dirname(fileURLToPath(import.meta.url)))
const CONTROL = process.env.GODBOT_E2E_CONTROL ?? 'http://127.0.0.1:47781'
const APK = process.env.GODBOT_E2E_APK ?? join(APP, 'android/app/build/outputs/apk/release/app-release.apk')
const PIN = '1234'
const TAG = Date.now().toString(36).slice(-5)

// ---------------------------------------------------------------- the computer

async function control(path, body) {
  const headers = { connection: 'close' }
  const request = body === undefined ? { headers } : {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }
  const response = await fetch(CONTROL + path, request).catch(error => {
    throw new Error(`${body?.endpoint ?? path}: ${error.cause?.message ?? error.message}`, { cause: error })
  })
  return response.json()
}

async function channel(endpoint, payload = {}) {
  const answer = await control('/channel', { endpoint, payload })
  if (answer.ok !== true) throw Object.assign(new Error(`${endpoint}: ${answer.error?.message ?? answer.error ?? 'failed'}`), { code: answer.code ?? answer.error?.code })
  return answer.value
}

/** Asks the computer until `check` holds; returns the last answer. */
async function until(read, check, what, timeout = 25_000) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeout) {
    try { last = await read() } catch (error) { last = error }
    if (!(last instanceof Error) && check(last)) return last
    await sleep(700)
  }
  throw new Error(`The computer never showed ${what}. Last answer: ${JSON.stringify(last instanceof Error ? last.message : last)?.slice(0, 400)}`)
}

const state = () => channel('state', {})
const botNamed = (team, name) => team.bots.find(bot => bot.name === name)

// ---------------------------------------------------------------- the phone

const ui = () => dumpUi().nodes
const wait = (what, ...patterns) => waitFor(nodes => find(nodes, ...patterns), what)
const tapOn = async (what, ...patterns) => { const node = await wait(what, ...patterns); tap(node); await sleep(600); return node }
// Overlays (the drawer, a sheet, a dialog) come later in the dump than the screen under them.
const lastWhere = (nodes, check) => nodes.filter(check).at(-1)
const findAllIn = (nodes, pattern) => nodes.filter(node => (typeof pattern === 'string' ? node.text === pattern || node.desc === pattern : pattern.test(node.text) || pattern.test(node.desc)))

/**
 * Types into a field, presses Enter when `submit`, then closes the keyboard: the screen
 * can only be read with the keyboard down (see dumpUi), and a button the keyboard pushed
 * up would otherwise be tapped where it was before.
 */
async function typeInto(fieldNode, text, { clear = false, submit = false } = {}) {
  tap(fieldNode)
  await sleep(400)
  if (clear) clearFocused()
  typeText(text)
  await sleep(300)
  if (submit) { shell('input keyevent 66'); await sleep(400) }
  await hideKeyboard()
}

/** Fills the input whose placeholder (or text) matches `pattern`. */
async function fill(what, pattern, text, options) {
  const input = await waitFor(nodes => field(nodes, pattern), `the ${what} field`)
  await typeInto(input, text, options)
}

/** A system dialog's button, matched without regard to case (Material may capitalize it). */
async function alertTap(text) {
  const pattern = new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
  const button = await waitFor(nodes => nodes.find(node => node.pkg === PACKAGE && /Button/.test(node.cls) && (pattern.test(node.text) || pattern.test(node.desc))) ?? nodes.find(node => node.id.startsWith('android:id/button') && pattern.test(node.text)), `the dialog button ${text}`)
  tap(button)
  await sleep(600)
}

/**
 * When the screen lock is asked for, enters the PIN. Resolves whether it was asked.
 * The prompt is a system window named BiometricPrompt with its PIN field already focused
 * and the keyboard up, so it is found through the window manager, not by reading the
 * screen (which cannot be read while the keyboard is up), and the PIN is typed as is.
 */
async function unlockIfAsked(timeout = 8_000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const focus = focusedWindow()
    if (/BiometricPrompt/.test(focus)) {
      await sleep(700)
      typeText(PIN)
      shell('input keyevent 66')
      const closing = Date.now()
      while (/BiometricPrompt/.test(focusedWindow())) {
        if (Date.now() - closing > 10_000) throw new Error('The PIN prompt did not close')
        await sleep(400)
      }
      await sleep(500)
      return true
    }
    if (focus.includes(PACKAGE) && Date.now() - started > 3_500) return false
    await sleep(400)
  }
  return false
}

async function relaunch() {
  shell(`am force-stop ${PACKAGE}`)
  launch()
  await waitFor(nodes => nodes.find(node => node.cls.endsWith('EditText') && /^Message /.test(node.desc || node.text || node.hint)), 'the chat to load', { timeout: 60_000 })
  await sleep(800)
}

async function openDrawer() {
  await tapOn('the team list button', 'Open team list')
  await sleep(500)
}

async function openChatOf(name) {
  await openDrawer()
  // The chat's own title stays in the hierarchy behind the drawer.
  const row = await waitFor(nodes => lastWhere(nodes, node => (node.text === name || node.desc === name || node.desc === `${name}, Main Bot`) && node.bounds.x1 < 700 && node.bounds.y1 > 230), `${name} in the team list`)
  tap(row)
  await sleep(1_000)
}

async function openBotDetails(name) {
  await openChatOf(name)
  const pill = await waitFor(nodes => nodes.find(node => node.text === name && node.bounds.y2 < 320), `${name}'s chat header`)
  tap(pill)
  await wait(`${name}'s details`, 'Edit Bot')
  await sleep(500)
}

async function openSettingsPage(row) {
  await openDrawer()
  await tapOn('the Settings button', 'Settings')
  await wait('Settings', 'Done')
  const node = await scrollTo(nodes => find(nodes, row), `the ${row} row`)
  tap(node)
  await sleep(1_200)
}

// ---------------------------------------------------------------- the run

const results = []
let current = null
// `--only secrets,providers` runs just those pages (group, folder and bot-delete use the
// Bot the bot page creates).
const onlyAt = process.argv.indexOf('--only')
const ONLY = onlyAt === -1 ? null : new Set(String(process.argv[onlyAt + 1] ?? '').split(',').filter(Boolean))

async function page(name, endpoint, fn) {
  if (ONLY !== null && !ONLY.has(name)) return
  current = { page: name, endpoint, read: '', write: '', ok: false }
  const started = Date.now()
  try {
    await relaunch()
    await fn(current)
    current.ok = true
    console.log(`✓ ${name}: read ${current.read}; write ${current.write}`)
  } catch (error) {
    current.error = String(error.message ?? error)
    console.log(`✗ ${name}: ${current.error}`)
    try { saveUi(`pages-${name}-failed`); screenshot(`pages-${name}-failed`) } catch { /* no device */ }
  }
  current.seconds = Math.round((Date.now() - started) / 1000)
  results.push(current)
}

const shot = name => screenshot(`pages-${name}`)

async function main() {
  if (!existsSync(APK)) throw new Error(`No APK at ${APK}`)
  const info = await control('/info')
  const port = /:(\d+)\//.exec(decodeURIComponent(info.relay ?? info.pairing ?? ''))?.[1]
  if (!port) throw new Error(`No relay port in ${JSON.stringify(info)}`)

  // A screen lock for the gated writes; the screen stays on so the lock screen never shows.
  shell(`locksettings clear --old ${PIN} >/dev/null 2>&1 || true`)
  shell(`locksettings set-pin ${PIN}`)
  shell('svc power stayon true')

  install(APK)
  shell(`pm clear ${PACKAGE}`)
  shell(`pm grant ${PACKAGE} android.permission.POST_NOTIFICATIONS`)
  adb(['reverse', `tcp:${port}`, `tcp:${port}`])
  const { uri } = await control('/pair', {})
  openUrl(uri)
  await tapOn('the pairing confirmation', 'Pair')
  await relaunch()
  console.log(`✓ paired through ${info.relay}`)

  const team0 = await state()
  const main = team0.bots.find(bot => bot.id === team0.mainBotId) ?? team0.bots[0]
  const botName = `E2E ${TAG}`
  const renamed = `E2E ${TAG} renamed`

  await page('parity', 'section-save · update-bot · bot-new-part · bot-open-part', async (r) => {
    const name = `Parity Bot ${TAG}`
    await openDrawer()
    await wait('the open team drawer', 'New section')
    const section = await channel('section-save', { name: `Parity Group ${TAG}` })
    const bot = await channel('create-bot', { name, sectionId: section.id })
    const chat = () => channel('chat', { botId: bot.id })
    const activeBot = async () => (await state()).bots.find(entry => entry.id === bot.id)
    const first = (await activeBot()).sessionId
    const firstMessage = `First session ${TAG}`
    const secondMessage = `Second session ${TAG}`
    const waitIdle = sessionId => until(state, team => team.partsRunning?.[sessionId] !== true && team.newSessions?.[bot.id] !== 'opening', 'the session done opening and running')
    const seed = async (sessionId, marker) => {
      await control('/reply', { text: `Reply to ${marker}` })
      await channel('send', { sessionId, text: marker })
      await until(chat, value => value.sessionId === sessionId && value.items.some(item => item.kind === 'user' && item.text === marker)
        && value.items.some(item => item.kind === 'bot' && item.text === `Reply to ${marker}`), `the exchange in ${marker}`)
      await waitIdle(sessionId)
    }
    try {
      await wait('the section made on Web', section.name)
      shot('parity-roster')
      await tapOn('the shared section toggle', section.name)
      await until(state, team => team.sections?.some(entry => entry.id === section.id && entry.collapsed), 'the Android section collapse on Web')
      await channel('section-save', { id: section.id, collapsed: false })
      r.read = 'Web group reflected on Android'
      r.write = 'Android group collapse confirmed through Web'
      await tapOn('the Bot in the shared section', name)
      await seed(first, firstMessage)
      await wait('the first transcript', firstMessage)
      await openBotDetails(name)
      const nameInput = await waitFor(nodes => field(nodes, 'Bot name'), 'the Bot name field')
      await typeInto(nameInput, `${name} edited`, { clear: true, submit: true })
      await until(activeBot, value => value?.name === `${name} edited`, 'the Android edit on the Web channel')
      r.write += ', Android rename confirmed through Web'
      await wait('the sessions heading', 'Sessions')
      shot('parity-details')
      tap(await scrollTo(nodes => find(nodes, 'Read only'), 'the host Read only permission'))
      await until(activeBot, value => value?.permission === 'read-only', 'the Android permission change on Web')
      r.write += ', Android permission change confirmed through Web'
      await tapOn('the new session button', 'New session')
      const next = await until(activeBot, value => value?.sessionId !== undefined && value.sessionId !== first, 'the new Android session on Web')
      await waitIdle(next.sessionId)
      await seed(next.sessionId, secondMessage)
      await wait('the second transcript', secondMessage)
      await openBotDetails(`${name} edited`)
      // A computer that names sessions by the first thing asked in them shows that name;
      // an older one numbers them.
      await tapOn('the original session', firstMessage, 'Session 1')
      await until(activeBot, value => value?.sessionId === first, 'the session opened on Android on Web')
      r.write += ', Android session changes confirmed through Web'
      await wait('the original transcript on Android', firstMessage)
      await channel('bot-open-part', { botId: bot.id, sessionId: next.sessionId })
      await wait('the session selected on Web, reflected on Android', secondMessage)
      if (find(ui(), firstMessage)) throw new Error('The first session transcript is still visible after the Web switch')
      r.read += ', Web session switch reflected on Android'
    } finally {
      await channel('delete-bot', { id: bot.id })
      await channel('section-delete', { id: section.id })
      await control('/reply', { text: 'Fixture acknowledged' })
    }
  })

  await page('bot', 'create-bot · update-bot · delete-bot', async (r) => {
    await openBotDetails(main.name)
    await scrollTo(nodes => find(nodes, 'Working folder'), 'the working folder')
    r.read = `${main.name}'s details (model, folder, memory, usage, schedules)`
    // Create a Bot, from the team list of the chat.
    await tapOn('Back', 'Back')
    await openDrawer()
    await tapOn('New', 'New')
    await tapOn('Create new Bot', 'Create new Bot')
    await fill('name', /^New Bot$/, botName)
    await tapOn('Create', 'Create')
    const created = await until(state, team => botNamed(team, botName) !== undefined, `a Bot named ${botName}`)
    r.botId = botNamed(created, botName).id
    // Rename it in its settings.
    await relaunch()
    await openBotDetails(botName)
    await tapOn('Edit Bot', 'Edit Bot')
    const nameField = await waitFor(nodes => nodes.find(node => node.cls.endsWith('EditText') && node.text === botName), 'the Name field')
    // The name is saved when the field loses focus; Enter ends the editing.
    await typeInto(nameField, renamed, { clear: true, submit: true })
    await until(state, team => team.bots.some(bot => bot.id === r.botId && bot.name === renamed), `the Bot renamed to ${renamed}`)
    shot('bot')
    r.write = `create-bot "${botName}", update-bot name → "${renamed}" (delete-bot at the end)`
  })

  await page('group', 'create-room · update-room · delete-room', async (r) => {
    const before = await state()
    const bot = before.bots.find(entry => entry.name === renamed)
    if (bot === undefined) throw new Error('The Bot from the bot page is missing')
    await openDrawer()
    await tapOn('New', 'New')
    await tapOn('Create group chat', 'Create group chat')
    for (const member of [main.name, renamed]) {
      const row = await waitFor(nodes => lastWhere(nodes, node => node.text === member && node.bounds.y1 > 330), `${member} in the member list`)
      tap(row)
      await sleep(400)
    }
    await tapOn('Create', 'Create')
    const made = await until(state, team => (team.rooms ?? []).some(room => (room.members ?? []).includes(bot.id) && (room.members ?? []).includes(main.id)), 'the new group')
    const room = made.rooms.find(entry => (entry.members ?? []).includes(bot.id) && (entry.members ?? []).includes(main.id))
    r.read = `group "${room.name}" with ${room.members.length} members`
    await relaunch()
    await openChatOf(room.name)
    const pill = await waitFor(nodes => nodes.find(node => node.text === room.name && node.bounds.y2 < 320), 'the group header')
    tap(pill)
    await tapOn('Group settings', 'Group settings')
    await tapOn('Everyone', 'Everyone')
    await until(state, team => team.rooms.some(entry => entry.id === room.id && entry.mode === 'everyone'), 'the group answered by everyone')
    shot('group')
    const del = await scrollTo(nodes => find(nodes, 'Delete group'), 'Delete group')
    tap(del)
    await alertTap('Delete group')
    await until(state, team => !(team.rooms ?? []).some(entry => entry.id === room.id), 'the group gone')
    r.write = 'create-room (2 members), update-room mode → everyone, delete-room'
  })

  await page('memory', 'memory-add · memory-edit · memory-forget', async (r) => {
    const text = `e2e note ${TAG}`
    const edited = `e2e note ${TAG} edited`
    const view = () => channel('memory-view', { botId: main.id })
    await openBotDetails(main.name)
    tap(await scrollTo(nodes => find(nodes, `Manage ${main.name}'s memory`), 'the memory row'))
    await wait('the memory page', 'Ask memory')
    r.read = `memory-view (${(await view()).entries.length} entries)`
    await tapOn('Add', 'Add')
    await fill('memory text', /^Text$/, text)
    await tapOn('Save', 'Save')
    await until(view, v => v.entries.some(entry => entry.text === text), 'the added memory entry')
    await tapOn('the entry', text)
    const input = await waitFor(nodes => nodes.find(node => node.cls.endsWith('EditText') && node.text === text), 'the entry text field')
    await typeInto(input, edited, { clear: true })
    await tapOn('Save', 'Save')
    await until(view, v => v.entries.some(entry => entry.text === edited) && !v.entries.some(entry => entry.text === text), 'the edited memory entry')
    shot('memory')
    const remove = await waitFor(nodes => { const row = find(nodes, edited); return row ? findInRow(nodes, row, 'Remove from memory') : undefined }, 'the remove button')
    tap(remove)
    await alertTap('Remove')
    await until(view, v => !v.entries.some(entry => entry.text === edited), 'the entry forgotten')
    r.write = `memory-add "${text}", memory-edit → "${edited}", memory-forget`
  })

  await page('schedules', 'schedule-create · schedule-delete', async (r) => {
    const title = `E2E task ${TAG}`
    const tasks = () => channel('schedules')
    await openBotDetails(main.name)
    const entry = await scrollTo(nodes => find(nodes, 'No scheduled tasks yet. Add one', /^Scheduled tasks/), 'the schedules entry')
    tap(entry)
    await wait('the schedules page', 'Create task')
    r.read = `schedules (${(await tasks()).tasks.length} tasks)`
    await fill('title', /^Morning briefing$/, title)
    await fill('prompt', /^Sum up what changed/, 'Say hello to the team')
    await hideKeyboard()
    tap(await scrollTo(nodes => find(nodes, 'Create task'), 'Create task'))
    const made = await until(tasks, v => v.tasks.some(task => task.title === title), 'the new task')
    const task = made.tasks.find(entry2 => entry2.title === title)
    await wait('the task in the list', title)
    shot('schedules')
    await tapOn('back to Bot Details', 'Back')
    await scrollTo(nodes => find(nodes, title), 'the task in Bot Details')
    await tapOn('back to chat', 'Back')
    await openDrawer()
    await tapOn('team Automation tasks', 'Automation tasks')
    await wait('the team schedule delivery selector', 'Deliver to')
    const del = await waitFor(nodes => { const row = find(nodes, title); return row ? findInRow(nodes, row, 'Delete task') : undefined }, 'the delete button')
    tap(del)
    await alertTap('Delete')
    await until(tasks, v => !v.tasks.some(entry2 => entry2.id === task.id), 'the task deleted')
    r.write = `schedule-create "${title}" (daily 09:00), schedule-delete`
  })

  await page('folder', 'folders · update-bot workDir', async (r) => {
    const folders = await channel('folders')
    const bot = botNamed(await state(), renamed)
    const target = (folders.folders ?? []).find(entry => entry.path !== folders.team)?.path ?? folders.team
    await openBotDetails(renamed)
    await tapOn('the working folder', 'Team workspace')
    await wait('the folder page', 'Use this folder')
    if (folders.picker !== 'browse') await wait('the hint for a native-picker computer', 'To use another folder, pick it in Godbot on the computer.')
    r.read = `folders (picker ${folders.picker}, ${1 + (folders.folders ?? []).length} choices)`
    await tapOn('the folder', target)
    shot('folder')
    await tapOn('Use this folder', 'Use this folder')
    await until(state, team => team.bots.some(entry => entry.id === bot.id && entry.workDir === target), `the Bot's folder set to ${target}`)
    r.write = `update-bot workDir → ${target} (no folder-pick, no folder-list on a ${folders.picker} computer)`
  })

  await page('bot-usage', 'usage-summary · run-stats', async (r) => {
    const summary = await channel('usage-summary', { botId: main.id })
    await openBotDetails(main.name)
    const entry = await scrollTo(nodes => find(nodes, `${main.name}'s usage`), 'the usage row')
    tap(entry)
    await wait('the usage page', 'Day')
    const total = t2 => (t2.input + (t2.cacheRead ?? 0) + (t2.cacheWrite ?? 0) + t2.output).toLocaleString('en-US')
    const nodes = ui()
    for (const [row, totals] of [['Day', summary.day], ['Week', summary.week], ['Month', summary.month]]) {
      const anchor = find(nodes, row)
      if (!anchor || !findInRow(nodes, anchor, total(totals))) throw new Error(`${row} does not show ${total(totals)}`)
    }
    shot('bot-usage')
    r.read = `Day/Week/Month = ${total(summary.day)}/${total(summary.week)}/${total(summary.month)} tokens, as usage-summary says`
    r.write = '(read only)'
  })

  await page('bot-browser', 'browser-frame', async (r) => {
    const answer = await control('/channel', { endpoint: 'browser-frame', payload: { botId: main.id } })
    await openBotDetails(main.name)
    await tapOn('the Browser tab', 'Browser')
    await wait('the browser hint', "This Bot's browser runs in Godbot on the computer. Open it there to watch or take over.")
    shot('bot-browser')
    r.read = `browser-frame → ${answer.ok ? 'a frame' : answer.code ?? answer.error?.code ?? 'error'}; the page shows the hint`
    r.write = '(none: the computer has no Bot browser for the phone)'
  })

  await page('secrets', 'secret-set · secret-delete', async (r) => {
    const name = `E2E_SECRET_${TAG.toUpperCase()}`
    await openSettingsPage('Secrets')
    await wait('the secrets page', 'Paste or type the key')
    r.read = `secrets (${(await state()).secrets.length} saved)`
    await fill('name', /^Name$/, name)
    await fill('value', /^Paste or type the key$/, 'e2e-secret-value')
    await hideKeyboard()
    await tapOn('Save', 'Save')
    if (!(await unlockIfAsked())) throw new Error('secret-set did not ask for the screen lock')
    await until(state, team => team.secrets.some(secret => secret.name === name), `the secret ${name}`)
    await wait('the secret in the list', name)
    shot('secrets')
    const del = await waitFor(nodes => { const row = find(nodes, name); return row ? findInRow(nodes, row, 'Delete') : undefined }, 'the delete button')
    tap(del)
    await alertTap('Delete')
    await unlockIfAsked()
    await until(state, team => !team.secrets.some(secret => secret.name === name), 'the secret deleted')
    r.write = `secret-set ${name} (unlocked with the PIN), secret-delete`
  })

  await page('providers', 'provider-add · provider-key · provider-remove', async (r) => {
    // A custom route takes its key when it is added: one added without a key names none
    // (`key: null`) and `provider-key` refuses it. So: add with a key, remove the key, type
    // a new one, remove the provider (which drops its stored key too).
    const id = `e2e-${TAG}`
    const providers = () => channel('providers')
    const mine = view => view.providers.find(provider => provider.id === id)
    await openSettingsPage('Models')
    await wait('the providers page', 'Add a provider')
    r.read = `providers (${(await providers()).providers.length} set up)`
    await tapOn('Add a provider', 'Add a provider')
    await tapOn('Custom API', 'Custom API')
    await fill('provider name', /^Provider name$/, 'E2E Provider')
    await fill('base URL', /^API base URL$/, 'http://127.0.0.1:9/v1')
    await fill('provider id', /^Provider id$/, id)
    await fill('API key', /^API key$/, 'e2e-provider-key-1')
    await fill('model ids', /^Or type model ids/, 'e2e-model')
    tap(await scrollTo(nodes => nodes.filter(node => node.text === 'Add').at(-1), 'the Add button'))
    await unlockIfAsked()
    await until(providers, v => mine(v)?.key?.configured === true && mine(v)?.key?.writable === true, `the provider ${id} with its key`)
    await tapOn('the provider row', 'E2E Provider')
    await wait('its key state', 'Key set')
    tap(await scrollTo(nodes => find(nodes, 'Remove key'), 'Remove key'))
    await unlockIfAsked()
    await until(providers, v => mine(v)?.key?.configured === false, 'the provider key removed')
    await wait('the missing key state', 'Needs an API key')
    await fill('API key', /^E2E Provider API key$/, 'e2e-provider-key-2')
    tap(await scrollTo(nodes => find(nodes, 'Save'), 'Save'))
    await unlockIfAsked()
    await until(providers, v => mine(v)?.key?.configured === true, 'the provider key set again')
    await wait('the saved note', 'Saved.')
    shot('providers')
    tap(await scrollTo(nodes => find(nodes, 'Remove provider'), 'Remove provider'))
    await sleep(600)
    await tapOn('Remove', 'Remove')
    await unlockIfAsked()
    await until(providers, v => mine(v) === undefined, 'the provider removed')
    r.write = `provider-add custom ${id} with a key; provider-key remove, then set again; provider-remove`
  })

  await page('connectors', 'connector-connect · connector-disconnect', async (r) => {
    const listed = (await state()).connectors.connectors
    const pick = listed.find(item => item.id === 'deepwiki' && item.state === 'off') ?? listed.find(item => item.auth?.kind === 'none' && item.state === 'off')
    if (!pick) throw new Error('No connector that needs no sign-in')
    const stateOf = async () => (await state()).connectors.connectors.find(item => item.id === pick.id)
    await openSettingsPage('Connectors')
    await wait('the connectors page', 'GitHub')
    r.read = `${listed.length} connectors listed, GitHub first`
    const connect = await scrollTo(nodes => { const row = find(nodes, pick.name); return row ? findInRow(nodes, row, 'Connect') : undefined }, `${pick.name}'s Connect button`)
    tap(connect)
    await unlockIfAsked()
    await until(stateOf, item => item.state !== 'off', `${pick.name} leaving off`, 45_000)
    // Connected, or failed to reach the server: either way the computer acted on the write.
    const after = await until(stateOf, item => item.state === 'ready' || item.state === 'error', `${pick.name} connected or failed`, 60_000)
    shot('connectors')
    const disconnect = await scrollTo(nodes => { const row = find(nodes, pick.name); return row ? findInRow(nodes, row, 'Disconnect') : undefined }, `${pick.name}'s Disconnect button`)
    tap(disconnect)
    await unlockIfAsked()
    await until(stateOf, item => item.state === 'off', `${pick.name} off again`, 45_000)
    r.write = `connector-connect ${pick.id} (no sign-in; state → ${after.state}), connector-disconnect`
  })

  await page('capabilities', 'capability-save · capability-delete', async (r) => {
    const name = `e2e-skill-${TAG}`
    await openSettingsPage('Capabilities')
    await wait('the capabilities page', 'Add capability')
    r.read = `capabilities (${(await state()).capabilities.length} saved)`
    await tapOn('Add capability', 'Add capability')
    await fill('name', /^Name$/, name)
    await tapOn('Skill', 'Skill')
    await fill('instructions', /^Skill instructions$/, 'Say hello when asked.')
    await hideKeyboard()
    const save = await scrollTo(nodes => findAllIn(nodes, 'Add capability').sort((a, b) => a.bounds.y1 - b.bounds.y1).at(-1), 'the save button')
    tap(save)
    await unlockIfAsked()
    await until(state, team => team.capabilities.some(item => item.name === name), `the capability ${name}`)
    await tapOn('the capability', name)
    shot('capabilities')
    await tapOn('Delete', 'Delete')
    await alertTap('Delete')
    await unlockIfAsked()
    await until(state, team => !team.capabilities.some(item => item.name === name), 'the capability deleted')
    r.write = `capability-save skill ${name}, capability-delete`
  })

  await page('usage', 'usage', async (r) => {
    await openSettingsPage('Usage')
    await wait('the usage page', 'Tokens in')
    await wait('tokens out', 'Tokens out')
    const view = await channel('usage', { timeZone: 'UTC' })
    shot('usage')
    r.read = `usage (${view.rows.length} rows, ${view.owners.length} owners); Tokens in/out shown`
    r.write = '(read only)'
  })

  await page('updates', 'update-check · update-settings', async (r) => {
    const before = await channel('update-check')
    await openSettingsPage('Updates & diagnostics')
    await wait('the Godbot section', `Godbot ${before.current}`)
    const phaseText = pluginUpdateText(before)
    await wait(`the update state "${phaseText}"`, phaseText)
    await wait('the update mode', 'Update mode')
    r.read = `Godbot ${before.current}, phase ${before.phase} shown as "${phaseText}", mode ${before.mode}`
    const next = before.mode === 'notify' ? ['auto', 'Automatic'] : ['notify', 'Ask first']
    await tapOn(next[1], next[1])
    await until(() => channel('update-check'), v => v.mode === next[0], `update mode ${next[0]}`)
    shot('updates')
    const back = before.mode === 'off' ? 'Off' : before.mode === 'notify' ? 'Ask first' : 'Automatic'
    await tapOn(back, back)
    await until(() => channel('update-check'), v => v.mode === before.mode, `update mode back to ${before.mode}`)
    r.write = `update-settings mode → ${next[0]}, then back to ${before.mode} (nothing installed)`
  })

  await page('diagnostics', 'diagnostics · diagnostics-clear', async (r) => {
    const before = await channel('diagnostics')
    await openSettingsPage('Updates & diagnostics')
    const row = await scrollTo(nodes => find(nodes, 'Log entries'), 'Log entries')
    const shown = findInRow(ui(), row, String(before.total ?? before.entries?.length ?? 0))
    if (!shown) throw new Error(`Log entries does not show ${before.total}`)
    r.read = `diagnostics: ${before.total} entries, the page shows ${shown.text}`
    const clear = await scrollTo(nodes => find(nodes, 'Clear diagnostics'), 'Clear diagnostics')
    shot('diagnostics')
    tap(clear)
    await alertTap('Clear')
    await until(() => channel('diagnostics'), v => (v.total ?? v.entries.length) === 0, 'no diagnostics entries')
    // The page reads the report again after clearing.
    await waitFor(nodes => { const entries = find(nodes, 'Log entries'); return entries ? findInRow(nodes, entries, '0') : undefined }, 'Log entries showing 0')
    r.write = `diagnostics-clear (${before.total} → 0 entries; the page shows 0)`
  })

  await page('about', 'update-check', async (r) => {
    const check = await channel('update-check')
    await openSettingsPage('About Godbot')
    const row = await wait('the Godbot row', 'Godbot')
    if (!findInRow(ui(), row, check.current)) throw new Error(`About does not show Godbot ${check.current}`)
    await wait('the phone app version', 'Phone app')
    shot('about')
    r.read = `Godbot ${check.current}, phone app version, computer name`
    r.write = '(read only)'
  })

  // The Bot from the bot page goes last: the group and folder pages used it.
  await page('bot-delete', 'delete-bot', async (r) => {
    const bot = botNamed(await state(), renamed)
    if (bot === undefined) throw new Error('The Bot from the bot page is missing')
    await openBotDetails(renamed)
    await tapOn('Edit Bot', 'Edit Bot')
    const del = await scrollTo(nodes => find(nodes, 'Delete Bot'), 'Delete Bot')
    tap(del)
    await alertTap('Delete Bot')
    await until(state, team => !team.bots.some(entry => entry.id === bot.id), 'the Bot deleted')
    shot('bot-delete')
    r.read = `${renamed}'s settings`
    r.write = `delete-bot ${bot.id}`
  })
}

let failed = false
try {
  await main()
} catch (error) {
  failed = true
  console.error(error.stack ?? error)
  try { screenshot('pages-setup-failed'); saveUi('pages-setup-failed') } catch { /* no device */ }
} finally {
  try { shell(`locksettings clear --old ${PIN}`) } catch { /* not set */ }
  try { shell('svc power stayon false') } catch { /* no device */ }
  writeFileSync(join(ARTIFACTS, 'pages-results.json'), `${JSON.stringify(results, null, 2)}\n`)
}
const bad = results.filter(result => !result.ok)
console.log(JSON.stringify({ ok: !failed && bad.length === 0, passed: results.length - bad.length, failed: bad.map(result => result.page) }, null, 2))
process.exit(!failed && bad.length === 0 ? 0 : 1)
