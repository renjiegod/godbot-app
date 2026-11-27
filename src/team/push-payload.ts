// Godbot: turning what arrives into what the phone shows. Pure functions, so the
// background push task, the in-app notices and the tests share them.
import { boardCommentTarget } from './work-board-link.ts'
import { decryptPush, type PushNotification } from '../../godbot/link/push.ts'

export type ChannelId = 'needs-you' | 'messages' | 'connection'

/** Notices that wait for the person go to the loud channel; news to the quiet one. */
export const NEEDS_YOU_KINDS = new Set(['approval', 'question', 'view'])
export const NOTIFIED_KINDS = new Set(['approval', 'question', 'view', 'message', 'group', 'done'])

export const channelFor = (kind: string): ChannelId => (NEEDS_YOU_KINDS.has(kind) ? 'needs-you' : 'messages')

/** The FCM data a computer's push carries: the computer's device id and the sealed notice. */
export interface PushFields { h: string; c: string }

/**
 * expo-notifications hands an FCM data message to the background task either as its
 * fields or as one JSON `dataString`, depending on the version and app state.
 */
export function pushFields(payload: unknown): PushFields | null {
  const outer = payload as { data?: unknown } | null
  const data = (outer !== null && typeof outer === 'object' && 'data' in outer ? outer.data : payload) as Record<string, unknown> | null
  if (data === null || typeof data !== 'object') return null
  let fields: Record<string, unknown> = data
  if (typeof data.dataString === 'string') {
    try { fields = JSON.parse(data.dataString) as Record<string, unknown> } catch { return null }
  } else if (typeof data.body === 'string' && data.h === undefined) {
    try { fields = JSON.parse(data.body) as Record<string, unknown> } catch { /* not ours */ }
  }
  if (fields === null || typeof fields !== 'object') return null
  const { v, h, c } = fields
  if (String(v) !== '1' || typeof h !== 'string' || typeof c !== 'string' || h === '' || c === '') return null
  return { h, c }
}

/** Opens a push with the key the phone gave that computer; null when it cannot be opened. */
export function openPush(fields: PushFields, keyFor: (hostDeviceId: string) => string | undefined): PushNotification | null {
  const key = keyFor(fields.h)
  if (key === undefined) return null
  try { return decryptPush(key, fields.h, fields.c) } catch { return null }
}

export interface LocalNotice {
  title: string
  body: string
  channelId: ChannelId
  data: { kind: string; botId?: string; roomId?: string; sessionId?: string; host?: string; workItemId?: string; commentId?: string }
}

/** A pushed notification as the phone shows it. */
function boardFields(note: unknown) {
  const board = boardCommentTarget(note)
  return board ? { workItemId: board.id, commentId: board.comment } : {}
}

export function pushContent(note: PushNotification, host: string): LocalNotice {
  return {
    title: note.title,
    body: note.body,
    channelId: channelFor(note.kind),
    data: { kind: note.kind, host, ...boardFields(note), ...(note.botId ? { botId: note.botId } : {}), ...(note.roomId ? { roomId: note.roomId } : {}), ...(note.sessionId ? { sessionId: note.sessionId } : {}) },
  }
}

/** A live `notice` feed event, shown while the app is in the background. */
export function noticeContent(
  notice: { kind?: unknown; name?: unknown; title?: unknown; text?: unknown; botId?: unknown; roomId?: unknown; sessionId?: unknown; workItemId?: unknown; commentId?: unknown },
  words: { finished: string; newReply: string; approval: string; question: string },
): LocalNotice | null {
  const kind = typeof notice.kind === 'string' ? notice.kind : ''
  if (!NOTIFIED_KINDS.has(kind)) return null
  const str = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)
  const head = str(notice.title) ?? str(notice.name) ?? 'Godbot'
  const text = str(notice.text)
  const body = kind === 'approval' ? (text !== undefined ? `${words.approval}: ${text}` : words.approval)
    : kind === 'question' ? text ?? words.question
      : kind === 'done' ? words.finished
        : text ?? words.newReply
  return {
    title: head,
    body,
    channelId: channelFor(kind),
    data: { kind, ...boardFields(notice), ...(str(notice.botId) ? { botId: str(notice.botId) } : {}), ...(str(notice.roomId) ? { roomId: str(notice.roomId) } : {}), ...(str(notice.sessionId) ? { sessionId: str(notice.sessionId) } : {}) },
  }
}

/** Where a tap on a notification should go. */
export function targetOf(data: unknown): { kind: 'bot' | 'room'; id: string } | null {
  const value = data as { botId?: unknown; roomId?: unknown } | null
  if (value === null || typeof value !== 'object') return null
  if (typeof value.roomId === 'string' && value.roomId !== '') return { kind: 'room', id: value.roomId }
  if (typeof value.botId === 'string' && value.botId !== '') return { kind: 'bot', id: value.botId }
  return null
}
