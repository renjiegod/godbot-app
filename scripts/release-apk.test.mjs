import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import {
  ReleaseError, VERIFICATION_SCHEMA, checkSignature, describe, fingerprint, pinnedCertificate, promote, readBadging, readSignature,
} from './release-apk.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const sha256 = data => createHash('sha256').update(data).digest('hex')
const PIN_HEX = '9c7763b07c38b2ce2131cf547bc101761d54b36aef7c69fb0a5cbb4a63096198'
const PIN = fingerprint(PIN_HEX)
const DEBUG_HEX = 'f'.repeat(64)
const COMMIT = 'a'.repeat(40)
const tools = { apksigner: '/sdk/apksigner', aapt2: '/sdk/aapt2' }

const apksignerOutput = (hex = PIN_HEX, signers = 1) => [
  'Verifies',
  'Verified using v1 scheme (JAR signing): false',
  'Verified using v2 scheme (APK Signature Scheme v2): true',
  'Verified using v3 scheme (APK Signature Scheme v3): true',
  `Number of signers: ${signers}`,
  `Signer #1 certificate DN: CN=Godbot`,
  `Signer #1 certificate SHA-256 digest: ${hex}`,
  `Signer (minSdkVersion=28, maxSdkVersion=2147483647) certificate SHA-256 digest: ${hex}`,
].join('\n')
const badgingOutput = (versionName, versionCode, name = 'io.github.renjiegod.godbot') =>
  `package: name='${name}' versionCode='${versionCode}' versionName='${versionName}' platformBuildVersionName='16'\nsdkVersion:'24'\n`

function appRoot(version, { dirty = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'godbot-release-apk-'))
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text) }
  put('package.json', JSON.stringify({ name: 'godbot-app', version }))
  copyFileSync(join(repoRoot, 'app.config.js'), join(root, 'app.config.js'))
  put('release/signing-cert.sha256', readFileSync(join(repoRoot, 'release/signing-cert.sha256'), 'utf8'))
  put('godbot/SOURCE.json', JSON.stringify({ godbot: { commit: 'b'.repeat(40), dirty } }))
  return root
}

function fakeRun({ cert = PIN_HEX, versionName, versionCode, signers = 1, previous = null }) {
  return (file, args) => {
    const apk = args.at(-1)
    const isPrevious = previous && apk.endsWith(`godbot-${previous.versionName}.apk`)
    if (file === tools.aapt2) return isPrevious ? badgingOutput(previous.versionName, previous.versionCode) : badgingOutput(versionName, versionCode)
    if (file === tools.apksigner) return isPrevious ? apksignerOutput(previous.cert ?? PIN_HEX) : apksignerOutput(cert, signers)
    throw new Error('unexpected tool ' + file)
  }
}

test('the pinned certificate is the published release key', () => {
  assert.equal(pinnedCertificate(repoRoot), PIN)
  assert.equal(fingerprint(PIN), PIN)
  assert.throws(() => fingerprint('AB:CD'), ReleaseError)
})

test('apksigner and aapt2 output are read the way the build tools print them', () => {
  const signature = readSignature(apksignerOutput())
  assert.deepEqual(signature.certificates, [PIN])
  assert.equal(signature.signers, 1)
  assert.equal(signature.schemes.v3, true)
  assert.deepEqual(readBadging(badgingOutput('0.1.24', 102499)), { name: 'io.github.renjiegod.godbot', versionCode: 102499, versionName: '0.1.24' })
})

test('only an APK signed with the release certificate passes', () => {
  assert.equal(checkSignature('app.apk', { tools, run: fakeRun({ versionName: '0.1.24', versionCode: 102499 }), pin: PIN }).certSha256, PIN)
  assert.throws(() => checkSignature('app.apk', { tools, run: fakeRun({ cert: DEBUG_HEX }), pin: PIN }), /not the release certificate/)
  assert.throws(() => checkSignature('app.apk', { tools, run: fakeRun({ signers: 2 }), pin: PIN }), /2 signers/)
  assert.throws(() => checkSignature('app.apk', { tools, run: () => { throw Object.assign(new Error('x'), { stderr: 'DOES NOT VERIFY' }) }, pin: PIN }), /DOES NOT VERIFY/)
})

function writeApk(root, version, content = 'apk bytes ' + version) {
  const file = join(root, `app-${version}.apk`)
  writeFileSync(file, content)
  return file
}

