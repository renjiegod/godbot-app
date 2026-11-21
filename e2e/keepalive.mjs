// Emulator check of "Keep connected in background" against a real relay and the scripted
// computer (fake-host.mjs). With the setting on, an approval raised on the computer becomes a
// system notification on the phone:
//   1. with the app in the background (Home);
//   2. after the app was swiped away from Recents: no screen is left, the process stays;
//   3. after the process was killed: the service comes back and the link with it, and a notice
//      raised while the phone was gone arrives with the catch-up;
//   4. after a reboot: the service starts at boot, with no screen;
//   5. after pairing a second computer while the keep-alive holds the link (the relay keeps
//      one connection per phone, so the link has to step aside for the pairing).
// On the way it opens the two settings rows that send the person to the system pages.
// Screenshots and UI dumps go to e2e/artifacts/; the result is printed as JSON.
//
//   node e2e/keepalive.mjs <apk>
//
//   GODBOT_RELAY_BIN   the godbot-relay binary (default: bin/godbot-relay of a godbot-server
//                      checkout next to this one, or next to a folder above it for a worktree)
//   ANDROID_SERIAL     the emulator, when several devices are attached
//
// Needs an emulator image without Google Play: step 3 kills the app's process as root.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adb, find, install, label, openUrl, PACKAGE, saveUi, screenSize, screenshot, scrollTo, shell, sleep, tap, waitFor } from './adb.mjs'

