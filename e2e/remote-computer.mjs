// Run against a loopback relay and an emulator. A temporary standalone target and its
// paired phone are created for this run. The shell writes a unique receipt on the target.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { adb, find, install, openUrl, PACKAGE, screenshot, shell, sleep, tap, typeText, waitFor } from './adb.mjs'
const src = process.env.GODBOT_SRC
const serial = process.env.ANDROID_SERIAL
const relay = new URL(process.env.GODBOT_E2E_MACHINE_RELAY ?? 'ws://127.0.0.1:18793/v1/link')
if (!src || !/^emulator-\d+$/.test(serial ?? '') || relay.hostname !== '127.0.0.1')
  throw new Error('Set GODBOT_SRC, ANDROID_SERIAL for a dedicated emulator, and a loopback-only test relay.')
const cli = resolve(src, 'computer-host/cli.mjs'),
  home = mkdtempSync(join(tmpdir(), 'gb-machine-phone-')),
  offer = join(home, 'offer')
const local = (...args) =>
  execFileSync(process.execPath, [cli, ...args, '--home', home], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
const proc = spawn(
  process.execPath,
  [cli, 'start', '--headless', '--no-prompts', '--name', 'Android validation', '--relay', relay.href, '--home', home],
  { stdio: 'ignore' },
)
const ended = new Promise((resolve) => proc.once('exit', resolve))
async function until(fn, what, limit = 30000) {
  const deadline = Date.now() + limit
  while (Date.now() < deadline) {
    try {
      const result = fn()
      if (result) return result
    } catch {}
    await sleep(200)
  }
  throw new Error('Timed out waiting for ' + what)
}
const tapLabel = async (...labels) =>
  tap(
    await waitFor((nodes) => find(nodes, ...labels, ...labels.map((label) => label.toUpperCase())), labels[0], {
      timeout: 35000,
    }),
  )
try {
  await until(() => JSON.parse(local('status')).status === 'online', 'online test target')
  if (process.env.GODBOT_E2E_APK) install(process.env.GODBOT_E2E_APK)
  adb(['reverse', 'tcp:' + relay.port, 'tcp:' + relay.port])
  shell('am force-stop ' + PACKAGE)
  local('pair', '--out', offer)
  assert.equal(statSync(offer).mode & 0o777, 0o600)
  const uri = readFileSync(offer, 'utf8').trim()
  try {
    openUrl(uri)
  } catch {
    throw new Error('Could not open private pairing offer on emulator')
  }
  rmSync(offer)
  await waitFor((nodes) => find(nodes, 'pair-computer-name'), 'pairing confirmation')
  assert.equal(JSON.parse(local('controllers')).length, 0)
  await tapLabel('Pair', '配对')
  const device = await until(() => JSON.parse(local('controllers'))[0], 'authenticated Android controller')
  local('grant', device.deviceId, 'terminal')
  await tapLabel('Open terminal', '打开终端')
  await tapLabel('Open terminal', '打开终端')
  await until(
    () => JSON.parse(local('sessions')).some((s) => s.state === 'approved' && s.mode === 'terminal'),
    'approved PTY',
  )
  const shellBody = await waitFor(
    (nodes) => nodes.find((n) => n.cls === 'android.webkit.WebView' && n.bounds.y2 - n.bounds.y1 > 80),
    'local xterm renderer',
    { timeout: 25000 },
  )
  tap(shellBody)
  await sleep(650)
  const token = randomUUID(),
    receipt = join(home, 'receipt')
  typeText('echo ' + token + ' > ' + receipt)
  shell('input keyevent KEYCODE_ENTER')
  try {
    await until(() => readFileSync(receipt, 'utf8').trim() === token, 'Android input on real target PTY')
  } catch (e) {
    screenshot('machine-terminal-failure')
    throw e
  }
  const runCommand = (command) => {
    typeText(command)
    shell('input keyevent KEYCODE_ENTER')
  }
  const sizeBefore = join(home, 'size-before'),
    sizeAfter = join(home, 'size-after')
  runCommand('stty size > ' + sizeBefore)
  await until(() => /^\d+ \d+$/.test(readFileSync(sizeBefore, 'utf8').trim()), 'portrait terminal dimensions')
  const originalRotation = shell('settings get system user_rotation').trim()
  const originalAutomatic = shell('settings get system accelerometer_rotation').trim()
  try {
    shell('settings put system accelerometer_rotation 0')
    shell('settings put system user_rotation 1')
    await sleep(1400)
    const rotated = await waitFor(
      (nodes) => nodes.find((n) => n.cls === 'android.webkit.WebView' && n.bounds.x2 - n.bounds.x1 > 100),
      'landscape terminal',
    )
    tap(rotated)
    runCommand('stty size > ' + sizeAfter)
    await until(
      () => readFileSync(sizeAfter, 'utf8').trim() !== readFileSync(sizeBefore, 'utf8').trim(),
      'live terminal resize',
    )
  } finally {
    shell('settings put system user_rotation ' + originalRotation)
    shell('settings put system accelerometer_rotation ' + originalAutomatic)
  }
  await sleep(1000)
  tap(
    await waitFor(
      (nodes) => nodes.find((n) => n.cls === 'android.webkit.WebView' && n.bounds.y2 - n.bounds.y1 > 80),
      'portrait terminal',
    ),
  )
  const waiting = join(home, 'waiting'),
    interrupted = join(home, 'interrupted')
  runCommand('echo ready > ' + waiting + '; sleep 30')
  await until(() => readFileSync(waiting, 'utf8').trim() === 'ready', 'foreground job')
  shell('input keycombination 113 31')
  runCommand('echo resumed > ' + interrupted)
  await until(
    () => readFileSync(interrupted, 'utf8').trim() === 'resumed',
    'Ctrl+C interrupts the foreground job',
    6000,
  )
  typeText('whoami')
  shell('input keyevent KEYCODE_ENTER')
  screenshot('machine-android-terminal')
  runCommand('exit 7')
  await waitFor((nodes) => find(nodes, /Shell ended.*7$|终端已结束.*7$/), 'closed shell and exact exit code')
  await until(() => !JSON.parse(local('sessions')).some((s) => s.state === 'approved'), 'ended shell releases its host session')
  await waitFor((nodes) => nodes.find((n) => n.cls === 'android.webkit.WebView'), 'readable terminal transcript retained after exit')
  screenshot('machine-android-shell-exited')
  await tapLabel('Open new terminal', '打开新终端')
  await tapLabel('Open terminal', '打开终端')
  await until(() => JSON.parse(local('sessions')).some((s) => s.state === 'approved' && s.mode === 'terminal'), 'new explicit terminal grant')
  tap(await waitFor((nodes) => nodes.find((n) => n.cls === 'android.webkit.WebView'), 'new shell'))
  const reopened = join(home, 'reopened')
  runCommand('echo fresh > ' + reopened)
  await until(() => readFileSync(reopened,'utf8').trim() === 'fresh', 'new shell receives input')
  // Going home closes even a direct session before the target lease expires.
  shell('input keyevent KEYCODE_HOME')
  await until(() => !JSON.parse(local('sessions')).some((s) => s.state === 'approved'), 'target session teardown', 8000)
  console.log(
    'PASS machine pairing, explicit terminal grant, native WebView/xterm input on real PTY, terminal resize, Ctrl+C, preserved transcript/exit code, new shell and Android background teardown.',
  )
} finally {
  proc.kill('SIGTERM')
  await ended
  rmSync(home, { recursive: true, force: true })
}
