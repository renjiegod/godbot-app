// Android release candidates. A published APK is built once, by the release
// workflow, from an exact commit on main, signed with the release key and staged
// on a draft GitHub release with app-metadata.json beside it (version,
// versionCode, signing certificate, SHA-256). The release tool (godbot-server
// release/) verifies that APK and attaches verification.json. Pushing the version
// tag publishes the draft only when the tag, the APK bytes and both records
// agree: nothing is rebuilt, and a published release is never changed. The
// relay's /app/latest.json is switched to the published APK afterwards.
//
//   node scripts/release-apk.mjs check-signature <apk>
//   node scripts/release-apk.mjs describe <apk> --commit <sha> [--run-url <url>] [--repo <owner/name>]
//   node scripts/release-apk.mjs promote --repo <owner/name> --tag <vX.Y.Z> [--dry-run] [--before-tag]
//
// apksigner and aapt2 come from the newest build-tools in ANDROID_HOME (or
// ANDROID_SDK_ROOT); apksigner needs Java on PATH.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'

export const CANDIDATE_SCHEMA = 'godbot.android-candidate.v1'
export const VERIFICATION_SCHEMA = 'godbot.android-verification.v1'
export const PACKAGE = 'io.github.renjiegod.godbot'
// What verification.json must show passed (or waived, with a reason) for a release.
export const REQUIRED_CHECKS = ['signature', 'version-code', 'upgrade-install']
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const COMMIT = /^[0-9a-f]{40}$/
const TAG = /^v(\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?)$/

export class ReleaseError extends Error {}
const fail = message => { throw new ReleaseError(message) }
const sha256 = data => createHash('sha256').update(data).digest('hex')
export const apkName = version => `godbot-${version}.apk`

export function tagVersion(tag) {
  return TAG.exec(String(tag ?? ''))?.[1] ?? fail(`${tag} is not a version tag like v1.2.3`)
}

/** A certificate fingerprint in the AB:CD:… form, from that form or plain hex. */
export function fingerprint(text) {
  const hex = String(text ?? '').replace(/:/g, '').trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(hex)) fail(`${text} is not a SHA-256 certificate fingerprint`)
  return hex.toUpperCase().match(/../g).join(':')
}

/** The release certificate every published APK is signed with (release/signing-cert.sha256). */
export function pinnedCertificate(root = ROOT) {
  const line = readFileSync(join(root, 'release/signing-cert.sha256'), 'utf8').split('\n').map(text => text.trim()).find(text => text && !text.startsWith('#'))
  return fingerprint(line)
}

/** The versionCode app.config.js gives a version: the one Android compares. */
export function expectedVersionCode(version, root = ROOT) {
  return createRequire(join(root, 'package.json'))('./app.config.js').versionCode(version)
}

/** apksigner and aapt2 from the newest build-tools of the Android SDK. */
export function buildTools(env = process.env) {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || fail('Set ANDROID_HOME to the Android SDK (apksigner and aapt2 come from its build-tools)')
  const dir = join(sdk, 'build-tools')
  const versions = existsSync(dir) ? readdirSync(dir).filter(name => /^\d+(\.\d+)*$/.test(name)) : []
  versions.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const newest = versions.at(-1) ?? fail(`No build-tools in ${dir}`)
  return { apksigner: join(dir, newest, 'apksigner'), aapt2: join(dir, newest, 'aapt2') }
}

