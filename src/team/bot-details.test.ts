import assert from 'node:assert/strict'
import test from 'node:test'
import type { Bot, TeamState } from '../connection.ts'
import { botPrivacyBlock, botSessions, modelsForBot, sessionFigures, sessionUsage } from './bot-details.ts'

const bot: Bot = {
  id: 'bot-1',
  name: 'GodBot',
  sessionId: 'part-4',
  parts: ['part-2', 'bot-1'],
  openParts: [{ sessionId: 'part-3' }, { sessionId: 'part-5' }],
  partOrder: ['bot-1', 'part-2', 'part-3', 'part-4', 'part-5'],
}

test('session list retains the host numbers and preserves a running background part even if empty', () => {
  const team: TeamState = {
    revision: 1,
    bots: [bot],
    partsRunning: { 'part-3': true },
    emptyParts: { [bot.id]: ['part-2', 'part-3', 'part-5'] },
    newSessions: { [bot.id]: 'empty' },
  }
  assert.deepEqual(botSessions(bot, team), [
    { id: 'part-4', running: false, current: true, number: 4, fresh: true },
    { id: 'part-3', running: true, current: false, number: 3, fresh: false },
    { id: 'bot-1', running: false, current: false, number: 1, fresh: false },
  ])
})

test('older Godbot host without explicit numbering still lists current and historical sessions', () => {
  const rows = botSessions({ id: 'bot', name: 'Bot', sessionId: 'now', parts: ['first', 'now'] }, null)
  assert.deepEqual(rows.map(row => [row.id, row.number, row.current]), [['now', 2, true], ['first', 1, false]])
})

test('model changes stay on the exact local route, including the account and workspace', () => {
  const models = [
    { ref: 'api/model' },
    { ref: 'local-codex-cli/default' },
    { ref: 'local-sandbox-codex-team_w_1122334455667788/default' },
    { ref: 'local-sandbox-codex-team_w_1122334455667788/sol' },
    { ref: 'local-sandbox-codex-team_w_8877665544332211/sol' },
  ]
  assert.deepEqual(modelsForBot(models, models[2].ref), models.slice(2, 4))
  assert.deepEqual(modelsForBot(models, models[1].ref), [models[1]])
  assert.deepEqual(modelsForBot(models, models[0].ref), [models[0]])
  assert.deepEqual(modelsForBot(models), [models[0]])
})

test('session stats count cache writes in input and use projected context pressure', () => {
  const stats = {
    sessionStats: { turns: 5, decodeMs: 1_500, decodeTokens: 13 },
    tokenUsage: { uncachedInputTokens: 1, cacheWriteTokens: 1, cacheReadTokens: 1_998, outputTokens: 9 },
    contextPressure: { pressureTokens: 40, projectedTokens: 95, contextWindow: 100 },
  }
  assert.deepEqual(sessionUsage(stats), { input: 2_000, cacheRead: 1_998, total: 2_009 })
  assert.deepEqual(sessionFigures(stats), { turns: 5, speed: 8.7, cacheHit: 99.9, context: 95 })
  assert.deepEqual(sessionFigures(null), { turns: 0, speed: null, cacheHit: null, context: null })
})

test('privacy eligibility matches host constraints, including a legacy primary ID', () => {
  const team: TeamState = { revision: 1, bots: [bot], mainBotId: bot.id }
  assert.equal(botPrivacyBlock(bot, team), 'A Main Bot cannot be private.')
  assert.equal(botPrivacyBlock(bot, { ...team, mainBotId: null, rooms: [{ id: 'r', name: 'Group', members: [bot.id] }] }), 'Leave its group chats before making it private.')
  assert.equal(botPrivacyBlock(bot, null), 'Choose a working folder of its own first.')
  assert.equal(botPrivacyBlock({ ...bot, workDir: '/bots/one' }, null), undefined)
  assert.equal(botPrivacyBlock({ ...bot, private: true }, team), undefined)
})
