// A Bot's chat sessions as the phone lists them, the same list as the desktop's
// (bot-sessions.js): the sheet behind the chat's Sessions button and the list on the
// Bot's details page.
import type { Bot, BotConversation, TeamState } from '../connection.ts'
import { t } from '../ui/i18n.ts'

export interface BotSession {
  /** The conversation's ID, the one to copy: its first part's, which stays the same when
   * Godbot moves the conversation on to a fresh part. */
  id: string
  /** The part the conversation goes on in, the one to open. */
  head: string
  parts: string[]
  /** Counts the sessions in the order DSH made them, from 1. */
  number: number
  current: boolean
  /** Goes on in the background beside the current one (`openParts`). */
  background: boolean
  running: boolean
  /** A question in it waits for the user. */
  waiting: boolean
  /** The first thing the user asked in it, as the host reads it; '' while it has none. */
  title: string
}

export const currentPart = (bot: Bot) => bot.sessionId ?? bot.id
const runningRank = (entry: BotSession) => Number(entry.running && !entry.waiting)

// Every part of a Bot's own chat: the current one, each one going on in the background,
// and the earlier ones of every chain.
const ownParts = (bot: Bot) => {
  const open = bot.openParts ?? []
  return unique([currentPart(bot), ...open.map(part => part.sessionId), ...(bot.parts ?? []), ...open.flatMap(part => part.parts ?? [])])
}

// The conversations of a Bot's own chat as the host groups its parts (`conversations`).
// An older host sends none: each part is a conversation of its own there.
export function botConversations(bot: Bot): BotConversation[] {
  if (Array.isArray(bot.conversations)) return bot.conversations
  return ownParts(bot).map(id => ({ id, head: id, parts: [id] }))
}

// The conversation a part belongs to, whichever of its parts it is: its ID to copy and
// its head to open. The desktop reads it the same way (bot-sessions.js conversationOfPart).
export const conversationOfPart = (bot: Bot, sessionId: string): BotConversation | undefined =>
  botConversations(bot).find(conversation => conversation.parts.includes(sessionId))

// Every session of a Bot's own chat, one per conversation: the current one, each one
// going on in the background, and the earlier ones of every chain. A conversation Godbot
// moved on to a fresh part is one session. Running rows come first, then newest activity
// within each set. Empty sessions are hidden unless current or running.
export function botSessions(bot: Bot, team: TeamState | null): BotSession[] {
  const current = currentPart(bot)
  const empty = new Set(team?.emptyParts?.[bot.id] ?? [])
  const running = team?.partsRunning ?? {}
  const open = bot.openParts ?? []
  const background = new Set(open.map(part => part.sessionId))
  const conversations = botConversations(bot)
  const ids = new Set(conversations.map(conversation => conversation.id))
  // The host orders parts by when DSH made them (`partOrder`). A part it has not ordered,
  // or a host that sends no order, comes after: earlier parts before the parts they led
  // to, the current one last. A session counts by its first part.
  const order = unique([...(bot.partOrder ?? []), ...(bot.parts ?? []), ...open.flatMap(part => [...(part.parts ?? []), part.sessionId]), current])
    .filter(id => ids.has(id))
  const numbers = new Map(order.map((id, index) => [id, index + 1]))
  const activity = team?.partActivity
  const latest = (parts: string[]) => Math.max(0, ...parts.map(part => activity?.[part] ?? 0))
  return conversations
    .filter(({ parts }) => parts.includes(current) || parts.some(part => running[part] === true || !empty.has(part)))
    .map(({ id, head, parts }) => ({
      id,
      head,
      parts,
      number: numbers.get(id) ?? order.length + 1,
      current: parts.includes(current),
      background: background.has(head),
      running: parts.some(part => running[part] === true),
      waiting: parts.some(part => team?.questions?.[part] !== undefined),
      title: parts.map(part => team?.partTitles?.[part]).find((title): title is string => typeof title === 'string' && title !== '') ?? '',
    }))
    .sort((a, b) => runningRank(b) - runningRank(a) || latest(b.parts) - latest(a.parts) || b.number - a.number)
}

const unique = (ids: (string | undefined)[]): string[] =>
  ids.filter((id, index, list): id is string => typeof id === 'string' && id !== '' && list.indexOf(id) === index)

// A session's name: what the user first asked in it. A host that does not read those
// names (no `partTitles`) numbers every session, and a current part nobody talked in
// (`newSessions`) is the New session.
export function sessionLabel(entry: BotSession, bot: Bot, team: TeamState | null): string {
  if (entry.title !== '') return entry.title
  if (entry.current && team?.newSessions?.[bot.id] === 'empty') return t('New session')
  return t('Session {number}', { number: entry.number })
}