const APP = dirname(dirname(fileURLToPath(import.meta.url)))
const apk = process.argv[2]
if (!apk || !existsSync(apk)) {
  console.error('Usage: node e2e/keepalive.mjs <apk>')
  process.exit(2)
}
// A godbot-server checkout next to this one, or next to a folder above it (a worktree kept
// in its own folder tree).
function siblingRelay() {
  for (let dir = APP; dirname(dir) !== dir; dir = dirname(dir)) {
    const candidate = join(dirname(dir), 'godbot-server', 'bin', 'godbot-relay')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}
const relayBin = process.env.GODBOT_RELAY_BIN ?? siblingRelay()
if (!relayBin || !existsSync(relayBin)) {
  console.error('Set GODBOT_RELAY_BIN to a godbot-relay binary (cd godbot-server && go build -o bin/godbot-relay ./cmd/godbot-relay)')
  process.exit(2)
}

const marker = randomBytes(3).toString('hex')
const results = []
const ok = (name, detail = '') => { results.push({ name, ok: true, detail }); console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`) }
const note = (name, detail) => { results.push({ name, note: detail }); console.log(`· ${name}: ${detail}`) }

async function until(check, what, { timeout = 60_000, every = 1_000 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    let value
    try { value = await check() } catch { value = undefined }
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await sleep(every)
  }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolvePort(port)) })
  })
}

// One child process with its output kept as timestamped lines.
function run(command, args, options) {
  const child = spawn(command, args, options)
  const lines = []
  for (const stream of [child.stdout, child.stderr]) {
    let rest = ''
    stream.setEncoding('utf8')
    stream.on('data', chunk => {
      rest += chunk
      for (let end = rest.indexOf('\n'); end >= 0; end = rest.indexOf('\n')) {
        lines.push({ at: Date.now(), text: rest.slice(0, end) })
        rest = rest.slice(end + 1)
      }
    })
  }
  const line = (prefix, since = 0) => lines.find(entry => entry.at >= since && entry.text.startsWith(prefix))
  return { child, lines, line }
}

// The phone, from outside.
const pid = () => shell(`pidof ${PACKAGE} || true`).trim()
const serviceRunning = () => /KeepAliveService/.test(shell(`dumpsys activity services ${PACKAGE}`))
const screenAlive = () => new RegExp(`ActivityRecord\\{[^}]*${PACKAGE.replaceAll('.', '\\.')}/`).test(shell('dumpsys activity activities'))
const notified = text => shell('dumpsys notification --noredact').includes(text)
const keepAliveSwitch = nodes => nodes.find(node => node.cls.endsWith('Switch') && /Keep connected in background|后台保持连接/.test(node.desc))

// Another app's page or dialog on screen (not the status bar): its package and first words.
async function systemPage(what) {
  const others = nodes => nodes.filter(node => node.pkg !== '' && node.pkg !== PACKAGE && node.pkg !== 'com.android.systemui')
  const page = await waitFor(nodes => (others(nodes).length > 0 ? others(nodes) : undefined), what, { timeout: 15_000 })
  const words = page.map(node => node.text).filter(text => text.trim() !== '').slice(0, 2).join(' / ')
  return `${page[0].pkg}${words ? `: ${words}` : ''}`
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'godbot-keepalive-'))
  const port = await freePort()
  const url = `ws://127.0.0.1:${port}/v1/link`
  const relay = run(relayBin, [], {
    env: { PATH: process.env.PATH, HOME: dir, GODBOT_RELAY_HOST: '127.0.0.1', GODBOT_RELAY_PORT: String(port), GODBOT_RELAY_DATA: join(dir, 'relay.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const host = run(process.execPath, [join(APP, 'e2e/fake-host.mjs'), url], { cwd: APP, stdio: ['pipe', 'pipe', 'pipe'] })
  let second
  const stopAll = () => { second?.child.kill(); host.child.kill(); relay.child.kill(); rmSync(dir, { recursive: true, force: true }) }
  process.on('exit', stopAll)
  try {
    await until(() => relay.line('godbot-relay listening'), 'the relay to listen', { timeout: 15_000, every: 200 })
    const pairing = await until(() => host.line('PAIRING '), 'the pairing link', { timeout: 15_000, every: 200 })
    const uri = pairing.text.slice('PAIRING '.length)
    ok('relay and computer up', url)

    adb(['wait-for-device'])
    const mapPort = () => adb(['reverse', `tcp:${port}`, `tcp:${port}`])
    install(apk)
    mapPort()
    shell(`am force-stop ${PACKAGE}`)
    shell(`pm clear ${PACKAGE}`)
    shell(`pm grant ${PACKAGE} android.permission.POST_NOTIFICATIONS`)
    // Battery optimization stays on until step 3 asks for the exemption the settings row asks for.
    shell(`dumpsys deviceidle whitelist -${PACKAGE} >/dev/null 2>&1 || true`)
    ok('installed', apk)

    // Pair, as the camera would open the link.
    openUrl(uri)
    tap(await waitFor(nodes => find(nodes, 'Pair', '配对'), 'the pairing confirmation', { timeout: 45_000 }))
    await waitFor(nodes => nodes.find(node => node.cls.endsWith('EditText') && /^(Message |给 )/.test(node.desc || node.text)), 'the team to load', { timeout: 90_000 })
    ok('paired and linked')

    // Settings: turn the keep-alive on; the two rows for the system pages appear.
    tap(await waitFor(nodes => find(nodes, 'Open team list', '打开团队列表'), 'the team list button'))
    tap(await waitFor(nodes => find(nodes, 'Settings', '设置'), 'the Settings button'))
    tap(await waitFor(keepAliveSwitch, 'the keep-alive switch'))
    await until(serviceRunning, 'the keep-alive service', { timeout: 20_000 })
    const battery = await scrollTo(nodes => find(nodes, 'Battery optimization', '电池优化'), 'the battery row')
    const autoStart = await scrollTo(nodes => find(nodes, 'Auto-start and lock', '自启动与锁定'), 'the auto-start row')
    ok('keep-alive on, with its two rows', `${label(battery)} / ${label(autoStart)}`)
    screenshot('keepalive-1-settings')
    saveUi('keepalive-1-settings')

    // Each row opens a system page; Back returns to Settings.
    tap(battery)
    const batteryPage = await systemPage('the battery optimization page')
    screenshot('keepalive-2-battery-page')
    ok('battery row opens a system page', batteryPage)
    shell('input keyevent KEYCODE_BACK')
    tap(await waitFor(nodes => find(nodes, 'Auto-start and lock', '自启动与锁定'), 'the auto-start row again'))
    const autoStartPage = await systemPage('the auto-start page')
    screenshot('keepalive-3-autostart-page')
    ok('auto-start row opens a system page (on stock Android: the app settings)', autoStartPage)
    shell('input keyevent KEYCODE_BACK')
    await waitFor(keepAliveSwitch, 'Settings again')

    // 1. Home: the screens stay, the app is in the background.
    shell('input keyevent KEYCODE_HOME')
    await sleep(1_500)
    host.child.stdin.write(`NOTICE home ${marker}\n`)
    await until(() => notified(`home ${marker}`), 'the notification with the app in the background', { timeout: 30_000 })
    ok('1. background (Home): notified')

    // 2. Swiped away from Recents: Android destroys the activity and React Native unmounts every
    // screen; the service keeps the process, and the link manager keeps the link.
    const before = pid()
    shell('input keyevent KEYCODE_APP_SWITCH')
    await sleep(2_000)
    screenshot('keepalive-4-recents')
    const { width, height } = screenSize()
    shell(`input swipe ${Math.round(width / 2)} ${Math.round(height / 2)} ${Math.round(width / 2)} ${Math.round(height * 0.05)} 250`)
    await until(() => !screenAlive(), 'the activity to go away', { timeout: 15_000 })
    shell('input keyevent KEYCODE_HOME')
    if (pid() !== before) throw new Error(`The process changed after the swipe (${before} → ${pid()})`)
    if (!serviceRunning()) throw new Error('The keep-alive service stopped after the swipe')
    host.child.stdin.write(`NOTICE recents ${marker}\n`)
    await until(() => notified(`recents ${marker}`), 'the notification after the swipe', { timeout: 30_000 })
    ok('2. swiped from Recents: no screen, same process, notified', `pid ${before}`)

    // With no UI polling and no notices, only the relay's heartbeats arrive.
    const idleSince = Date.now()
    await sleep(100_000)
    if (host.line('HELLO ', idleSince)) throw new Error('The idle link reconnected despite relay heartbeats')
    host.child.stdin.write(`NOTICE idle ${marker}\n`)
    await until(() => notified(`idle ${marker}`), 'the notification after an idle period', { timeout: 30_000 })
    ok('idle for 100 seconds: same link, notified')

    // 3. The process is killed (as the low-memory killer or a phone maker's cleaner does). The
    // service is sticky; with battery optimization on, Android may refuse to bring it back to
    // the foreground. A notice raised meanwhile must arrive with the catch-up.
    adb(['root'])
    await sleep(2_000)
    adb(['wait-for-device'])
    mapPort()
    const killRound = async (round) => {
      const old = pid()
      const since = Date.now()
      shell(`kill -9 ${old}`)
      await sleep(1_000)
      host.child.stdin.write(`NOTICE gone-${round} ${marker}\n`)
      const back = await until(() => { const now = pid(); return now !== '' && now !== old ? now : undefined }, 'the process to come back', { timeout: 90_000 }).catch(() => undefined)
      if (back === undefined) return { back: false, old }
      await until(() => host.line('HELLO ', since), 'the link to come back', { timeout: 120_000 })
      await until(() => notified(`gone-${round} ${marker}`), 'the notice raised while the process was gone', { timeout: 30_000 })
      host.child.stdin.write(`NOTICE live-${round} ${marker}\n`)
      await until(() => notified(`live-${round} ${marker}`), 'a live notice after the restart', { timeout: 30_000 })
      return { back: true, old, now: back, seconds: Math.round((Date.now() - since) / 1000) }
    }
    const first = await killRound('a')
    if (first.back) {
      ok('3. killed: the service came back with battery optimization on, the missed notice arrived', `pid ${first.old} → ${first.now}, ${first.seconds} s`)
    } else {
      note('3. killed, battery optimization on', 'Android did not restart the service within 90 s')
      // What the battery row asks the person for.
      shell(`dumpsys deviceidle whitelist +${PACKAGE}`)
      shell(`am start-foreground-service -n ${PACKAGE}/expo.modules.godbotnative.KeepAliveService >/dev/null 2>&1 || true`)
      await until(serviceRunning, 'the keep-alive service, started by hand for the second round', { timeout: 30_000 })
      const second = await killRound('b')
      if (!second.back) throw new Error('The service did not come back after a kill, even exempt from battery optimization')
      ok('3. killed: exempt from battery optimization, the service came back and the missed notice arrived', `pid ${second.old} → ${second.now}, ${second.seconds} s`)
    }
    screenshot('keepalive-5-after-kill')

    // 4. Reboot: the service starts at boot, with no screen, and links again.
    const since = Date.now()
    adb(['reboot'])
    await sleep(10_000)
    adb(['wait-for-device'], { timeout: 180_000 })
    await until(() => shell('getprop sys.boot_completed').trim() === '1', 'the reboot', { timeout: 240_000, every: 2_000 })
    mapPort()
    await until(serviceRunning, 'the keep-alive service after the reboot', { timeout: 120_000, every: 2_000 })
    await until(() => host.line('HELLO ', since), 'the link after the reboot', { timeout: 180_000, every: 2_000 })
    const headless = !screenAlive()
    host.child.stdin.write(`NOTICE reboot ${marker}\n`)
    await until(() => notified(`reboot ${marker}`), 'the notification after the reboot', { timeout: 30_000 })
    ok('4. rebooted: the service started at boot and the link came back', headless ? 'with no screen' : 'a screen was up')
    shell('cmd statusbar expand-notifications')
    await sleep(1_500)
    screenshot('keepalive-6-after-reboot')
    shell('cmd statusbar collapse')

    // 5. Pair a second computer while the keep-alive holds the link to the first.
    second = run(process.execPath, [join(APP, 'e2e/fake-host.mjs'), url], { cwd: APP, stdio: ['pipe', 'pipe', 'pipe'] })
    const secondPairing = await until(() => second.line('PAIRING '), 'the second pairing link', { timeout: 15_000, every: 200 })
    const pairedAt = Date.now()
    openUrl(secondPairing.text.slice('PAIRING '.length))
    tap(await waitFor(nodes => find(nodes, 'Pair', '配对'), 'the second pairing confirmation', { timeout: 45_000 }))
    await until(() => second.line('HELLO ', pairedAt), 'the second computer to link', { timeout: 60_000 })
    await waitFor(nodes => nodes.find(node => node.cls.endsWith('EditText') && /^(Message |给 )/.test(node.desc || node.text)), 'the second team to load', { timeout: 60_000 })
    shell('input keyevent KEYCODE_HOME')
    await sleep(2_000)
    if (!serviceRunning()) throw new Error('The keep-alive service stopped after pairing a second computer')
    second.child.stdin.write(`NOTICE second ${marker}\n`)
    await until(() => notified(`second ${marker}`), 'a notification from the second computer', { timeout: 30_000 })
    ok('5. paired a second computer with the keep-alive on; it now keeps that link')
    console.log(JSON.stringify({ ok: true, marker, results }, null, 2))
  } finally {
    process.off('exit', stopAll)
    stopAll()
  }
}

main().catch((error) => {
  try { screenshot('keepalive-failure'); saveUi('keepalive-failure') } catch { /* no device */ }
  console.error(error.stack ?? error)
  console.log(JSON.stringify({ ok: false, error: String(error.message ?? error), marker, results }, null, 2))
  process.exit(1)
})