const runTool = (file, args) => execFileSync(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

/** The signers apksigner verified on an APK. apksigner exits non-zero when any signature fails to verify. */
export function readSignature(output) {
  const schemes = Object.fromEntries([...output.matchAll(/^Verified using (v[\d.]+) scheme[^:]*: (true|false)$/gm)].map(([, scheme, ok]) => [scheme, ok === 'true']))
  const signers = Number(/^Number of signers: (\d+)$/m.exec(output)?.[1] ?? NaN)
  const certificates = [...new Set([...output.matchAll(/certificate SHA-256 digest: ([0-9a-f]{64})/gi)].map(([, hex]) => fingerprint(hex)))]
  return { schemes, signers, certificates }
}

/** package name, versionCode and versionName from `aapt2 dump badging`. */
export function readBadging(output) {
  const line = output.split('\n').find(text => text.startsWith('package:')) ?? fail('aapt2 printed no package line')
  const field = name => new RegExp(`\\b${name}='([^']*)'`).exec(line)?.[1]
  return { name: field('name'), versionCode: Number(field('versionCode')), versionName: field('versionName') }
}

/** The APK is signed by exactly one signer, with the pinned release certificate, under v2 or v3. */
export function checkSignature(apk, { tools = buildTools(), run = runTool, pin = pinnedCertificate() } = {}) {
  let output
  try { output = run(tools.apksigner, ['verify', '--print-certs', '--verbose', apk]) } catch (error) { fail(`apksigner could not verify ${apk}: ${String(error.stderr ?? error.message).trim()}`) }
  const signature = readSignature(output)
  if (!signature.schemes.v2 && !signature.schemes.v3) fail(`${apk} has no verified v2 or v3 signature`)
  if (signature.signers !== 1 || signature.certificates.length !== 1) fail(`${apk} has ${signature.signers} signers (${signature.certificates.join(', ') || 'no certificate'}); a release has exactly one`)
  if (signature.certificates[0] !== pin) fail(`${apk} is signed with ${signature.certificates[0]}, not the release certificate ${pin}. A debug or other key can never update installed copies.`)
  return { certSha256: pin, schemes: signature.schemes }
}

const runGh = (args, { binary = false } = {}) =>
  execFileSync('gh', args, { encoding: binary ? 'buffer' : 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
const runGit = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function newer(a, b) {
  const parts = text => { const [core, pre] = text.split(/-(.*)/s); return { nums: core.split('.').map(Number), pre: pre ?? null } }
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] > y.nums[i]
  if (x.pre === y.pre) return false
  if (x.pre === null) return true
  if (y.pre === null) return false
  return x.pre.localeCompare(y.pre, 'en', { numeric: true }) > 0
}

const releaseVersion = release => TAG.exec(String(release?.tag_name ?? ''))?.[1] ?? null
const assetDownload = (gh, repo, asset) => Buffer.from(gh(['api', '-H', 'Accept: application/octet-stream', `repos/${repo}/releases/assets/${asset.id}`], { binary: true }))

/**
 * The newest published release before `version`, with its versionCode and signing
 * certificate: from its app-metadata.json, or read from its APK for releases made
 * before app-metadata.json existed.
 */
export function previousRelease({ repo, version, gh = runGh, tools, run = runTool }) {
  const releases = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=100`]))
  const published = releases.filter(item => !item?.draft && releaseVersion(item) && newer(version, releaseVersion(item)))
  published.sort((a, b) => (newer(releaseVersion(a), releaseVersion(b)) ? -1 : 1))
  const release = published[0]
  if (!release) return null
  const versionName = releaseVersion(release)
  const metadata = release.assets?.find(item => item?.name === 'app-metadata.json')
  if (metadata) {
    const record = JSON.parse(assetDownload(gh, repo, metadata).toString('utf8'))
    return { versionName, versionCode: record.versionCode, certSha256: record.certSha256 }
  }
  const apk = release.assets?.find(item => item?.name === apkName(versionName)) ?? fail(`${release.tag_name} has neither app-metadata.json nor ${apkName(versionName)}`)
  const dir = mkdtempSync(join(tmpdir(), 'godbot-previous-apk-'))
  try {
    const file = join(dir, apk.name)
    writeFileSync(file, assetDownload(gh, repo, apk))
    const badge = readBadging(run(tools.aapt2, ['dump', 'badging', file]))
    const signature = readSignature(run(tools.apksigner, ['verify', '--print-certs', '--verbose', file]))
    return { versionName, versionCode: badge.versionCode, certSha256: signature.certificates.length === 1 ? signature.certificates[0] : null }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * app-metadata.json for a release build of `commit`: it must carry this
 * package's version and versionCode, be signed with the release certificate, and
 * come after the newest published release, which must have the same certificate.
 */
export function describe(apk, { commit, runUrl = null, repo = null, root = ROOT, tools = buildTools(), run = runTool, gh = runGh }) {
  if (!COMMIT.test(String(commit ?? ''))) fail('describe needs --commit with a full 40-character commit SHA')
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const badge = readBadging(run(tools.aapt2, ['dump', 'badging', apk]))
  const problems = []
  if (badge.name !== PACKAGE) problems.push(`The APK is ${badge.name}, not ${PACKAGE}`)
  if (badge.versionName !== version) problems.push(`The APK is version ${badge.versionName}, not package.json's ${version}`)
  if (badge.versionCode !== expectedVersionCode(version, root)) problems.push(`The APK's versionCode is ${badge.versionCode}, not ${expectedVersionCode(version, root)}`)
  const pin = pinnedCertificate(root)
  const { certSha256 } = checkSignature(apk, { tools, run, pin })
  const previous = repo ? previousRelease({ repo, version, gh, tools, run }) : null
  if (previous && !(badge.versionCode > previous.versionCode)) problems.push(`versionCode ${badge.versionCode} does not come after ${previous.versionName}'s ${previous.versionCode}`)
  if (previous?.certSha256 && previous.certSha256 !== pin) problems.push(`${previous.versionName} was signed with ${previous.certSha256}, not the pinned ${pin}`)
  const source = JSON.parse(readFileSync(join(root, 'godbot/SOURCE.json'), 'utf8')).godbot
  if (source?.dirty !== false || !COMMIT.test(String(source?.commit ?? ''))) problems.push('godbot/SOURCE.json does not name a committed dsh-godbot revision')
  if (problems.length) fail(`This APK cannot be a release:\n- ${problems.join('\n- ')}`)
  const bytes = readFileSync(apk)
  return {
    schema: CANDIDATE_SCHEMA,
    package: PACKAGE,
    versionName: version,
    versionCode: badge.versionCode,
    tag: 'v' + version,
    commit,
    apk: { name: apkName(version), sha256: sha256(bytes), size: statSync(apk).size },
    certSha256,
    godbot: { commit: source.commit },
    previous: previous ? { versionName: previous.versionName, versionCode: previous.versionCode } : null,
    built: { runUrl },
    createdAt: new Date().toISOString(),
  }
}

/** Problems with a verification.json record for `metadata`; empty when it vouches for the APK. */
export function verificationProblems(verified, metadata, pin) {
  if (verified?.schema !== VERIFICATION_SCHEMA) return [`verification.json is not a ${VERIFICATION_SCHEMA} record`]
  const problems = []
  if (verified.apk?.sha256 !== metadata?.apk?.sha256) problems.push(`verification.json verified ${verified.apk?.sha256}, not ${metadata?.apk?.sha256}`)
  if (verified.versionCode !== metadata?.versionCode) problems.push(`verification.json names versionCode ${verified.versionCode}, not ${metadata?.versionCode}`)
  if (verified.certSha256 !== pin) problems.push(`verification.json names the certificate ${verified.certSha256}, not ${pin}`)
  if (verified.result !== 'passed') problems.push('verification.json does not say passed')
  const checks = new Map((Array.isArray(verified.checks) ? verified.checks : []).map(item => [item?.id, item]))
  for (const id of REQUIRED_CHECKS) {
    const check = checks.get(id)
    if (!check) problems.push(`verification.json has no ${id} check`)
    else if (check.status !== 'passed' && !(check.status === 'waived' && String(check.reason ?? '').trim())) problems.push(`The ${id} check is ${check.status}`)
  }
  return problems
}

/**
 * Publish the draft release for `tag` once its APK, app-metadata.json,
 * verification.json, the gzip copy and the tag agree, or re-check a release that
 * is already published. With `beforeTag` the tag does not have to exist yet.
 */
export async function promote({ repo, tag, dryRun = false, beforeTag = false, cwd = ROOT, gh = runGh, git = runGit, log = message => console.error(message) }) {
  const version = tagVersion(tag)
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  if (pkg.version !== version) fail(`${tag} does not match package.json version ${pkg.version}`)
  const pin = pinnedCertificate(cwd)
  const releases = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=100`]))
  const matching = releases.filter(item => item?.tag_name === tag)
  if (matching.length === 0) fail(`There is no release candidate for ${tag}: run the release workflow on its commit first`)
  if (matching.length > 1) fail(`${matching.length} releases name ${tag}; delete the stale drafts first`)
  const [release] = matching
  const assetOf = name => release.assets?.find(item => item?.name === name) ?? fail(`The ${tag} release has no ${name}`)
  const json = name => { try { return JSON.parse(assetDownload(gh, repo, assetOf(name)).toString('utf8')) } catch (error) { return error instanceof ReleaseError ? fail(error.message) : fail(`${name} is not readable JSON`) } }
  const metadata = json('app-metadata.json')
  const verified = json('verification.json')
  const apkAsset = assetOf(apkName(version))
  const bytes = assetDownload(gh, repo, apkAsset)
  const actual = sha256(bytes)
  const problems = []
  const expect = (ok, message) => { if (!ok) problems.push(message) }
  expect(metadata?.schema === CANDIDATE_SCHEMA, `app-metadata.json is not a ${CANDIDATE_SCHEMA} record`)
  expect(metadata?.tag === tag && metadata?.versionName === version, `app-metadata.json describes ${metadata?.tag}, not ${tag}`)
  expect(metadata?.certSha256 === pin, `app-metadata.json names the certificate ${metadata?.certSha256}, not the pinned ${pin}`)
  if (release.draft) expect(release.target_commitish === metadata?.commit, `The draft targets ${release.target_commitish}, not ${metadata?.commit}`)
  expect(actual === metadata?.apk?.sha256, `The release APK's SHA-256 is ${actual}, not app-metadata.json's ${metadata?.apk?.sha256}`)
  expect(apkAsset.digest === 'sha256:' + actual, `GitHub records ${apkAsset.digest ?? 'no digest'} for ${apkAsset.name}`)
  expect(apkAsset.size === metadata?.apk?.size, `${apkAsset.name} has ${apkAsset.size} bytes, not ${metadata?.apk?.size}`)
  const sidecar = assetDownload(gh, repo, assetOf(apkAsset.name + '.sha256')).toString('utf8').trim().split(/\s+/)[0]?.toLowerCase()
  expect(sidecar === actual, `${apkAsset.name}.sha256 does not state the APK's SHA-256`)
  let unzipped = null
  try { unzipped = sha256(gunzipSync(assetDownload(gh, repo, assetOf(apkAsset.name + '.gz')), { maxOutputLength: 512 * 1024 * 1024 })) } catch (error) { if (error instanceof ReleaseError) throw error }
  expect(unzipped === actual, `${apkAsset.name}.gz does not unpack to the APK`)
  problems.push(...verificationProblems(verified, metadata, pin))
  let tagged = ''
  try { tagged = git(['rev-parse', '--verify', '--quiet', 'refs/tags/' + tag + '^{commit}'], cwd) } catch { /* no such tag */ }
  if (tagged ? tagged !== metadata?.commit : !beforeTag) problems.push(`${tag} points at ${tagged || 'nothing'}, not the candidate's commit ${metadata?.commit}`)
  git(['fetch', '--quiet', 'origin', 'main'], cwd)
  try { git(['merge-base', '--is-ancestor', String(metadata?.commit), 'origin/main'], cwd) } catch { problems.push(`The candidate's commit ${metadata?.commit} is not on main`) }
  for (const other of releases) {
    const otherVersion = releaseVersion(other)
    if (other !== release && !other?.draft && otherVersion && newer(otherVersion, version)) problems.push(`${other.tag_name} is already published; ${tag} would come out after a newer release`)
  }
  if (problems.length) fail(`${tag} cannot be published:\n- ${problems.join('\n- ')}`)
  if (!release.draft) {
    log(`${tag} is already published with the verified APK ${actual}`)
    return { tag, published: true, changed: false, metadata }
  }
  if (dryRun) {
    log(`${tag} is ready to publish (dry run): ${apkAsset.name} ${actual}`)
    return { tag, published: false, changed: false, metadata }
  }
  gh(['api', '-X', 'PATCH', `repos/${repo}/releases/${release.id}`, '-F', 'draft=false', '-f', `make_latest=${version.includes('-') ? 'false' : 'true'}`])
  log(`Published ${tag}: ${apkAsset.name} ${actual}`)
  return { tag, published: true, changed: true, metadata }
}

export async function main(argv) {
  const [command, ...rest] = argv
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
    commit: { type: 'string' }, 'run-url': { type: 'string' }, repo: { type: 'string' }, tag: { type: 'string' },
    'dry-run': { type: 'boolean' }, 'before-tag': { type: 'boolean' },
  } })
  const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n')
  const need = (value, flag) => value ?? fail(`${command} needs ${flag}`)
  switch (command) {
    case 'check-signature': {
      const apk = need(positionals[0], '<apk>')
      const result = checkSignature(apk)
      console.error(`${apk} is signed with the release certificate ${result.certSha256}`)
      return print(result)
    }
    case 'describe':
      return print(describe(need(positionals[0], '<apk>'), { commit: values.commit, runUrl: values['run-url'] ?? null, repo: values.repo ?? null }))
    case 'promote': {
      const { metadata, ...result } = await promote({ repo: need(values.repo, '--repo'), tag: need(values.tag, '--tag'), dryRun: values['dry-run'] === true, beforeTag: values['before-tag'] === true })
      return print({ ...result, sha256: metadata.apk.sha256, versionCode: metadata.versionCode, commit: metadata.commit })
    }
    default:
      fail('Use: check-signature | describe | promote (see the top of scripts/release-apk.mjs)')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof ReleaseError ? error.message : error.stack ?? error)
    process.exitCode = 1
  })
}
