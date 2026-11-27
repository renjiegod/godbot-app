import type { Bot, Room, TeamState } from '../connection.ts'

export interface ChatTarget {
  kind: 'bot' | 'room'
  id: string
  readOnlyPart?: string
  boardPart?: string
  boardReference?: boolean
  boardMessage?: string
  boardTurn?: number
}

export type RosterEntry = { kind: 'bot'; item: Bot } | { kind: 'room'; item: Room }
export type RosterSection = NonNullable<TeamState['sections']>[number]

export function primaryBot(team: TeamState | null): Bot | undefined {
  const bots = team?.bots ?? []
  return bots.find(bot => bot.id === (team?.mainBotId ?? team?.mainBotIds?.[0]))
}

export function rosterOf(team: TeamState | null, current?: ChatTarget, query = '') {
  const bots = team?.bots ?? []
  const lead = primaryBot(team)
  const mains = new Set([...(team?.mainBotIds ?? []), ...(lead ? [lead.id] : [])])
  const needle = query.trim().toLowerCase()
  const matches = (name: string) => name.toLowerCase().includes(needle)
  const entries: RosterEntry[] = [
    ...bots.filter(bot => bot.id !== lead?.id).map(item => ({ kind: 'bot' as const, item })),
    ...(team?.rooms ?? []).map(item => ({ kind: 'room' as const, item })),
  ]
  const order = entries.filter(({ item, kind }) => {
    const active = current?.kind === kind && current.id === item.id
    const main = kind === 'bot' && mains.has(item.id)
    return (item.hidden !== true || active || main || needle !== '') && matches(item.name)
  }).sort((a, b) => Number(b.item.pinned === true) - Number(a.item.pinned === true)
    || (b.item.lastAt ?? b.item.createdAt ?? 0) - (a.item.lastAt ?? a.item.createdAt ?? 0))
  const sections = team?.sections ?? []
  const bySection = new Map(sections.map(section => [section.id, [] as RosterEntry[]]))
  const ungrouped: RosterEntry[] = []
  for (const entry of order) {
    const group = entry.item.sectionId === undefined ? ungrouped : bySection.get(entry.item.sectionId) ?? ungrouped
    group.push(entry)
  }
  return {
    lead: lead && matches(lead.name) ? lead : undefined,
    mains,
    ungrouped,
    sections: sections.flatMap(section => {
      const entries = bySection.get(section.id) ?? []
      if (needle && entries.length === 0) return []
      const collapsed = !needle && section.collapsed === true
      return [{ section, entries, collapsed }]
    }),
  }
}

export function lastChatKey(hostDeviceId: string): string {
  return `godbot.lastChat.${hostDeviceId}`
}

export function lastChatOf(text: string | null): ChatTarget | null {
  if (!text) return null
  try {
    const target = JSON.parse(text) as Partial<ChatTarget> | null
    if ((target?.kind === 'bot' || target?.kind === 'room') && typeof target.id === 'string' && target.id !== '') {
      return {
        kind: target.kind,
        id: target.id,
        ...(typeof target.readOnlyPart === 'string' ? { readOnlyPart: target.readOnlyPart } : {}),
      }
    }
  } catch { /* A bad stored route starts on the lead Bot. */ }
  return null
}
