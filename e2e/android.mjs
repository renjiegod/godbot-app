// End-to-end on an Android emulator: pair with a real Godbot computer through a real relay
// and send a message.
//
//   GODBOT_E2E_PAIRING_URI   the godbot://pair?… link Godbot shows (required)
//   GODBOT_E2E_RELAY_PORT    the relay's port on this computer, mapped into the emulator
//                            with adb reverse (default: the port in the link's server)
//   GODBOT_E2E_APK           the APK to install (default: the release build)
//   GODBOT_E2E_MESSAGE       what to send (default: a unique line)
//   GODBOT_E2E_EXPECT        text that proves the team list loaded (default: the composer)
//   ANDROID_SERIAL           the emulator, when several devices are attached
//
// The relay address in the pairing link must be reachable from the emulator: use
// ws://127.0.0.1:<port>/v1/link on the computer; this script maps that port.
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adb, dumpUi, find, install, label, openUrl, PACKAGE, saveUi, screenshot, shell, sleep, tap, typeText, waitFor } from './adb.mjs'

const APP = dirname(dirname(fileURLToPath(import.meta.url)))
const uri = process.env.GODBOT_E2E_PAIRING_URI
if (!uri) {
  console.error('Set GODBOT_E2E_PAIRING_URI to the pairing link Godbot shows (Settings → Phone → Pair).')
  process.exit(2)
}
const apk = process.env.GODBOT_E2E_APK ?? join(APP, 'android/app/build/outputs/apk/release/app-release.apk')
if (!existsSync(apk)) {
  console.error(`No APK at ${apk}. Build it: npx expo prebuild -p android && (cd android && ./gradlew assembleRelease)`)
  process.exit(2)
}
const server = new URLSearchParams(uri.slice(uri.indexOf('?') + 1)).get('server') ?? ''
const port = process.env.GODBOT_E2E_RELAY_PORT ?? /:(\d+)\//.exec(server)?.[1]
const message = process.env.GODBOT_E2E_MESSAGE ?? `e2e ${new Date().toISOString().slice(11, 19)} hello from the phone`
const steps = []
const step = (name, detail = '') => { steps.push({ name, detail, at: new Date().toISOString() }); console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`) }

async function main() {
  adb(['wait-for-device'])
  install(apk)
  step('installed', apk)
  if (port) {
    adb(['reverse', `tcp:${port}`, `tcp:${port}`])
    step('relay port mapped', `tcp:${port}`)
  }
  shell(`pm grant ${PACKAGE} android.permission.POST_NOTIFICATIONS`)
  shell(`am force-stop ${PACKAGE}`)
  shell(`pm clear ${PACKAGE}`)
  shell(`pm grant ${PACKAGE} android.permission.POST_NOTIFICATIONS`)

  // 1. The pairing link opens the app, which asks before it sends anything.
  openUrl(uri)
  const pairButton = await waitFor(nodes => find(nodes, 'Pair', '配对'), 'the pairing confirmation', { timeout: 45_000 })
  const name = dumpUi().nodes.find(node => node.desc === 'pair-computer-name')
  step('confirmation shown', name ? `computer ${label(name)}` : 'computer name not found in the dump')
  screenshot('e2e-1-confirm')
  tap(pairButton)
  step('pairing confirmed')

  // 2. The team loads: the composer for the main Bot appears.
  const expect = process.env.GODBOT_E2E_EXPECT
  const composer = await waitFor(nodes => (expect ? find(nodes, expect) : undefined) ?? nodes.find(node => node.cls.endsWith('EditText') && /^(Message |给 )/.test(node.desc || node.text)),
    'the team to load (the chat composer)', { timeout: 90_000 })
  step('team loaded', label(composer))
  screenshot('e2e-2-team')
  saveUi('e2e-2-team')

  // 3. Send a message and see it in the chat.
  const input = (await waitFor(nodes => nodes.find(node => node.cls.endsWith('EditText')), 'the composer'))
  tap(input)
  await sleep(500)
  typeText(message)
  await sleep(500)
  const send = await waitFor(nodes => find(nodes, 'Send', '发送'), 'the Send button')
  tap(send)
  step('message sent', message)
  await waitFor(nodes => nodes.some(node => node.text.includes(message) && !node.cls.endsWith('EditText')), 'the message in the chat', { timeout: 30_000 })
  step('message shown in the chat')
  await sleep(3000)
  screenshot('e2e-3-sent')
  saveUi('e2e-3-sent')
  console.log(JSON.stringify({ ok: true, message, steps }, null, 2))
}

main().catch((error) => {
  try { screenshot('e2e-failure'); saveUi('e2e-failure') } catch { /* no device */ }
  console.error(error.stack ?? error)
  console.log(JSON.stringify({ ok: false, error: String(error.message ?? error), steps }, null, 2))
  process.exit(1)
})
