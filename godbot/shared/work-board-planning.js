// Scalar values and stable IDs used by both work board clients and the host.
export const priorities = {
  0: 'Normal',
  1: 'High',
  2: 'Urgent',
  3: 'Low',
  4: 'No priority',
}
export const priorityRank = [2, 3, 4, 1, 0]
export const manualStatuses = {
  backlog: { name: 'Backlog', phase: 'todo' },
  todo: { name: 'To do', phase: 'todo' },
  doing: { name: 'In progress', phase: 'doing' },
  attention: { name: 'Blocked', phase: 'attention' },
  review: { name: 'Awaiting review', phase: 'review' },
  done: { name: 'Done', phase: 'done' },
  cancelled: { name: 'Cancelled', phase: 'history' },
}

export const boardLayouts = {
  board: 'Board view',
  list: 'List view',
  table: 'Table view',
  swimlane: 'Swimlane view',
  gantt: 'Timeline view',
}
export const boardSorts = {
  priority: 'Priority',
  updated: 'Recently updated',
  dueDate: 'Due date',
  startDate: 'Start date',
  title: 'Title',
}
export const boardPropertyTypes = {
  text: 'Text',
  number: 'Number',
  select: 'Single choice',
  multiSelect: 'Multiple choices',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'Link',
  person: 'Person',
  people: 'People',
  textList: 'Text list',
  urlList: 'Link list',
}
export const planningDefaults = {
  description: '',
  labels: [],
  startDate: '',
  dueDate: '',
  statusId: '',
  assignee: '',
  parent: '',
  stage: 0,
  blockedBy: [],
  duplicateOf: '',
  customValues: {},
}

export const boardSortField = (kind) =>
  Object.hasOwn(boardSorts, kind) || /^property\/[\w-]{1,64}$/.test(kind ?? '') ? kind : 'priority'

export function viewFilters(value) {
  const filters = {}
  for (const [key, limit] of Object.entries({
    tab: 12, search: 160, owner: 200, assignee: 210, room: 200, source: 16, section: 200,
    phase: 16, statusId: 70, label: 64, priority: 1, startBefore: 10, dueBefore: 10,
    property: 64, propertyValue: 250,
  })) {
    if (typeof value?.[key] === 'string') filters[key] = value[key].slice(0, limit)
  }
  filters.sort = boardSortField(value?.sort)
  return filters
}

export function viewDisplay(value) {
  const layout = Object.hasOwn(boardLayouts, value?.layout) ? value.layout : 'board'
  const requested = value?.groupBy
  const groupBy = ['phase', 'assignee', 'parent', 'label', 'priority', 'source', 'status'].includes(requested)
    || /^property\/[\w-]{1,64}$/.test(requested ?? '') ? requested : 'phase'
  return { layout, groupBy }
}

export function filterLink(id) {
  return '#/godbot/work/view/' + encodeURIComponent(id)
}

export function cardGroups(columns, groupBy) {
  const groups = new Map()
  for (const column of columns) {
    for (const card of column.items) {
      const value = groupBy === 'phase' ? column.phase
        : groupBy === 'status' ? card.statusId || column.phase
        : groupBy === 'assignee' ? card.assignee || (card.owner && 'bot/' + card.owner)
        : groupBy === 'label' ? card.labels?.[0]
        : groupBy.startsWith('property/') ? card.customValues?.[groupBy.slice(9)]
        : card[groupBy]
      const key = String(value ?? '')
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(card)
    }
  }
  return [...groups].map(([key, items]) => ({ key, items }))
}

export function timelineBars(cards) {
  const day = 86_400_000
  const dates = cards.flatMap(card => [card.startDate, card.dueDate].filter(Boolean).map(Date.parse))
    .filter(Number.isFinite)
  if (!dates.length) return { bars: [], unscheduled: cards, first: '', last: '' }
  const min = Math.min(...dates)
  const max = Math.max(min + 6 * day, ...dates)
  const span = max - min + day
  const bars = [], unscheduled = []
  for (const card of cards) {
    const start = Date.parse(card.startDate || card.dueDate)
    if (!Number.isFinite(start)) {
      unscheduled.push(card)
      continue
    }
    const end = Date.parse(card.dueDate || card.startDate)
    bars.push({ card, left: (start - min) / span, width: (end - start + day) / span })
  }
  const iso = ms => new Date(ms).toISOString().slice(0, 10)
  return { bars, unscheduled, first: iso(min), last: iso(max) }
}
