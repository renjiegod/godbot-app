import assert from 'node:assert/strict'
import test from 'node:test'
import type { Bot, TeamState } from '../connection.ts'
import { hostText, setLang, t } from '../ui/i18n.ts'
import { backgroundRunning, botSessions, elsewhere, parallelSessions, partWork, sessionLabel, sessionMeta, switchable, unknownEndpoint } from './bot-sessions.ts'

setLang('en')

// The desktop's case (bot-sessions.test.js): p4 current and running, p5 a busy-time
// part nobody talked in, p6 another one still running in the background with an
// earlier part of its own.
const bot: Bot = {
  id: 'p1', name: 'Codex', sessionId: 'p4', parts: ['p1', 'p2', 'p3'],
  openParts: [{ sessionId: 'p5', parts: [] }, { sessionId: 'p6', parts: ['p0'] }],
  partOrder: ['p1', 'p0', 'p2', 'p3', 'p4', 'p5', 'p6'],
}
const team: TeamState = {
  revision: 1,
  bots: [bot],
  emptyParts: { p1: ['p5'] },
  partsRunning: { p4: true, p6: true },
  questions: { p3: { id: 'q', question: 'Which branch?' } },
  partTitles: { p1: "what's your model name", p3: 'issues/2025 fix', p4: 'continue working on issues/2020' },
  newSessions: {},
}

test('every session of the chat is listed newest first, background chains included', () => {
  const entries = botSessions(bot, team)
  assert.deepEqual(entries.map(entry => entry.id), ['p6', 'p4', 'p3', 'p2', 'p0', 'p1'], 'the empty busy-time part is left out')
  assert.deepEqual(entries.find(entry => entry.id === 'p4'), { id: 'p4', number: 5, current: true, background: false, running: true, waiting: false, title: 'continue working on issues/2020' })
  assert.equal(entries.find(entry => entry.id === 'p6')?.background, true)
  assert.equal(entries.find(entry => entry.id === 'p3')?.waiting, true)
  assert.equal(entries.find(entry => entry.id === 'p0')?.number, 2)
})

test('running rows come first, with the host timestamp ordering each set of rows', () => {
  const state = { ...team, partsRunning: { ...team.partsRunning, p3: true }, partActivity: { p1: 200, p2: 100, p3: 100, p4: 100, p6: 80 } }
  assert.deepEqual(botSessions(bot, state).map(({ id, number }) => [id, number]), [
    ['p4', 5], ['p6', 7], ['p1', 1], ['p3', 4], ['p2', 3], ['p0', 2],
  ])
  assert.deepEqual(botSessions(bot, { ...state, partsRunning: {} }).map(row => row.id), ['p1', 'p4', 'p3', 'p2', 'p6', 'p0'])
})

test('a session is named by its first prompt, else New session or its number', () => {
  const [p6, p4, p3, p2] = botSessions(bot, team)
  assert.equal(sessionLabel(p4, bot, team), 'continue working on issues/2020')
  assert.equal(sessionLabel(p3, bot, team), 'issues/2025 fix')
  assert.equal(sessionLabel(p2, bot, team), 'Session 3')
  assert.equal(sessionLabel(p6, bot, team), 'Session 7')
  const fresh = { ...bot, sessionId: 'p7' }
  const quiet = { ...team, newSessions: { p1: 'empty' as const } }
  const current = botSessions(fresh, quiet).find(entry => entry.current)
  assert.equal(current?.id, 'p7')
  assert.equal(sessionLabel(current, fresh, quiet), 'New session')
})

test('a running background part stays listed even when nobody talked in it yet', () => {
  const godbot: Bot = {
    id: 'bot-1', name: 'GodBot', sessionId: 'part-4', parts: ['part-2', 'bot-1'],
    openParts: [{ sessionId: 'part-3' }, { sessionId: 'part-5' }],
    partOrder: ['bot-1', 'part-2', 'part-3', 'part-4', 'part-5'],
  }
  const state: TeamState = {
    revision: 1, bots: [godbot],
    partsRunning: { 'part-3': true },
    emptyParts: { [godbot.id]: ['part-2', 'part-3', 'part-5'] },
    newSessions: { [godbot.id]: 'empty' },
  }
  const rows = botSessions(godbot, state)
  assert.deepEqual(rows.map(row => [row.id, row.number, row.current, row.running]), [['part-3', 3, false, true], ['part-4', 4, true, false], ['bot-1', 1, false, false]])
  assert.deepEqual(rows.map(row => sessionLabel(row, godbot, state)), ['Session 3', 'New session', 'Session 1'])
})

test('an older host without first prompts numbers every session', () => {
  const old: TeamState = { ...team, partTitles: undefined }
  assert.equal(parallelSessions(old), false)
  assert.equal(parallelSessions(team), true)
  assert.deepEqual(botSessions(bot, old).map(entry => sessionLabel(entry, bot, old)), ['Session 7', 'Session 5', 'Session 4', 'Session 3', 'Session 2', 'Session 1'])
})

test('without the host order, earlier parts are numbered before the parts they led to', () => {
  const rows = botSessions({ id: 'bot', name: 'Bot', sessionId: 'now', parts: ['first', 'second'] }, null)
  assert.deepEqual(rows.map(row => [row.id, row.number, row.current]), [['now', 3, true], ['second', 2, false], ['first', 1, false]])
  const unordered = botSessions({ ...bot, partOrder: ['p1', 'p2'] }, team)
  assert.deepEqual(unordered.map(row => [row.id, row.number]), [['p4', 7], ['p6', 6], ['p0', 5], ['p3', 3], ['p2', 2], ['p1', 1]])
})

