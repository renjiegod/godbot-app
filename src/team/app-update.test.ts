import assert from 'node:assert/strict'
import test from 'node:test'
import { isNewer, manifestUrl, parseManifest } from './app-update.ts'

const sha = 'a'.repeat(64)

test('the update manifest lives on the relay the computer\'s QR code names', () => {
  assert.equal(manifestUrl('wss://relay.example.org/v1/link'), 'https://relay.example.org/app/latest.json')
  assert.equal(manifestUrl('ws://127.0.0.1:8787/v1/link'), 'http://127.0.0.1:8787/app/latest.json')
  assert.equal(manifestUrl('WSS://Relay.Example.org:8443/v1/link?x=1'), 'https://Relay.Example.org:8443/app/latest.json')
  assert.equal(manifestUrl('https://relay.example.org/'), null)
  assert.equal(manifestUrl('demo'), null)
})

test('a manifest is checked and its download address made absolute', () => {
  const base = 'https://relay.example.org/app/latest.json'
  const manifest = parseManifest({ versionName: '0.2.0', versionCode: 200099, url: '/download/godbot-0.2.0.apk', sha256: sha.toUpperCase(), size: 123, notes: 'Push' }, base)
  assert.deepEqual(manifest, { versionName: '0.2.0', versionCode: 200099, url: 'https://relay.example.org/download/godbot-0.2.0.apk', sha256: sha, size: 123, notes: 'Push' })
  assert.equal(parseManifest({ versionName: '0.2.0', versionCode: 1, url: 'godbot.apk', sha256: sha, size: 1 }, base).url, 'https://relay.example.org/app/godbot.apk')
  assert.equal(parseManifest({ versionName: '0.2.0', versionCode: 1, url: 'https://cdn.example.org/g.apk', sha256: sha, size: 1 }, base).url, 'https://cdn.example.org/g.apk')
})

test('a broken manifest is refused', () => {
  const base = 'https://relay.example.org/app/latest.json'
  const good = { versionName: '0.2.0', versionCode: 2, url: '/download/g.apk', sha256: sha, size: 10 }
  assert.throws(() => parseManifest(null, base))
  assert.throws(() => parseManifest([], base))
  assert.throws(() => parseManifest({ ...good, versionCode: 0 }, base))
  assert.throws(() => parseManifest({ ...good, versionCode: 1.5 }, base))
  assert.throws(() => parseManifest({ ...good, sha256: 'abc' }, base))
  assert.throws(() => parseManifest({ ...good, size: -1 }, base))
  assert.throws(() => parseManifest({ ...good, url: '' }, base))
  assert.throws(() => parseManifest({ ...good, versionName: '' }, base))
})

test('only a higher version code is an update', () => {
  const manifest = parseManifest({ versionName: '0.1.1', versionCode: 100199, url: '/d.apk', sha256: sha, size: 1 }, 'http://h/app/latest.json')
  assert.equal(isNewer(manifest, 100099), true)
  assert.equal(isNewer(manifest, 100199), false)
  assert.equal(isNewer(manifest, 100299), false)
})
