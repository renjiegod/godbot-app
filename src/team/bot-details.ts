import type { Bot, TeamState } from '../connection.ts'

export interface SessionStats {
  sessionStats?: { turns?: number; steps?: number; decodeTokens?: number; decodeMs?: number }
  tokenUsage?: { uncachedInputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; outputTokens?: number }
  contextPressure?: { projectedTokens?: number; pressureTokens?: number; contextWindow?: number }
}

export function sessionUsage(stats: SessionStats | null) {
  const usage = stats?.tokenUsage
  const cacheRead = usage?.cacheReadTokens ?? 0
  const input = (usage?.uncachedInputTokens ?? 0) + cacheRead + (usage?.cacheWriteTokens ?? 0)
  return { input, cacheRead, total: input + (usage?.outputTokens ?? 0) }
}

export function sessionFigures(stats: SessionStats | null) {
  const { input, cacheRead } = sessionUsage(stats)
  const { turns = 0, decodeMs = 0, decodeTokens = 0 } = stats?.sessionStats ?? {}
  const speed = decodeMs > 0 && decodeTokens > 0 ? decodeTokens * 1_000 / decodeMs : null
  const { projectedTokens, pressureTokens, contextWindow = 0 } = stats?.contextPressure ?? {}
  const used = projectedTokens ?? pressureTokens
  let cacheHit = input > 0 ? (cacheRead / input) * 100 : null
  if (cacheHit !== null && cacheRead < input) {
    const hit = cacheHit
    cacheHit = [0, 1, 2].map(places => Number(hit.toFixed(places))).find(value => value < 100) ?? 99.99
  }
  return {
    turns,
    speed: speed === null ? null : speed >= 10 ? Math.round(speed) : Math.round(speed * 10) / 10,
    cacheHit,
    context: typeof used === 'number' && Number.isFinite(used) && contextWindow > 0 ? Math.min(100, Math.round(used * 100 / contextWindow)) : null,
  }
}

export function botPrivacyBlock(bot: Bot, team: TeamState | null): string | undefined {
  if (bot.private) return undefined
  const mains = team?.mainBotIds ?? (team?.mainBotId ? [team.mainBotId] : [])
  if (mains.includes(bot.id)) return 'A Main Bot cannot be private.'
  if (team?.rooms?.some(room => room.members?.includes(bot.id))) return 'Leave its group chats before making it private.'
  if (!bot.workDir) return 'Choose a working folder of its own first.'
  return undefined
}

export const modelRoute = (ref?: string) => ref?.split('/')[0] ?? ''
export const isLocalModel = (ref?: string) => modelRoute(ref).startsWith('local-')

// A model pick stays within its execution engine. The settings flow changes engines.
export function modelsForBot<T extends { ref: string }>(models: T[], ref?: string): T[] {
  return isLocalModel(ref)
    ? models.filter(model => modelRoute(model.ref) === modelRoute(ref))
    : models.filter(model => !isLocalModel(model.ref))
}
