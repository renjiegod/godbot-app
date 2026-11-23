import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentNameOf, LOGIN_CAPABILITY, phoneStep, signInFailureText, signInPlace, type LoginView } from './local-sign-in.ts'
import { setLang } from '../ui/i18n.ts'

const view = (patch: Partial<LoginView>): LoginView => ({ loginId: 'l1', route: 'local-claude-code', state: 'waiting', kind: 'pipe', version: 1, ...patch })

test('Claude Code and Codex sign in on the phone; other CLIs on the computer; an old computer first needs an update', () => {
  const caps = ['state', LOGIN_CAPABILITY]
  assert.equal(signInPlace('local-claude-code', caps), 'phone')
  assert.equal(signInPlace('local-codex-cli', caps), 'phone')
  assert.equal(signInPlace('local-gemini-cli', caps), 'computer')
  assert.equal(signInPlace('local-claude-code', ['state']), 'update-godbot')
  assert.equal(signInPlace('local-acp-agent-1', caps), null)
  assert.equal(signInPlace('local-sandbox-claude-a', caps), null)
  assert.equal(signInPlace('deepseek-official', caps), null)
  assert.equal(signInPlace(undefined, caps), null)
})

test('the phone opens Claude Code\'s code page, never the link that returns to the computer', () => {
  const step = phoneStep(view({ url: 'https://claude.ai/oauth/authorize?manual=1', autoUrl: 'https://claude.com/cai/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A5000%2Fcallback', paste: 'code' }))
  assert.deepEqual(step, { kind: 'code', link: 'https://claude.ai/oauth/authorize?manual=1', verifying: false })
  // Before the CLI prints its link there is nothing to open yet.
  assert.deepEqual(phoneStep(view({ autoUrl: 'https://claude.com/cai/oauth/authorize?x=1' })), { kind: 'starting' })
})

test('Codex shows its device code; endings and a terminal sign-in have their own steps', () => {
  assert.deepEqual(phoneStep(view({ route: 'local-codex-cli', url: 'https://auth.openai.com/codex/device', code: 'AB12-CD345' })),
    { kind: 'device', link: 'https://auth.openai.com/codex/device', code: 'AB12-CD345', verifying: false })
  assert.deepEqual(phoneStep(view({ state: 'verifying', code: 'AB12-CD345' })).kind, 'device')
  assert.deepEqual(phoneStep(view({ state: 'done', verified: true })), { kind: 'done', verified: true })
  assert.deepEqual(phoneStep(view({ state: 'failed', error: { reason: 'timeout' } })), { kind: 'failed', reason: 'timeout', detail: undefined })
  assert.deepEqual(phoneStep(view({ state: 'canceled' })), { kind: 'canceled' })
  assert.deepEqual(phoneStep(view({ kind: 'terminal' })), { kind: 'computer' })
  assert.deepEqual(phoneStep(null), { kind: 'starting' })
})

test('names and failure words read in both languages', () => {
  assert.equal(agentNameOf('local-codex-cli'), 'Codex CLI')
  assert.equal(agentNameOf('local-claude-code', 'Claude Code (team)'), 'Claude Code (team)')
  assert.equal(agentNameOf('local-kimi-cli'), 'kimi-cli')
  setLang('en')
  assert.equal(signInFailureText('still-signed-out', 'Codex CLI'), 'Codex CLI finished, but still says it is not signed in.')
  setLang('zh')
  assert.equal(signInFailureText('timeout', 'Codex CLI'), '登录等待太久，已停止。')
  assert.equal(signInFailureText(undefined, 'Codex CLI'), 'Codex CLI 登录失败。')
  setLang('en')
})
