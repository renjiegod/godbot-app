// End-to-end on an Android emulator: a relay offers an in-app update. About shows
// progress and speed during a throttled download, then the installer replaces the app.
//
//   GODBOT_E2E_RELAY_BIN   the godbot-relay binary (required)
//   GODBOT_E2E_APK         the APK installed first and offered as the update (default: release)
//   ANDROID_SERIAL         the emulator, when several devices are attached
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import { adb, find, install, openUrl, PACKAGE, saveUi, screenshot, scrollTo, shell, sleep, tap, waitFor } from './adb.mjs'

const APP = dirname(dirname(fileURLToPath(import.meta.url)))
const relayBin = process.env.GODBOT_E2E_RELAY_BIN
const apk = process.env.GODBOT_E2E_APK ?? join(APP, 'android/app/build/outputs/apk/release/app-release.apk')
if (isMainThread && (!relayBin || !existsSync(apk))) {
  console.error('Set GODBOT_E2E_RELAY_BIN to a godbot-relay binary, and build the release APK first.')
  process.exit(2)
}
const steps = []
const step = (name, detail = '') => { steps.push({ name, detail }); console.log(`✓ ${name}${detail ? `: ${detail}` : ''}`) }
const children = []
let downloadWorker

// Starts a process and resolves with the first stdout match of `pattern`.
function startUntil(command, args, env, pattern, what) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    let output = ''
    const timer = setTimeout(() => reject(new Error(`${what} did not start:\n${output.slice(-2000)}`)), 20_000)
    const collect = chunk => {
      output += chunk
      const match = pattern.exec(output)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    }
    child.stdout.setEncoding('utf8').on('data', collect)
    child.stderr.setEncoding('utf8').on('data', collect)
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`${what} exited (${code}):\n${output.slice(-2000)}`)) })
  })
}

function installedVersionCode() {
  const out = shell(`dumpsys package ${PACKAGE}`)
  return Number(/versionCode=(\d+)/.exec(out)?.[1] ?? 0)
}

