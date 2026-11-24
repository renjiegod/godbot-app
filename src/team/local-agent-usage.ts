export const LOCAL_AGENT_USAGE = 'local-agent-usage'

export const usagePeriods = {
  today: 'Today (UTC)',
  week: 'Last 7 days',
  month: 'This month (UTC)',
} as const

export type UsagePeriod = keyof typeof usagePeriods
export type UsageTotals = {
  tokens: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reports: number
  unreported: number
}
type Periods = Record<UsagePeriod, UsageTotals>
type AccountUsage = {
  accountId: string | null
  attribution: 'host' | 'sandbox' | 'unknown'
  periods: Periods
  models: Array<{ model: string | null; periods: Periods }>
}
export type LocalAgent = {
  route: string
  name: string
  available?: boolean
  archived?: boolean
  quotaSupported?: boolean
  periods?: Periods
  accounts?: AccountUsage[]
  configuredAccounts?: Array<{ id: string | null; name: string | null; available: boolean }>
}
export type LocalAgentUsageView = {
  asOf: string
  ledgerStatus: 'ready' | 'not-created' | 'unavailable'
  historyScanning?: boolean
  totals: Periods
  providers: LocalAgent[]
}

export type AccountQuota = {
  status: 'available' | 'stale' | 'unchecked' | 'signed-out' | 'unavailable'
  windows: Array<{
    id: string
    label: string
    usedPercent: number | null
    remainingPercent: number | null
    remainingAmount: number | null
    resetsAt: string | null
    disabled: boolean
  }>
  updatedAt: string | null
  credits: { unlimited: boolean | null; balance: number | null; hasCredits: boolean | null } | null
}

export const hasUsage = (totals?: UsageTotals) => Boolean(totals?.reports || totals?.unreported)

export function sortAgents(agents: LocalAgent[], period: UsagePeriod) {
  return [...agents].sort((a, b) => Number(hasUsage(b.periods?.[period])) - Number(hasUsage(a.periods?.[period]))
    || (b.periods?.[period]?.tokens ?? 0) - (a.periods?.[period]?.tokens ?? 0)
    || Number(Boolean(b.available)) - Number(Boolean(a.available))
    || a.name.localeCompare(b.name, 'en') || a.route.localeCompare(b.route, 'en'))
}

export function agentAccounts(agent: LocalAgent, period: UsagePeriod) {
  const identity = (kind: AccountUsage['attribution'], id: string | null) => JSON.stringify([kind, id])
  const recorded = new Map((agent.accounts ?? []).map(row => [identity(row.attribution, row.accountId), row]))
  const current = (agent.configuredAccounts ?? []).map(({ id, name, available }) => {
    const key = identity(id === null ? 'host' : 'sandbox', id)
    const usage = recorded.get(key)
    recorded.delete(key)
    return { key, id, name: name ?? id, available, usage, historical: false }
  })
  for (const [key, usage] of recorded) {
    if (!hasUsage(usage.periods[period])) continue
    current.push({ key, id: usage.accountId, name: usage.accountId, available: false, usage, historical: true })
  }
  return current
}