// What a row says on its right: a question waiting for the user, a turn running, else
// whether it is the one on screen. The phone has no time of a session's last activity.
export function sessionMeta(entry: BotSession): { tone?: 'wait' | 'run'; text: string } {
  if (entry.waiting) return { tone: 'wait', text: t('Waiting for your answer') }
  if (entry.running) return { tone: 'run', text: t('Running') }
  return { text: entry.current ? t('Current') : '' }
}

// The sessions besides the one on screen that need a look: one running (the chat's
// Sessions button shows a dot) or one waiting for the user.
export function elsewhere(entries: BotSession[]): { running: number; waiting: number } {
  const others = entries.filter(entry => !entry.current)
  return { running: others.filter(entry => entry.running).length, waiting: others.filter(entry => entry.waiting).length }
}

// A host whose Bot chats go on in the background reads each part's first prompt
// (`partTitles`). Any session opens there, a running one included, and takes input like
// the current one. An older host turns the pick away while the Bot works ("bot/busy"),
// and its desktop shows a running session it opens read-only until its turn ends.
export const parallelSessions = (team: TeamState | null) => team?.partTitles !== undefined

// Whether a part of a Bot's own chat works with no turn of its own running: work it
// started goes on by itself (its CLI's background tasks, DSH subagents) and a reply is
// still to come. `partsRunning` names every part that works, a turn running or not;
// `work.turns`, from the same answer, names the parts a turn runs in. A host that sends
// no `turns` cannot tell the two apart, and the part counts as running a turn. The
// desktop reads it the same way (bot-sessions.js worksInBackground).
export function worksInBackground(team: TeamState | null, sessionId: string): boolean {
  const turns = team?.work?.turns
  return team?.partsRunning?.[sessionId] === true && turns !== undefined && turns[sessionId] === undefined
}

// How many parts of a Bot's own chat run with no turn on screen: each one going on
// beside the current part, and the current part itself while only its background work
// goes on. The team list names this count; the session list marks the same parts Running.
export function backgroundRunning(bot: Bot, team: TeamState | null): number {
  const current = currentPart(bot)
  const beside = (bot.openParts ?? []).filter(part => part.sessionId !== current && team?.partsRunning?.[part.sessionId] === true).length
  return beside + (worksInBackground(team, current) ? 1 : 0)
}

// Whether the phone can list and switch a Bot's sessions. A host that keeps no parts
// for the Bot (no `parts`), or one that turned `bot-open-part` away as unknown, has no
// session list to offer.
export const switchable = (bot: Bot | undefined, unsupported: boolean) => bot !== undefined && Array.isArray(bot.parts) && !unsupported

// A host without the endpoint: Godbot's channel answers "Unknown endpoint …", the demo
// team "Demo cannot answer …".
export const unknownEndpoint = (failure: unknown) => {
  const { code, message } = (failure ?? {}) as { code?: unknown; message?: unknown }
  return code === 'bot/not-found' && typeof message === 'string' && /^(Unknown endpoint|Demo cannot answer) bot-(open|new)-part\b/u.test(message)
}

type Work = NonNullable<NonNullable<TeamState['work']>['bots']>[string]
type Activity = NonNullable<TeamState['activity']>[string]

// What the chat on screen shows of a Bot's work. `work.bots` and `activity` are per Bot:
// they say it works while any part of its own chat runs, the one on screen or one going
// on in the background, and while it works in a group chat. `partsRunning` says which
// parts of its own chat run, and `work.turns` when each one's turn began, so a Bot's
// work is shown on the part it belongs to. Undefined while the part on screen is idle.
export function partWork(bot: Bot, sessionId: string, team: TeamState | null): Work | Activity | undefined {
  const doing = team?.work?.bots?.[bot.id] ?? team?.activity?.[bot.id]
  const running = team?.partsRunning
  if (doing === undefined || running === undefined) return doing
  const work = typeof doing === 'object' ? doing as Work : undefined
  const others = [...(bot.openParts ?? []).map(part => part.sessionId), currentPart(bot)].filter(id => id !== sessionId)
  if (running[sessionId] === true) {
    // Only work it started goes on here, no turn: a turn running in another part is
    // what the Bot's entry describes, so this part shows its background work instead.
    if (worksInBackground(team, sessionId)) return others.some(id => team?.work?.turns?.[id] !== undefined) ? undefined : doing
    // Two parts run: the Bot's entry describes one of them, named by when its turn began.
    const turn = team?.work?.turns?.[sessionId]
    return work?.since !== undefined && turn !== undefined && work.since !== turn ? {} : doing
  }
  // Group work and the move to a fresh part show here as they always did.
  if (work !== undefined && (work.roomId !== undefined || work.switching === true)) return doing
  return others.some(id => running[id] === true) ? undefined : doing
}
