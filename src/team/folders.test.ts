import assert from 'node:assert/strict'
import test from 'node:test'
import { folderPlan } from './folders.ts'

const TEAM = '/work/team-workspace/workspace'

test('a native-picker computer (local macOS dsh web) is offered the team and known folders, not browsing', () => {
  // The answer a local dsh web gives: `folders` leaves out the team path.
  const plan = folderPlan({ team: TEAM, picker: 'native', folders: [{ path: '/Users/me/project', title: 'project' }] })
  assert.equal(plan.browse, false)
  assert.deepEqual(plan.choices, [
    { path: TEAM, title: 'workspace', team: true },
    { path: '/Users/me/project', title: 'project', team: false },
  ])
})

test('a browse-picker computer keeps browsing, with the same choices to start from', () => {
  const plan = folderPlan({ team: TEAM, picker: 'browse', folders: [] })
  assert.equal(plan.browse, true)
  assert.deepEqual(plan.choices, [{ path: TEAM, title: 'workspace', team: true }])
})

test('duplicates, empty paths and missing titles are handled; no answer offers nothing', () => {
  const plan = folderPlan({ team: TEAM, picker: null, folders: [{ path: TEAM, title: 'again' }, { path: '' }, { path: 'C:\\repos\\app' }] })
  assert.equal(plan.browse, false)
  assert.deepEqual(plan.choices.map(choice => [choice.path, choice.title, choice.team]), [[TEAM, 'workspace', true], ['C:\\repos\\app', 'app', false]])
  assert.deepEqual(folderPlan(null), { browse: false, choices: [] })
  assert.deepEqual(folderPlan({}), { browse: false, choices: [] })
})
