// Acceptance against an owner's dedicated graphical fixture. Place a writable text
// field at the supplied normalized coordinates. Its change handler writes a local
// receipt (or a file inside an explicitly named staging container).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  adb,
  center,
  find,
  hideKeyboard,
  launch,
  PACKAGE,
  screenSize,
  screenshot,
  shell,
  sleep,
  tap,
  typeText,
  waitFor,
} from './adb.mjs'

const name = process.env.GODBOT_E2E_DESKTOP_NAME
const receipt = process.env.GODBOT_E2E_DESKTOP_RECEIPT
const container = process.env.GODBOT_E2E_DESKTOP_CONTAINER
const [nx, ny] = (process.env.GODBOT_E2E_DESKTOP_POINT || '').split(',').map(Number)
if (
  !name ||
  !receipt ||
  ![nx, ny].every((v) => Number.isFinite(v) && v > 0 && v < 1) ||
  !/^emulator-\d+$/.test(process.env.ANDROID_SERIAL || '')
) {
  throw new Error(
    'Set ANDROID_SERIAL, GODBOT_E2E_DESKTOP_NAME, GODBOT_E2E_DESKTOP_POINT=x,y and GODBOT_E2E_DESKTOP_RECEIPT for your dedicated paired fixture.',
  )
}
const ui = async (...labels) => waitFor((nodes) => find(nodes, ...labels), String(labels[0]), { timeout: 35000 })
async function press(...labels) {
  tap(await ui(...labels))
}
function readReceipt() {
  if (container)
    return execFileSync('docker', ['exec', container, 'cat', receipt], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  return readFileSync(receipt, 'utf8')
}
async function waitButtonState(probe, expected) {
  const deadline=Date.now()+5000
  while (Date.now()<deadline) {
    const value=execFileSync(probe,[],{encoding:'utf8'}).trim()
    if(value===expected)return
    await sleep(100)
  }
  throw new Error('Timed out waiting for fixture button state '+expected)
}
const forceRelay = process.env.GODBOT_E2E_FORCE_TURN === '1'
try {
  shell('am force-stop ' + PACKAGE)
  launch()
  await press(name)
  await press('View desktop', '查看桌面')
  await ui('Live desktop', '桌面已连接')
  if (screenSize().height > screenSize().width) {
    await press('Full screen','全屏')
    await ui(name)
    await ui('Disconnect','断开连接')
    await press('Exit full screen','退出全屏')
  }
  const mappedTurnPort = process.env.GODBOT_E2E_TEST_TURN_PORT
  if (mappedTurnPort) {
    assert.match(mappedTurnPort, /^\d{1,5}$/)
    const address = 'tcp:' + mappedTurnPort
    assert.ok(adb(['reverse', '--list']).includes(address + ' ' + address), 'dedicated emulator TURN mapping exists')
    await press('Session details', '会话详情')
    try {
      adb(['reverse', '--remove', address])
      await press('Use TURN only', '仅通过 TURN 中继')
      await waitFor((nodes) => find(nodes,'Retry desktop','重试桌面连接'),'actionable desktop failure',{timeout:65000})
      await press('Session details','会话详情')
      await ui(/Connection route|连接路径/)
      screenshot('machine-android-failure-details')
      await press('Done','完成')
    } finally {
      adb(['reverse',address,address])
    }
    await press('Retry desktop','重试桌面连接')
    await ui('Live desktop','桌面已连接')
    console.log('PASS retained failure diagnostics and explicit retry following unavailable TURN')
  }
  if (forceRelay) {
    await press('Session details', '会话详情')
    await press('Use TURN only', '仅通过 TURN 中继')
    await ui('Live desktop', '桌面已连接')
    await press('Session details', '会话详情')
    const route = await ui(/TURN · /)
    console.log('Selected ICE route:',route.text || route.desc)
    await press('Done', '完成')
  }
  if (process.env.GODBOT_E2E_LOW_PROFILE === '1') {
    await sleep(3500)
    await press('Session details', '会话详情')
    const balanced = await ui(/\d+ × \d+ · \d+ kbit\/s/)
    console.log('Balanced RTC stats', balanced.text || balanced.desc)
    await press('Bandwidth saver off', '省流量已关闭')
    await ui('Live desktop', '桌面已连接')
    await sleep(3500)
    await press('Session details', '会话详情')
    const low = await ui(/\d+ × \d+ · \d+ kbit\/s/)
    const lowStats = low.text || low.desc
    console.log('Low RTC stats', lowStats)
    const dims = lowStats.match(/(\d+) × (\d+)/)
    assert.ok(dims && +dims[1] <= 960 && +dims[2] <= 540, 'saver uses bounded decoded dimensions')
    screenshot('machine-android-bandwidth-stats')
    await press('Done', '完成')
  }
  await press('Request control', '请求控制')
  await ui('You have control', '正在控制')
  const pointerProbe = process.env.GODBOT_E2E_X11_POINTER_PROBE
  if (pointerProbe) {
    const [touchX,touchY] = center(await ui('Remote touchpad', '远程触控板'))
    const rotation=shell('settings get system user_rotation').trim()
    const auto=shell('settings get system accelerometer_rotation').trim()
    try {
      shell('input motionevent DOWN '+touchX+' '+touchY)
      await waitButtonState(pointerProbe,'1')
      shell('settings put system accelerometer_rotation 0')
      shell('settings put system user_rotation 1')
      await waitButtonState(pointerProbe,'0')
      console.log('PASS held X11 pointer released on Android rotation')
    } finally {
      shell('input motionevent UP '+touchX+' '+touchY)
      shell('settings put system user_rotation '+rotation)
      shell('settings put system accelerometer_rotation '+auto)
      await sleep(1200)
    }
  }
  const [x, y] = center(await ui('Remote touchpad', '远程触控板'))
  const { width } = screenSize()
  shell(
    'input swipe ' +
      [x, y, Math.round(x + (nx - 0.5) * width * 0.8), Math.round(y + (ny - 0.5) * width * 0.5), 180].join(' '),
  )
  await press('Click', '单击')
  await press('Keyboard', '键盘')
  await press('Text to send', '发送文字')
  const marker = 'AndroidGodbot' + randomBytes(4).toString('hex')
  typeText(marker)
  await hideKeyboard()
  // Android's gesture navigation bar can overlap the bottom edge on older builds.
  const send = await ui('Send text', '发送文字')
  shell('input tap ' + Math.round((send.bounds.x1 + send.bounds.x2) / 2) + ' ' + (send.bounds.y1 + 5))
  const until = Date.now() + 8000
  let received = false
  while (Date.now() < until) {
    try {
      if (readReceipt().includes(marker)) {
        received = true
        break
      }
    } catch {}
    await sleep(150)
  }
  assert.ok(received, 'target graphical application received text from Android keyboard and pointer')
  console.log('Target GTK receipt',marker)
  screenshot(forceRelay ? 'machine-android-turn' : 'machine-android-linux-control')
  await press('Release control', '释放控制')
  await ui('View only', '仅查看')
  console.log(
    'PASS approved Android graphical control and target receipt; ' +
      (forceRelay ? 'forced TURN' : 'automatic route') +
      '.',
  )
} finally {
  adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME'])
}
