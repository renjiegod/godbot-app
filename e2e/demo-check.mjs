// Emulator check of a demo-mode build (EXPO_PUBLIC_GODBOT_DEMO=1): the main screens render,
// the hidden test push shows a notification, and "Keep connected in background" starts and
// stops the foreground service. Screenshots and UI dumps go to e2e/artifacts/.
//
//   node e2e/demo-check.mjs <demo apk>
import { existsSync } from 'node:fs'
import { find, install, label, launch, longPress, PACKAGE, saveUi, screenshot, scrollTo, shell, sleep, tap, waitFor } from './adb.mjs'

const apk = process.argv[2]
if (!apk || !existsSync(apk)) {
  console.error('Usage: node e2e/demo-check.mjs <demo-mode apk>')
  process.exit(2)
}
const results = []
const ok = (name, detail = '') => { results.push({ name, ok: true, detail }); console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`) }

const serviceRunning = () => /KeepAliveService/.test(shell(`dumpsys activity services ${PACKAGE}`))
const notifications = () => shell('dumpsys notification --noredact')

async function main() {
  install(apk)
  shell(`pm clear ${PACKAGE}`)
  shell(`pm grant ${PACKAGE} android.permission.POST_NOTIFICATIONS`)
  shell('cmd notification post -h >/dev/null 2>&1 || true')
  launch()

  // Chat with the main Bot (GodBot in the demo team).
  const composer = await waitFor(nodes => nodes.find(node => node.cls.endsWith('EditText')), 'the demo chat', { timeout: 60_000 })
  ok('chat renders', label(composer))
  screenshot('demo-1-chat')
  saveUi('demo-1-chat')

  // The team list in the drawer.
  tap(await waitFor(nodes => find(nodes, 'Open team list', '打开团队列表'), 'the team list button'))
  const godbot = await waitFor(nodes => find(nodes, 'GodBot'), 'GodBot in the team list')
  ok('team list renders', label(godbot))
  screenshot('demo-2-team-list')
  saveUi('demo-2-team-list')

  // Settings, with the two new rows.
  tap(await waitFor(nodes => find(nodes, 'Settings', '设置'), 'the Settings button'))
  const keepRow = await waitFor(nodes => find(nodes, 'Keep connected in background', '后台保持连接'), 'the keep-alive row')
  ok('settings render', label(keepRow))
  await waitFor(nodes => find(nodes, 'Push notifications', '推送通知'), 'the push row')
  screenshot('demo-3-settings')
  saveUi('demo-3-settings')

  // Keep-alive on: the foreground service runs and posts its notification.
  const toggle = await waitFor(nodes => nodes.find(node => node.cls.endsWith('Switch') && /Keep connected in background|后台保持连接/.test(node.desc)), 'the keep-alive switch')
  tap(toggle)
  let running = false
  for (let i = 0; i < 10 && !running; i += 1) { await sleep(1000); running = serviceRunning() }
  if (!running) throw new Error('The keep-alive service did not start')
  ok('keep-alive service started')
  screenshot('demo-4-keepalive-on')
  tap(await waitFor(nodes => nodes.find(node => node.cls.endsWith('Switch') && /Keep connected in background|后台保持连接/.test(node.desc)), 'the keep-alive switch'))
  let stopped = false
  for (let i = 0; i < 10 && !stopped; i += 1) { await sleep(1000); stopped = !serviceRunning() }
  if (!stopped) throw new Error('The keep-alive service did not stop')
  ok('keep-alive service stopped')

  // About → long press on "Phone app": a sealed sample push goes through the push handler.
  const about = await scrollTo(nodes => find(nodes, 'About Godbot', '关于 Godbot'), 'About Godbot')
  tap(about)
  const phoneApp = await waitFor(nodes => find(nodes, 'Phone app', '手机 App'), 'the Phone app row')
  screenshot('demo-5-about')
  longPress(phoneApp)
  await waitFor(nodes => find(nodes, /Test notification shown|已显示测试通知/), 'the test push result', { timeout: 15_000 })
  let posted = false
  for (let i = 0; i < 10 && !posted; i += 1) { await sleep(500); posted = /Godbot test notification|Godbot 测试通知/.test(notifications()) }
  if (!posted) throw new Error('The test notification is not in the notification list')
  ok('test push shown as a notification')
  shell('cmd statusbar expand-notifications')
  await sleep(1500)
  screenshot('demo-6-notification')
  shell('cmd statusbar collapse')
  console.log(JSON.stringify({ ok: true, results }, null, 2))
}

main().catch((error) => {
  try { screenshot('demo-failure'); saveUi('demo-failure') } catch { /* no device */ }
  console.error(error.stack ?? error)
  console.log(JSON.stringify({ ok: false, error: String(error.message ?? error), results }, null, 2))
  process.exit(1)
})
