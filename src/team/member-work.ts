// A group member's work, as the phone's work sheet shows it: one turn of the member's
// group Session, read with `turn-process`. The rules are the desktop's member work panel
// (member-work-model.js, execution-segments.js), so both show the same turn, the same
// calls and the same counts.

/** A turn of a member's group Session: what a group line or a live work entry names. */
export interface WorkAt { sessionId: string; turn: number }
/** A group line's turn, with how many tools it had run (mobile.js `workOf`). */
export interface LineWork extends WorkAt { tools?: number }
/** A member at work in a group (the live state's `work.rooms[roomId][]`). */
export interface RoomWork {
  botId: string
  sessionId?: string
  turn?: number
  since?: number
  count?: number
  tool?: string
  said?: string
  note?: string
  target?: string
}
/** What opens the sheet: the member, its group, and the turn its opener knew of. */
export interface MemberWorkOpen { roomId: string; botId: string; at: Partial<LineWork> }

/** One row of a turn's process, as `turn-process` sends it. */
export interface ProcessRow {
  type: 'tool' | 'text' | 'input' | 'error'
  toolId?: string
  name?: string
  status?: string
  text?: string
  exitCode?: number
  durationMs?: number
  parentId?: string
}
export interface TurnProcess { running: boolean; events: ProcessRow[]; omitted?: number; rev?: string; unchanged?: boolean }

export type ProcessSegment =
  | { type: 'tools'; key: string; rows: ProcessRow[] }
  | { type: 'text' | 'input' | 'error'; key: string; row: ProcessRow }

/** The turn a group line or a live work entry names, or undefined when it names none. */
export function workAt(value: unknown): WorkAt | undefined {
  const entry = value as { sessionId?: unknown; turn?: unknown } | null | undefined
  return typeof entry?.sessionId === 'string' && entry.sessionId !== '' && Number.isSafeInteger(entry.turn)
    ? { sessionId: entry.sessionId, turn: entry.turn as number }
    : undefined
}

/**
 * The turn the sheet shows: the one its opener named, else the one the member runs in the
 * group now. `running` says the shown turn is the live one; `newer` names the live turn
 * while the sheet shows another (the member went on with new work).
 */
export function memberWorkTarget(at: unknown, entry: unknown): (WorkAt & { running: boolean; newer?: WorkAt }) | null {
  const known = workAt(at)
  const live = workAt(entry)
  const shown = known ?? live
  if (shown === undefined) return null
  const same = live !== undefined && live.sessionId === shown.sessionId && live.turn === shown.turn
  return { ...shown, running: same, ...(live !== undefined && !same ? { newer: live } : {}) }
}

/** A line opens its turn's process only when that turn ran tools. */
export function hasProcess(work: unknown): work is LineWork {
  const tools = (work as { tools?: unknown } | null | undefined)?.tools
  return workAt(work) !== undefined && Number.isSafeInteger(tools) && (tools as number) > 0
}

/** The other members at work in the group whose live turn the sheet can show. */
export function otherWorkers(entries: RoomWork[] | undefined, botId: string): (WorkAt & { botId: string })[] {
  return (Array.isArray(entries) ? entries : []).flatMap(entry => {
    const at = workAt(entry)
    return typeof entry?.botId === 'string' && entry.botId !== botId && at !== undefined ? [{ botId: entry.botId, ...at }] : []
  })
}

const sameTurn = (a: WorkAt | undefined, b: WorkAt | undefined) => a !== undefined && b !== undefined && a.sessionId === b.sessionId && a.turn === b.turn
// The round a reply row belongs to: `room-chat` names a round's rows `<call>:<index>`,
// and a post a member made on its own by its seq alone.
const roundOf = (id: string | undefined) => (id !== undefined && id.includes(':') ? id.slice(0, id.lastIndexOf(':')) : undefined)

/**
 * Which group rows show the way into their turn's process: a member's message whose turn
 * ran tools. The desktop stacks a member's replies in one round that come from one turn
 * into a single message, whose header carries the newest count; here the last of them
 * carries it. Posts outside a round stand alone on both.
 */
export function processEntries(items: { id?: string; kind?: string; botId?: string; work?: unknown }[]): boolean[] {
  return items.map((item, index) => {
    if (item.kind !== 'bot' || !hasProcess(item.work)) return false
    const next = items[index + 1]
    const round = roundOf(item.id)
    return !(next?.kind === 'bot' && next.botId === item.botId && round !== undefined && roundOf(next.id) === round
      && sameTurn(workAt(next.work), workAt(item.work)))
  })
}

/**
 * A turn's process as the sheet shows it: what the Bot wrote, and each run of calls
 * between its words as one group, the way its own chat folds them.
 */
export function processSegments(rows: ProcessRow[] | undefined): ProcessSegment[] {
  const segments: ProcessSegment[] = []
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    if (row?.type === 'tool') {
      const last = segments.at(-1)
      if (last?.type === 'tools') last.rows.push(row)
      else segments.push({ type: 'tools', key: `tools:${row.toolId ?? index}`, rows: [row] })
    } else if ((row?.type === 'text' || row?.type === 'input' || row?.type === 'error') && typeof row.text === 'string' && row.text !== '') {
      segments.push({ type: row.type, key: `${row.type}:${index}`, row })
    }
  }
  return segments
}

const unfinished = (status: string | undefined) => status === 'running' || status === 'pending'

/** How many of a run's calls have not ended yet. */
export const runningCalls = (rows: ProcessRow[]) => rows.filter(row => unfinished(row.status)).length

/** A call's state as shown: one still open in a turn that is over never reported its end. */
export const shownStatus = (status: string | undefined, live: boolean) => !live && unfinished(status) ? 'unknown' : status ?? 'unknown'

/** How long a turn has run, as the desktop's elapsedLabel writes it: 1h 2m 3s. */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  return `${hours > 0 ? `${hours}h ` : ''}${total >= 60 ? `${Math.floor(total / 60) % 60}m ` : ''}${total % 60}s`
}
