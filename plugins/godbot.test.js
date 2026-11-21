const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const { googleServicesFile } = require('./fcm.js')
const { CLEARTEXT_HOSTS, networkSecurityXml } = require('./network-security.js')

test('plain ws:// and http:// reach only this phone and the emulator host', () => {
  assert.deepEqual(CLEARTEXT_HOSTS, ['localhost', '127.0.0.1', '10.0.2.2'])
  const xml = networkSecurityXml()
  assert.match(xml, /<base-config cleartextTrafficPermitted="false" \/>/)
  for (const host of CLEARTEXT_HOSTS) assert.match(xml, new RegExp(`<domain includeSubdomains="false">${host.replaceAll('.', '\\.')}</domain>`))
})

test('FCM is added only when GODBOT_GOOGLE_SERVICES_JSON names an existing file', (t) => {
  assert.equal(googleServicesFile({}), null)
  assert.equal(googleServicesFile({ GODBOT_GOOGLE_SERVICES_JSON: '  ' }), null)
  assert.throws(() => googleServicesFile({ GODBOT_GOOGLE_SERVICES_JSON: '/no/such/google-services.json' }), /does not exist/)
  const dir = mkdtempSync(join(tmpdir(), 'godbot-fcm-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'google-services.json')
  writeFileSync(file, '{}')
  assert.equal(googleServicesFile({ GODBOT_GOOGLE_SERVICES_JSON: file }), file)
})

test('the app is Godbot for Android only, with the permissions its features need', () => {
  const { expo } = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf8'))
  assert.equal(expo.name, 'Godbot')
  assert.equal(expo.scheme, 'godbot')
  assert.equal(expo.android.package, 'io.github.renjiegod.godbot')
  assert.equal(expo.ios, undefined)
  for (const permission of ['POST_NOTIFICATIONS', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_SPECIAL_USE', 'REQUEST_INSTALL_PACKAGES', 'RECEIVE_BOOT_COMPLETED', 'ACCESS_NETWORK_STATE', 'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS']) {
    assert.ok(expo.android.permissions.includes(`android.permission.${permission}`), permission)
  }
  for (const plugin of ['./plugins/network-security.js', './plugins/fcm.js', './plugins/android-release-signing.js']) {
    assert.ok(expo.plugins.includes(plugin), plugin)
  }
})
