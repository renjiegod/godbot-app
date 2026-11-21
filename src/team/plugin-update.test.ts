import assert from 'node:assert/strict'
import test from 'node:test'
import { setLang } from '../ui/i18n.ts'
import { canInstall, pluginUpdateText, waitingText, type PluginUpdate } from './plugin-update.ts'

setLang('en')
const base: PluginUpdate = { current: '0.2.0-rc.3', latest: '0.2.0', enabled: true, mode: 'auto', phase: 'idle', available: true }

test('Godbot\'s download and ready phases read as such', () => {
  assert.equal(pluginUpdateText({ ...base, phase: 'downloading', progress: { done: 512, total: 1024 } }), 'Downloading Godbot 0.2.0… 50%')
  assert.equal(pluginUpdateText({ ...base, phase: 'downloading', progress: { done: 512, total: null } }), 'Downloading Godbot 0.2.0…')
  assert.equal(pluginUpdateText({ ...base, phase: 'ready' }), 'Godbot 0.2.0 is downloaded and ready to install.')
  assert.equal(pluginUpdateText({ ...base, phase: 'installing' }), 'Updating Godbot…')
  assert.equal(pluginUpdateText({ ...base, phase: 'installed', installed: '0.2.0' }), 'Restart DSH to start using Godbot 0.2.0.')
  assert.equal(pluginUpdateText({ ...base, phase: 'failed', error: 'disk full' }), 'The update did not finish: disk full')
})

test('a blocked release says what it needs, and offers no install', () => {
  const blocked = { ...base, available: false, blocked: { reason: 'dsh', dsh: '0.2.3' } }
  assert.equal(pluginUpdateText(blocked), 'Godbot 0.2.0 needs DSH 0.2.3.')
  assert.equal(canInstall(blocked), false)
  assert.equal(pluginUpdateText({ ...base, available: false, blocked: { reason: 'peers', peers: ['@deepseek-ai/dsh-llm'] } }),
    'Godbot 0.2.0 needs @deepseek-ai/dsh-llm. Run scripts/install-local.mjs again on the computer.')
})

test('the other states, and when Install shows', () => {
  assert.equal(pluginUpdateText(null), '—')
  assert.equal(pluginUpdateText({ ...base }), 'Godbot 0.2.0 is available')
  assert.equal(pluginUpdateText({ ...base, available: false, latest: '0.2.0-rc.3' }), 'Up to date')
  assert.equal(pluginUpdateText({ ...base, available: false, mode: 'off' }), 'Update checks are off.')
  assert.equal(pluginUpdateText({ ...base, available: false, checkFailed: true }), 'Could not check for updates.')
  assert.equal(canInstall({ ...base, available: false, phase: 'ready' }), true)
  assert.equal(canInstall({ ...base, phase: 'installing' }), false)
  assert.equal(canInstall({ ...base, available: false }), false)
})

test('an automatic install says what it waits for', () => {
  assert.equal(waitingText({ ...base, waiting: [{ kind: 'turns', count: 2 }] }), 'Installs when no Bot is working (2 running).')
  assert.equal(waitingText({ ...base, waiting: [{ kind: 'idle' }] }), 'Installs after the computer has been idle for two minutes.')
  assert.equal(waitingText({ ...base }), null)
})