async function serveSlowDownload(bytes) {
  // Chunked transfer exercises progress when the HTTP response has no Content-Length.
  const chunkSize = Math.ceil(bytes.length / 100)
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive' })
    let offset = 0
    const timer = setInterval(() => {
      if (response.writableNeedDrain) return
      const end = Math.min(bytes.length, offset + chunkSize)
      response.write(bytes.subarray(offset, end))
      offset = end
      if (offset === bytes.length) response.end()
    }, 200)
    response.once('close', () => clearInterval(timer))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

function downloadProgress(nodes, after = 0) {
  const percent = Number.parseInt(find(nodes, /^\d+%$/)?.text ?? '', 10)
  const speed = find(nodes, /^\d+(?:\.\d+)? (?:B|KB|MB)\/s$/)?.text
  if (percent > after && percent < 100 && Number.parseFloat(speed ?? '') > 0) return { percent, speed }
}

async function main() {
  adb(['wait-for-device'])
  install(apk)
  shell(`am force-stop ${PACKAGE}`)
  shell(`pm clear ${PACKAGE}`)
  shell(`pm grant ${PACKAGE} android.permission.POST_NOTIFICATIONS`)
  // The person allows "Install unknown apps" once; the e2e grants it up front.
  shell(`appops set ${PACKAGE} REQUEST_INSTALL_PACKAGES allow`)
  const current = installedVersionCode()
  step('installed', `versionCode ${current}`)

  // The relay serves a newer manifest that points at the throttled APK download.
  const dir = mkdtempSync(join(tmpdir(), 'godbot-update-'))
  const bytes = readFileSync(apk)
  // The worker can keep serving bytes while the main thread waits on adb.
  downloadWorker = new Worker(new URL(import.meta.url), { workerData: apk })
  const [downloadPort] = await once(downloadWorker, 'message')
  adb(['reverse', `tcp:${downloadPort}`, `tcp:${downloadPort}`])
  const manifest = {
    versionName: '0.1.1', versionCode: current + 100, url: `http://127.0.0.1:${downloadPort}/update.apk`,
    sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, notes: 'E2E update',
  }
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(manifest))
  const relay = await startUntil(relayBin, [], { GODBOT_RELAY_HOST: '127.0.0.1', GODBOT_RELAY_PORT: '0', GODBOT_RELAY_APP_DIR: dir },
    /godbot-relay listening on (ws:\/\/\S+\/v1\/link)/, 'godbot-relay')
  const port = /:(\d+)\//.exec(relay)[1]
  adb(['reverse', `tcp:${port}`, `tcp:${port}`])
  step('relay serving the update', `${relay} → ${manifest.versionName} (${manifest.versionCode})`)

  // Pair with the stand-in computer, so the app knows which relay to ask.
  const pairing = await startUntil(process.execPath, [join(APP, 'e2e', 'fake-host.mjs'), relay], {}, /PAIRING (\S+)/, 'the stand-in computer')
  openUrl(pairing)
  tap(await waitFor(nodes => find(nodes, 'Pair', '配对'), 'the pairing confirmation', { timeout: 45_000 }))
  await waitFor(nodes => nodes.find(node => node.cls.endsWith('EditText')), 'the team to load', { timeout: 90_000 })
  step('paired')

  // Settings → About → Check for app updates.
  tap(await waitFor(nodes => find(nodes, 'Open team list', '打开团队列表'), 'the team list button'))
  tap(await waitFor(nodes => find(nodes, 'Settings', '设置'), 'the Settings button'))
  tap(await scrollTo(nodes => find(nodes, 'About Godbot', '关于 Godbot'), 'About Godbot'))
  tap(await waitFor(nodes => find(nodes, 'Check for app updates', '检查 App 更新'), 'the update check row'))
  await waitFor(nodes => find(nodes, /0\.1\.1/), 'the newer version offered', { timeout: 20_000 })
  screenshot('update-1-offered')
  step('update offered', manifest.versionName)

  // Download, verify, and open the system installer.
  tap(await waitFor(nodes => find(nodes, 'Download and install', '下载并安装'), 'the install row'))
  const first = await waitFor(nodes => downloadProgress(nodes), 'progress and speed during the download')
  screenshot('update-download-progress')
  const later = await waitFor(nodes => downloadProgress(nodes, first.percent), 'the download progress to advance')
  step('live download progress and speed', `${first.percent}% at ${first.speed} → ${later.percent}% at ${later.speed}`)

  // The installer's buttons are in its own case ("UPDATE" on stock Android).
  const confirm = await waitFor(nodes => find(nodes, /^(update|install|更新|安装)$/i), 'the system installer', { timeout: 60_000 })
  const installer = shell('dumpsys activity activities').match(/topResumedActivity=[^\n]*/)?.[0] ?? ''
  screenshot('update-2-installer')
  saveUi('update-2-installer')
  step('installer opened', installer.trim())
  const updatedAt = () => /lastUpdateTime=([^\n]+)/.exec(shell(`dumpsys package ${PACKAGE}`))?.[1]?.trim()
  const before = updatedAt()
  tap(confirm)

  // The installer replaces the app (its lastUpdateTime moves); the app then opens again.
  const deadline = Date.now() + 90_000
  while (updatedAt() === before) {
    if (Date.now() > deadline) throw new Error('The installer did not replace the app within 90 s')
    await sleep(1000)
  }
  step('package replaced', `lastUpdateTime ${before} → ${updatedAt()}`)
  await sleep(2000)
  shell(`monkey --pct-syskeys 0 -p ${PACKAGE} -c android.intent.category.LAUNCHER 1`)
  await waitFor(nodes => nodes.some(node => node.pkg === PACKAGE || node.cls.endsWith('EditText')), 'the app open after the update', { timeout: 30_000 })
  screenshot('update-3-reopened')
  step('app reopened after the update')
  console.log(JSON.stringify({ ok: true, steps }, null, 2))
}

if (isMainThread) {
  await main().catch(error => {
    try { screenshot('update-failure'); saveUi('update-failure') } catch { /* no device */ }
    console.error(error.stack ?? error)
    console.log(JSON.stringify({ ok: false, error: String(error.message ?? error), steps }, null, 2))
    process.exitCode = 1
  }).finally(async () => {
    await downloadWorker?.terminate()
    for (const child of children) child.kill('SIGTERM')
    try { adb(['reverse', '--remove-all']) } catch { /* no device */ }
  })
} else {
  parentPort.postMessage(await serveSlowDownload(readFileSync(workerData)))
}
