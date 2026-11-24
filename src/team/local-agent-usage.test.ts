import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentAccounts, sortAgents, type LocalAgent } from './local-agent-usage.ts'

test('account drill-down keeps historical and unknown totals outside the current accounts', () => {
  const totals = { tokens: 20, input: 20, output: 0, cacheRead: 0, cacheWrite: 0, reports: 1, unreported: 0 }
  const periods = { today: totals, week: totals, month: totals }
  const codex: LocalAgent = {
    route: 'local-codex-cli', name: 'Codex CLI', available: true, periods,
    configuredAccounts: [{ id: null, name: null, available: true }, { id: 'work', name: 'Work', available: true }],
    accounts: [
      { accountId: null, attribution: 'unknown', periods, models: [] },
      { accountId: 'work', attribution: 'sandbox', periods, models: [] },
      { accountId: 'retired', attribution: 'sandbox', periods, models: [] },
    ],
  }
  const [host, work, unknown, retired] = agentAccounts(codex, 'week')
  assert.equal(host.usage, undefined)
  assert.equal(work.usage?.periods.week.tokens, 20)
  assert.equal(work.historical, false)
  assert.equal(unknown.historical, true)
  assert.equal(retired.historical, true)
  const missing = { route: 'local-goose', name: 'Goose', available: false }
  assert.deepEqual(sortAgents([missing, codex], 'week'), [codex, missing])
})