test('a row says a question waits, a turn runs, or that it is the one on screen', () => {
  const [p6, p4, p3, p2] = botSessions(bot, team)
  assert.deepEqual(sessionMeta(p3), { tone: 'wait', text: 'Waiting for your answer' })
  assert.deepEqual(sessionMeta(p6), { tone: 'run', text: 'Running' })
  assert.deepEqual(sessionMeta(p4), { tone: 'run', text: 'Running' })
  assert.deepEqual(sessionMeta(p2), { text: '' })
  const [, idle] = botSessions(bot, { ...team, partsRunning: {} })
  assert.deepEqual(sessionMeta(idle), { text: 'Current' })
})

test('the Sessions button counts what runs or waits besides the session on screen', () => {
  assert.deepEqual(elsewhere(botSessions(bot, team)), { running: 1, waiting: 1 })
  assert.equal(backgroundRunning(bot, team), 1)
  assert.equal(backgroundRunning(bot, { ...team, partsRunning: { p4: true } }), 0)
})

test('the session list needs a host that keeps parts and knows the endpoint', () => {
  assert.equal(switchable(bot, false), true)
  assert.equal(switchable(bot, true), false)
  assert.equal(switchable({ id: 'b', name: 'Old' }, false), false)
  assert.equal(switchable(undefined, false), false)
  assert.equal(unknownEndpoint(Object.assign(new Error('Unknown endpoint bot-open-part'), { code: 'bot/not-found' })), true)
  assert.equal(unknownEndpoint(Object.assign(new Error('Demo cannot answer bot-new-part'), { code: 'bot/not-found' })), true)
  assert.equal(unknownEndpoint(Object.assign(new Error('Unknown part'), { code: 'bot/not-found' })), false)
  assert.equal(unknownEndpoint(Object.assign(new Error('The Bot is working; wait for it to finish or stop it first'), { code: 'bot/busy' })), false)
  assert.equal(unknownEndpoint(undefined), false)
})

test('the session list and the computer\'s refusals read in Chinese', () => {
  setLang('zh')
  try {
    const [p6, p4, p3, p2] = botSessions(bot, team)
    assert.equal(sessionLabel(p2, bot, { ...team, partTitles: {} }), '会话 3')
    assert.equal(sessionMeta(p6).text, '运行中')
    assert.equal(sessionMeta(p3).text, '等你回答')
    assert.equal(sessionMeta({ ...p4, running: false }).text, '当前')
    const current = botSessions({ ...bot, sessionId: 'p7' }, team).find(entry => entry.current)
    assert.ok(current)
    assert.equal(sessionLabel(current, bot, { ...team, newSessions: { p1: 'empty' } }), '新会话')
    assert.equal(t('Sessions of {name}', { name: 'Codex' }), 'Codex 的会话')
    assert.equal(t('{count} running in the background', { count: 2 }), '2 个会话在后台运行')
    assert.equal(t('Update Godbot on the computer to switch sessions from the phone.'), '更新电脑上的 Godbot 后，才能在手机上切换会话。')
    // What a host says when it turns a switch away (parts.js), old and new.
    assert.equal(hostText('The Bot is working; wait for it to finish or stop it first'), 'Bot 正在工作，请等它结束或先停止它')
    assert.equal(hostText('A new session is starting; try again in a moment'), '新会话正在打开，请稍后再试')
    assert.equal(hostText('Another session became current meanwhile; open this one again'), '期间已切换到另一个会话，请重新打开这个会话')
    assert.equal(hostText('Unknown part'), '找不到这个会话')
  } finally {
    setLang('en')
  }
})

test('the chat shows the work of the part on screen, not of one in the background', () => {
  const busy: TeamState = {
    ...team,
    partsRunning: { p6: true },
    work: { bots: { p1: { tool: 'shell', since: 600 } }, turns: { p6: 600 } },
  }
  // p4 is idle while p6 runs in the background.
  assert.equal(partWork(bot, 'p4', busy), undefined)
  // On p6 itself the work shows.
  assert.deepEqual(partWork({ ...bot, sessionId: 'p6', openParts: [{ sessionId: 'p4' }] }, 'p6', busy), { tool: 'shell', since: 600 })
  // Both run: the Bot's entry is p6's, so p4 shows a turn without its details.
  const both: TeamState = { ...busy, partsRunning: { p4: true, p6: true }, work: { ...busy.work, turns: { p4: 500, p6: 600 } } }
  assert.deepEqual(partWork(bot, 'p4', both), {})
  assert.deepEqual(partWork(bot, 'p4', { ...both, work: { bots: { p1: { tool: 'shell', since: 500 } }, turns: { p4: 500, p6: 600 } } }), { tool: 'shell', since: 500 })
  // Work in a group chat and the move to a fresh part show as before.
  assert.deepEqual(partWork(bot, 'p4', { ...busy, work: { bots: { p1: { tool: 'shell', roomId: 'r1' } } } }), { tool: 'shell', roomId: 'r1' })
  assert.deepEqual(partWork(bot, 'p4', { ...busy, work: { bots: { p1: { switching: true } } } }), { switching: true })
  // Nothing in the background: whatever the Bot does shows, as on an older host.
  assert.deepEqual(partWork(bot, 'p4', { ...busy, partsRunning: {} }), { tool: 'shell', since: 600 })
  assert.deepEqual(partWork(bot, 'p4', { ...busy, partsRunning: undefined }), { tool: 'shell', since: 600 })
  assert.equal(partWork(bot, 'p4', { ...busy, work: {} }), undefined)
})
