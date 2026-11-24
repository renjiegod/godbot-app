import assert from 'node:assert/strict'
import test from 'node:test'
import { elapsedLabel, hasProcess, memberWorkTarget, otherWorkers, processEntries, processSegments, runningCalls, shownStatus, workAt, type ProcessRow } from './member-work.ts'

// The desktop's cases (member-work-model.test.js): the sheet shows the turn its opener
// named, else the member's live turn, and says when the member went on with new work.
test('the sheet shows the turn it was opened on, and names a newer live one', () => {
  const line = { sessionId: 'member-part', turn: 3, tools: 4 }
  const live = { botId: 'worker', sessionId: 'member-part', turn: 5, since: 1 }
  assert.deepEqual(memberWorkTarget(line, live), { sessionId: 'member-part', turn: 3, running: false, newer: { sessionId: 'member-part', turn: 5 } })
  assert.deepEqual(memberWorkTarget({ sessionId: 'member-part', turn: 5 }, live), { sessionId: 'member-part', turn: 5, running: true })
  // The capsule names no turn of its own: the live one shows.
  assert.deepEqual(memberWorkTarget({}, live), { sessionId: 'member-part', turn: 5, running: true })
  assert.deepEqual(memberWorkTarget(line, undefined), { sessionId: 'member-part', turn: 3, running: false })
  assert.equal(memberWorkTarget({}, { botId: 'worker' }), null, 'a host that names no turn has nothing to show')
  assert.equal(workAt({ sessionId: 'member-part', turn: '3' }), undefined)
  assert.equal(workAt({ sessionId: '', turn: 3 }), undefined)
})

test('a line opens its process only when its turn ran tools', () => {
  assert.equal(hasProcess({ sessionId: 's', turn: 1, tools: 2 }), true)
  assert.equal(hasProcess({ sessionId: 's', turn: 1 }), false)
  assert.equal(hasProcess({ sessionId: 's', turn: 1, tools: 0 }), false)
  assert.equal(hasProcess(undefined), false)
})

test('a member\'s replies of one turn in one round show its process once, on the newest', () => {
  const work = (turn: number, tools: number) => ({ sessionId: 'member-part', turn, tools })
  const items = [
    { id: 'call-1:0', kind: 'bot', botId: 'worker', work: work(3, 1) },
    { id: 'call-1:1', kind: 'bot', botId: 'worker', work: work(3, 4) },
    { id: 'call-1:2', kind: 'bot', botId: 'worker', work: work(4, 2) },
    { id: 'call-1:3', kind: 'bot', botId: 'other', work: work(4, 2) },
    { id: 'call-1:4', kind: 'event', botId: 'other', work: work(4, 2) },
    { id: 'call-1:5', kind: 'bot', botId: 'worker', work: { sessionId: 'member-part', turn: 6 } },
    { id: 'call-1:6', kind: 'bot', botId: 'worker' },
    // Posts a member made after the round moved on stand alone, as on the desktop.
    { id: '41', kind: 'bot', botId: 'worker', work: work(7, 1) },
    { id: '42', kind: 'bot', botId: 'worker', work: work(7, 3) },
    // A round's last reply and the next round's first one are two messages.
    { id: 'call-2:0', kind: 'bot', botId: 'worker', work: work(8, 2) },
    { id: 'call-3:0', kind: 'bot', botId: 'worker', work: work(8, 2) },
  ]
  assert.deepEqual(processEntries(items), [false, true, true, true, false, false, false, true, true, true, true])
})

test('the other members at work are those whose live turn the sheet can show', () => {
  const entries = [
    { botId: 'worker', sessionId: 'a', turn: 1 },
    { botId: 'reviewer', sessionId: 'b', turn: 2 },
    { botId: 'writer' },
  ]
  assert.deepEqual(otherWorkers(entries, 'worker'), [{ botId: 'reviewer', sessionId: 'b', turn: 2 }])
  assert.deepEqual(otherWorkers(undefined, 'worker'), [])
})

test('a process folds each run of calls between the Bot\'s words into one group', () => {
  const tool = (toolId: string, status: string): ProcessRow => ({ type: 'tool', toolId, name: 'Bash', status })
  const segments = processSegments([
    tool('a', 'completed'),
    tool('b', 'failed'),
    { type: 'text', text: 'Found it.' },
    { type: 'text', text: '' },
    tool('c', 'running'),
    { type: 'error', text: 'The model stopped.' },
    { type: 'tool', name: 'ask_user', status: 'completed' },
  ])
  assert.deepEqual(segments.map(segment => segment.type === 'tools' ? [segment.key, segment.rows.length] : [segment.key, segment.row.text]), [
    ['tools:a', 2], ['text:2', 'Found it.'], ['tools:c', 1], ['error:5', 'The model stopped.'], ['tools:6', 1],
  ])
  assert.equal(runningCalls([tool('a', 'running'), tool('b', 'pending'), tool('c', 'completed')]), 2)
  assert.deepEqual(processSegments(undefined), [])
})

test('a call still open in a turn that is over shows as unknown', () => {
  assert.equal(shownStatus('running', true), 'running')
  assert.equal(shownStatus('running', false), 'unknown')
  assert.equal(shownStatus('pending', false), 'unknown')
  assert.equal(shownStatus('failed', false), 'failed')
  assert.equal(shownStatus(undefined, true), 'unknown')
})

test('elapsed time reads as the desktop writes it', () => {
  assert.equal(elapsedLabel(4_200), '4s')
  assert.equal(elapsedLabel(125_000), '2m 5s')
  assert.equal(elapsedLabel(3_725_000), '1h 2m 5s')
})
