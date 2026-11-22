import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TeamState } from '../connection.ts'
import { lastChatKey, lastChatOf, rosterOf } from './sidebar-roster.ts'

const team: TeamState = {
  revision: 3,
  mainBotId: 'lead',
  mainBotIds: ['lead', 'second'],
  bots: [
    { id: 'lead', name: 'GodBot', hidden: true },
    { id: 'second', name: 'Backup Main Bot', hidden: true, lastAt: 10 },
    { id: 'a', name: 'Codex', sectionId: 'sec-a', lastAt: 50 },
    { id: 'b', name: 'Claude', sectionId: 'sec-a', lastAt: 20, pinned: true },
    { id: 'old-hidden', name: 'Hidden Bot', sectionId: 'sec-b', hidden: true, lastAt: 15 },
    { id: 'orphan', name: 'Bot from removed section', sectionId: 'removed', createdAt: 12 },
  ],
  rooms: [{ id: 'r1', name: 'Team chat', sectionId: 'sec-b', createdAt: 5 }],
  sections: [{ id: 'sec-b', name: 'Operations', collapsed: true }, { id: 'sec-a', name: 'Development' }],
}

test('the Android roster uses the host lead, sections and pin order', () => {
  const roster = rosterOf(team)
  assert.equal(roster.lead?.id, 'lead')
  assert.deepEqual(roster.ungrouped.map(row => row.item.id), ['orphan', 'second'])
  assert.equal(roster.mains.has('second'), true)
  assert.deepEqual(roster.sections.map(group => group.section.id), ['sec-b', 'sec-a'])
  assert.deepEqual(roster.sections[0].entries.map(row => row.item.id), ['r1'])
  assert.deepEqual(roster.sections[1].entries.map(row => row.item.id), ['b', 'a'])
  assert.equal(roster.sections[0].collapsed, true)
})

test('search finds hidden chats and expands matching sections without saving collapse state', () => {
  const search = rosterOf(team, undefined, ' hiDDen ')
  assert.equal(search.lead, undefined)
  assert.equal(search.ungrouped.length, 0)
  assert.equal(search.sections.length, 1)
  assert.equal(search.sections[0].section.id, 'sec-b')
  assert.equal(search.sections[0].collapsed, false)
  assert.deepEqual(search.sections[0].entries.map(row => row.item.id), ['old-hidden'])
  assert.equal(team.sections?.[0].collapsed, true)
  assert.equal(rosterOf(team, { kind: 'bot', id: 'old-hidden' }).sections[0].entries.length, 2)
})

test('pairings use distinct last-chat keys and the saved target must be a valid chat', () => {
  assert.notEqual(lastChatKey('d-host-1'), lastChatKey('d-host-2'))
  assert.equal(lastChatOf('{"kind":"else","id":"a"}'), null)
  assert.equal(lastChatOf('{"kind":"bot","id":""}'), null)
  assert.deepEqual(lastChatOf('{"kind":"room","id":"r1"}'), { kind: 'room', id: 'r1' })
  assert.deepEqual(lastChatOf('{"kind":"bot","id":"a","readOnlyPart":"part-2"}'), { kind: 'bot', id: 'a', readOnlyPart: 'part-2' })
})
