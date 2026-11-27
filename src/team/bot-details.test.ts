import assert from 'node:assert/strict'
import test from 'node:test'
import type { Bot, TeamState } from '../connection.ts'
import { botPrivacyBlock, modelsForBot, sessionFigures, sessionUsage, watchTurns } from './bot-details.ts'

const bot: Bot = {
  id: 'bot-1',
  name: 'GodBot',
  sessionId: 'part-4',
  parts: ['part-2', 'bot-1'],
  openParts: [{ sessionId: 'part-3' }, { sessionId: 'part-5' }],
  partOrder: ['bot-1', 'part-2', 'part-3', 'part-4', 'part-5'],
}

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

test('the run stats follow each closed turn, not its start or a redraw', () => {
  let watch = watchTurns(null, 'host:bot-1:part-4', undefined)
  assert.equal(watch.closed, 0)
  // A redraw with nothing new keeps the watch as it is.
  assert.equal(watchTurns(watch, 'host:bot-1:part-4', undefined), watch)
  watch = watchTurns(watch, 'host:bot-1:part-4', 1_000)
  assert.equal(watch.closed, 0, 'a turn starting moves nothing')
  watch = watchTurns(watch, 'host:bot-1:part-4', undefined)
  assert.equal(watch.closed, 1, 'the turn closed')
  // A turn that starts right after the last one ended closes that one.
  watch = watchTurns(watchTurns(watch, 'host:bot-1:part-4', 2_000), 'host:bot-1:part-4', 3_000)
  assert.equal(watch.closed, 2)
  // Another Bot, part or computer starts over: its first read is the one that opens it.
  assert.deepEqual(watchTurns(watch, 'host:bot-1:part-5', 3_000), { scope: 'host:bot-1:part-5', since: 3_000, closed: 0 })
})
