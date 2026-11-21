// A scripted computer for checking the app's link end to end without a full Godbot: the
// same HostLink and DeviceRegistry that Godbot runs (godbot/link), a one-Bot team, and a
// pairing link on stdout. Messages the phone sends are printed as `SENT <text>`; a push key
// the phone hands over is printed as `PUSH_KEY <deviceId>`; every handshake as `HELLO <ms>`.
// A line `NOTICE <text>` on stdin raises an approval notice, as Godbot's addNotice does: a
// linked phone gets it at once, the others when they catch up (`notices`); it prints
// `NOTICE <seq>`.
//
//   node e2e/fake-host.mjs ws://127.0.0.1:<relay port>/v1/link [--incompatible]
//
// --incompatible answers `hello` with `api: null`, as a Godbot too old for the app does.
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { DeviceRegistry, HostLink, deviceIdFor, generateKeyPair, pairingUri, randomToken, isPushKey } from '../godbot/link/index.ts'

const server = process.argv[2]
if (!server) { console.error('Usage: node e2e/fake-host.mjs <relay ws url> [--incompatible]'); process.exit(2) }
const incompatible = process.argv.includes('--incompatible')

const keys = generateKeyPair()
const identity = { deviceId: deviceIdFor(keys.publicKey), ...keys }
let devices = []
const registry = new DeviceRegistry([], next => { devices = next })
const boot = randomUUID()
let revision = 1
const items = [{ kind: 'reply', text: 'Hello from the e2e computer.', time: Date.now() - 60_000, seq: 1 }]
const bot = { id: 'b-lead', name: 'GodBot', role: 'Team Lead', main: true, color: 'cyan', avatar: { shape: 'godbot' }, sessionId: 's-lead', createdAt: Date.now() - 86_400_000, lastAt: Date.now() }
const team = () => ({ revision, bots: [{ ...bot, preview: items.at(-1)?.text ?? '' }], rooms: [], mainBotId: bot.id, mainBotIds: [bot.id], models: [], prefs: {} })

let link
let noticeSeq = 0
const notices = []
const answer = (endpoint, body) => {
  switch (endpoint) {
    case 'hello': {
      console.log(`HELLO ${Date.now()}`)
      // A Godbot older than the app has no API version in common with it.
      return { api: incompatible ? null : 1, apiMin: 1, apiMax: 1, plugin: { name: 'dsh-godbot', version: 'e2e' }, capabilities: ['rpc'], boot, seq: noticeSeq, revision, readOnly: false, memory: false, feed: 'api/godbot/team/feed' }
    }
    case 'state': return body?.since === revision ? { revision, unchanged: true } : team()
    case 'notices': {
      const since = Number(body?.since ?? 0)
      return body?.boot === boot ? { boot, seq: noticeSeq, notices: notices.filter(notice => notice.seq > since) } : { boot, seq: noticeSeq, reset: true, notices: [] }
    }
    case 'avatar': return { ref: null, image: null }
    case 'chat': return { sessionId: bot.sessionId, items, cursor: null }
    case 'send': {
      const text = String(body?.text ?? '')
      items.push({ kind: 'user', text, time: Date.now(), seq: items.length + 1 })
      revision += 1
      console.log(`SENT ${text}`)
      setTimeout(() => {
        items.push({ kind: 'reply', text: `Got it: ${text}`, time: Date.now(), seq: items.length + 1 })
        revision += 1
        link?.emit('revision', { revision })
        link?.emit('message', { sessionId: bot.sessionId, botId: bot.id })
      }, 500)
      return true
    }
    default: throw Object.assign(new Error(`Not in the e2e computer: ${endpoint}`), { code: 'bot/not-found' })
  }
}

link = new HostLink({
  url: server,
  identity,
  accessToken: randomToken(),
  name: `e2e ${hostname()}`,
  push: true,
  admits: (deviceId, key) => registry.admits(deviceId, key),
  authorize: (deviceId, key, hello) => registry.authorize(deviceId, key, hello),
  handle: async (method, params, request) => {
    if (method === 'push.key') {
      if (!isPushKey(params?.key)) throw Object.assign(new Error('The push key is invalid.'), { code: 'INVALID_PARAMS' })
      console.log(`PUSH_KEY ${request.deviceId}`)
      return { ok: true }
    }
    if (method !== 'bot') throw Object.assign(new Error(`Unknown method ${method}`), { code: 'METHOD_NOT_FOUND' })
    try {
      const value = answer(String(params?.endpoint ?? ''), params?.payload ?? {})
      const wanted = params?.state
      return wanted && typeof wanted === 'object' ? { ok: true, value, state: team() } : { ok: true, value }
    } catch (error) {
      return { ok: false, error: { code: error.code ?? 'bot/failed', message: error.message } }
    }
  },
  onReadyCount: count => console.log(`READY ${count}`),
})
link.start()

const { code } = registry.openPairing()
console.log(`PAIRING ${pairingUri({ server, hostDeviceId: identity.deviceId, hostKey: identity.publicKey, code, name: 'e2e computer' })}`)
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  input += chunk
  for (let end = input.indexOf('\n'); end >= 0; end = input.indexOf('\n')) {
    const line = input.slice(0, end).trim()
    input = input.slice(end + 1)
    if (!line.startsWith('NOTICE ')) continue
    noticeSeq += 1
    const notice = { kind: 'approval', name: bot.name, title: '', text: line.slice('NOTICE '.length), botId: bot.id, sessionId: bot.sessionId, seq: noticeSeq, time: Date.now() }
    notices.push(notice)
    link?.emit('notice', notice)
    console.log(`NOTICE ${noticeSeq}`)
  }
})
const stop = () => { void link.stop(); process.exit(0) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