test('describe vouches for a release build of this version that comes after the last release', () => {
  const root = appRoot('0.1.24')
  const apk = writeApk(root, '0.1.24')
  const record = describe(apk, { commit: COMMIT, root, tools, run: fakeRun({ versionName: '0.1.24', versionCode: 102499 }) })
  assert.equal(record.versionCode, 102499)
  assert.equal(record.certSha256, PIN)
  assert.equal(record.apk.name, 'godbot-0.1.24.apk')
  assert.equal(record.apk.sha256, sha256(readFileSync(apk)))
  assert.throws(() => describe(apk, { commit: COMMIT, root, tools, run: fakeRun({ versionName: '0.1.23', versionCode: 102399 }) }), /not package.json's 0.1.24/)
  assert.throws(() => describe(apk, { commit: COMMIT, root, tools, run: fakeRun({ versionName: '0.1.24', versionCode: 102498 }) }), /versionCode is 102498/)
  assert.throws(() => describe(apk, { commit: COMMIT, root, tools, run: fakeRun({ versionName: '0.1.24', versionCode: 102499, cert: DEBUG_HEX }) }), /not the release certificate/)
  const dirtyRoot = appRoot('0.1.24', { dirty: true })
  assert.throws(() => describe(writeApk(dirtyRoot, '0.1.24'), { commit: COMMIT, root: dirtyRoot, tools, run: fakeRun({ versionName: '0.1.24', versionCode: 102499 }) }), /SOURCE.json/)
})

const asset = (id, name, bytes) => ({ id, name, size: bytes.length, digest: 'sha256:' + sha256(bytes) })

function fakeGh(releases, files) {
  const calls = []
  const names = new Map(releases.flatMap(item => (item.assets ?? []).map(entry => [String(entry.id), entry.name])))
  const gh = (args, { binary = false } = {}) => {
    calls.push(args)
    const path = args.at(-1)
    if (args[1] === '-X') return '{}'
    if (/releases\?per_page=100$/.test(path)) return JSON.stringify(releases)
    const id = /releases\/assets\/(\d+)$/.exec(path)?.[1]
    if (id && binary) return files[names.get(id)]
    throw new Error('unexpected gh ' + args.join(' '))
  }
  return { gh, calls }
}

test('describe reads the last release from app-metadata.json, or from its APK when older', () => {
  const root = appRoot('0.1.24')
  const apk = writeApk(root, '0.1.24')
  const run = fakeRun({ versionName: '0.1.24', versionCode: 102499, previous: { versionName: '0.1.23', versionCode: 102399 } })
  const withMetadata = { 'app-metadata.json': Buffer.from(JSON.stringify({ versionCode: 102399, certSha256: PIN })) }
  const releases = [{ tag_name: 'v0.1.23', draft: false, assets: [asset(1, 'app-metadata.json', withMetadata['app-metadata.json'])] }]
  assert.deepEqual(describe(apk, { commit: COMMIT, root, tools, run, repo: 'r/r', gh: fakeGh(releases, withMetadata).gh }).previous, { versionName: '0.1.23', versionCode: 102399 })

  const oldApk = { 'godbot-0.1.23.apk': Buffer.from('old apk') }
  const older = [{ tag_name: 'v0.1.23', draft: false, assets: [asset(2, 'godbot-0.1.23.apk', oldApk['godbot-0.1.23.apk'])] }]
  assert.equal(describe(apk, { commit: COMMIT, root, tools, run, repo: 'r/r', gh: fakeGh(older, oldApk).gh }).previous.versionCode, 102399)

  const ahead = { 'app-metadata.json': Buffer.from(JSON.stringify({ versionCode: 102499, certSha256: PIN })) }
  const sameCode = [{ tag_name: 'v0.1.23', draft: false, assets: [asset(3, 'app-metadata.json', ahead['app-metadata.json'])] }]
  assert.throws(() => describe(apk, { commit: COMMIT, root, tools, run, repo: 'r/r', gh: fakeGh(sameCode, ahead).gh }), /does not come after/)
  const otherKey = { 'app-metadata.json': Buffer.from(JSON.stringify({ versionCode: 102399, certSha256: fingerprint(DEBUG_HEX) })) }
  const rekeyed = [{ tag_name: 'v0.1.23', draft: false, assets: [asset(4, 'app-metadata.json', otherKey['app-metadata.json'])] }]
  assert.throws(() => describe(apk, { commit: COMMIT, root, tools, run, repo: 'r/r', gh: fakeGh(rekeyed, otherKey).gh }), /was signed with/)
})

function candidate(version = '0.1.24', { draft = true, id = 7, tag = 'v' + version, verification = {} } = {}) {
  const apk = Buffer.from('apk ' + version)
  const metadata = { schema: 'godbot.android-candidate.v1', versionName: version, versionCode: 102499, tag: 'v' + version, commit: COMMIT,
    apk: { name: `godbot-${version}.apk`, sha256: sha256(apk), size: apk.length }, certSha256: PIN }
  const verified = { schema: VERIFICATION_SCHEMA, apk: { sha256: sha256(apk) }, versionCode: 102499, certSha256: PIN, result: 'passed',
    checks: [{ id: 'signature', status: 'passed' }, { id: 'version-code', status: 'passed' }, { id: 'upgrade-install', status: 'passed' }], ...verification }
  const files = {
    'app-metadata.json': Buffer.from(JSON.stringify(metadata)),
    'verification.json': Buffer.from(JSON.stringify(verified)),
    [`godbot-${version}.apk`]: apk,
    [`godbot-${version}.apk.sha256`]: Buffer.from(`${sha256(apk)}  godbot-${version}.apk\n`),
    [`godbot-${version}.apk.gz`]: gzipSync(apk),
  }
  const assets = Object.entries(files).map(([name, data], index) => asset(100 + index, name, data))
  return { release: { id, tag_name: tag, draft, target_commitish: COMMIT, assets }, files }
}

const fakeGit = ({ tagged = COMMIT, onMain = true } = {}) => (args) => {
  if (args[0] === 'rev-parse') { if (!tagged) throw new Error('none'); return tagged }
  if (args[0] === 'fetch') return ''
  if (args[0] === 'merge-base') { if (!onMain) throw new Error('no'); return '' }
  throw new Error('unexpected git ' + args.join(' '))
}

test('promote publishes the verified draft APK and re-checks a published one', async () => {
  const root = appRoot('0.1.24')
  const { release, files } = candidate()
  const { gh, calls } = fakeGh([release], files)
  const result = await promote({ repo: 'r/r', tag: 'v0.1.24', cwd: root, gh, git: fakeGit(), log: () => {} })
  assert.equal(result.changed, true)
  assert.deepEqual(calls.at(-1), ['api', '-X', 'PATCH', 'repos/r/r/releases/7', '-F', 'draft=false', '-f', 'make_latest=true'])
  const published = candidate('0.1.24', { draft: false })
  const again = fakeGh([published.release], published.files)
  assert.equal((await promote({ repo: 'r/r', tag: 'v0.1.24', cwd: root, gh: again.gh, git: fakeGit(), log: () => {} })).changed, false)
  assert.equal(again.calls.some(args => args[1] === '-X'), false)
})

test('promote refuses an unverified APK, a broken gzip copy, a wrong tag and an older version', async () => {
  const root = appRoot('0.1.24')
  const run = (made, git = {}, extra = []) => promote({ repo: 'r/r', tag: 'v0.1.24', cwd: root, gh: fakeGh([made.release, ...extra], made.files).gh, git: fakeGit(git), log: () => {} })
  await assert.rejects(run(candidate('0.1.24', { verification: { checks: [{ id: 'signature', status: 'passed' }, { id: 'version-code', status: 'passed' }] } })), /no upgrade-install check/)
  await assert.rejects(run(candidate('0.1.24', { verification: { checks: [{ id: 'signature', status: 'passed' }, { id: 'version-code', status: 'passed' }, { id: 'upgrade-install', status: 'waived' }] } })), /upgrade-install check is waived/)
  const waived = candidate('0.1.24', { verification: { checks: [{ id: 'signature', status: 'passed' }, { id: 'version-code', status: 'passed' }, { id: 'upgrade-install', status: 'waived', reason: 'No emulator image for API 36 on this machine' }] } })
  assert.equal((await run(waived)).changed, true)
  const broken = candidate()
  broken.files['godbot-0.1.24.apk.gz'] = gzipSync(Buffer.from('another apk'))
  broken.release.assets = Object.entries(broken.files).map(([name, data], index) => asset(100 + index, name, data))
  await assert.rejects(run(broken), /\.gz does not unpack to the APK/)
  await assert.rejects(run(candidate(), { tagged: 'c'.repeat(40) }), /points at c{40}/)
  await assert.rejects(run(candidate(), { onMain: false }), /is not on main/)
  await assert.rejects(run(candidate(), {}, [{ id: 9, tag_name: 'v0.1.25', draft: false, assets: [] }]), /v0\.1\.25 is already published/)
  rmSync(root, { recursive: true, force: true })
})
