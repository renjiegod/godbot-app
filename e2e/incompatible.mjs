// A computer whose Godbot is too old for the app (`hello` answers `api: null`): the app
// shows the upgrade hint and asks again with a growing delay (2 s, 4 s, 8 s, …).
//
//   GODBOT_RELAY_BIN   the godbot-relay binary (default ../godbot-server/bin/godbot-relay)
//   GODBOT_E2E_APK     the APK (default: the release build)
//   ANDROID_SERIAL     the emulator
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adb, find, install, openUrl, PACKAGE, saveUi, screenshot, shell, tap, waitFor } from './adb.mjs'

const APP = dirname(dirname(fileURLToPath(import.meta.url)))
const relayBin = process.env.GODBOT_RELAY_BIN ?? join(APP, '../godbot-server/bin/godbot-relay')
const apk = process.env.GODBOT_E2E_APK ?? join(APP, 'android/app/build/outputs/apk/release/app-release.apk')
for (const [what, path] of [['relay', relayBin], ['APK', apk]]) {
  if (!existsSync(path)) { console.error(`No ${what} at ${path}`); process.exit(2) }
}

const kids = []
let mappedPort = null
const run = (cmd, args, env = {}) => { const child = spawn(cmd, args, { env: { ...process.env, ...env } }); kids.push(child); return child }
const lineOf = (child, pattern, ms = 20_000) => new Promise((resolve, reject) => {
  let seen = ''
  const timer = setTimeout(() => reject(new Error(`No ${pattern} within ${ms} ms: ${seen.slice(-300)}`)), ms)
  const on = (data) => { seen += data; const match = pattern.exec(seen); if (match) { clearTimeout(timer); resolve(match) } }
  child.stdout.on('data', on)
  child.stderr.on('data', on)
})

async function main() {
  const relay = run(relayBin, [], { GODBOT_RELAY_HOST: '127.0.0.1', GODBOT_RELAY_PORT: '0' })
  const [, url] = await lineOf(relay, /listening on (ws:\/\/\S+)/)
  const host = run(process.execPath, [join(APP, 'e2e/fake-host.mjs'), url, '--incompatible'])
  const hellos = []
  host.stdout.on('data', (data) => { for (const line of String(data).split('\n')) if (line.startsWith('HELLO ')) hellos.push(Number(line.slice(6))) })
  const [, uri] = await lineOf(host, /PAIRING (godbot:\/\/\S+)/)
  const port = /:(\d+)\//.exec(url)[1]

  install(apk)
  shell(`pm clear ${PACKAGE}`)
  adb(['reverse', `tcp:${port}`, `tcp:${port}`])
  mappedPort = port
  openUrl(uri)
  tap(await waitFor(nodes => find(nodes, 'Pair', '配对'), 'the pairing confirmation', { timeout: 45_000 }))
  const hint = await waitFor(nodes => find(nodes, 'Update Godbot on the computer to use this phone.', '请先更新电脑上的 Godbot，再用这台手机。'), 'the upgrade hint', { timeout: 45_000 })
  console.log(`✓ upgrade hint shown: ${hint.text}`)
  screenshot('incompatible-hint')
  saveUi('incompatible-hint')

  // Watch four retries: the gaps must grow (2 s, 4 s, 8 s, 16 s, with some slack).
  const deadline = Date.now() + 60_000
  while (hellos.length < 5 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500))
  const gaps = hellos.slice(1).map((at, i) => at - hellos[i])
  console.log(`handshakes: ${hellos.length}, gaps (ms): ${gaps.join(', ')}`)
  if (hellos.length < 5) throw new Error(`Only ${hellos.length} handshakes in 60 s`)
  const expected = [2_000, 4_000, 8_000, 16_000]
  expected.forEach((want, i) => {
    if (gaps[i] < want * 0.9 || gaps[i] > want * 1.6 + 3_000) throw new Error(`Gap ${i + 1} is ${gaps[i]} ms, expected about ${want} ms`)
  })
  console.log('✓ retries back off: about 2 s, 4 s, 8 s, 16 s')
  console.log(JSON.stringify({ ok: true, hint: hint.text, gaps }, null, 2))
}

main().catch((error) => {
  try { screenshot('incompatible-failure'); saveUi('incompatible-failure') } catch { /* no device */ }
  console.error(error.stack ?? error)
  process.exitCode = 1
}).finally(() => {
  // Only the mapping this script made: other runs may use the emulator too.
  if (mappedPort !== null) { try { adb(['reverse', '--remove', `tcp:${mappedPort}`]) } catch { /* no device */ } }
  for (const child of kids) { try { child.kill('SIGTERM') } catch { /* gone */ } }
})
