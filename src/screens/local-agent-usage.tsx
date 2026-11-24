import { useIsFocused } from '@react-navigation/native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { DEMO, useTeam } from '../team/context.tsx'
import {
  agentAccounts, hasUsage, LOCAL_AGENT_USAGE, sortAgents, usagePeriods,
  type AccountQuota, type LocalAgent, type LocalAgentUsageView, type UsagePeriod, type UsageTotals,
} from '../team/local-agent-usage.ts'
import { t } from '../ui/i18n.ts'
import { type as typeScale, useTheme } from '../ui/tokens.ts'
import { Back, Row, Screen, Section } from './settings-pages.tsx'

const periods = Object.keys(usagePeriods) as UsagePeriod[]
const fmt = (value: number) => value.toLocaleString()
const tokenText = (totals?: UsageTotals) => totals?.reports
  ? totals.tokens === 1 ? t('1 token') : t('{count} tokens', { count: fmt(totals.tokens) })
  : totals?.unreported ? t('Tokens unreported') : t('No usage yet')
const missingCalls = (totals?: UsageTotals) => totals?.unreported
  ? totals.unreported === 1 ? t('1 call without a token count') : t('{count} calls without token counts', { count: fmt(totals.unreported) })
  : undefined
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const localDate = (date: string) => dateFormat.format(new Date(date))
const tokenParts = [['Tokens in', 'input'], ['Tokens out', 'output'], ['Cache reads', 'cacheRead'], ['Cache writes', 'cacheWrite']] as const

function UsageNote({ children }: { children: React.ReactNode }) {
  const { p } = useTheme()
  return <Text style={[typeScale.small, { color: p.ink2 }]}>{children}</Text>
}

function TokenBreakdown({ totals }: { totals?: UsageTotals }) {
  if (!totals?.reports) return null
  return <View style={styles.parts}>
    {tokenParts.map(([label, key]) => <UsageNote key={key}>{t(label)} {fmt(totals[key])}</UsageNote>)}
  </View>
}

const quotaState = {
  unchecked: 'Quota has not been checked',
  'signed-out': 'Account signed out',
  unavailable: 'Quota unavailable',
  stale: 'Previous quota reading',
  available: '',
} as const

function SavedQuota({ route, id, available }: { route: string; id: string | null; available: boolean }) {
  const { call } = useTeam()
  const [quota, setQuota] = useState<AccountQuota | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!available) return
    let active = true
    void call('local-agent-quota', { route, accountId: id }).then(
      value => { if (active) setQuota(value as AccountQuota) },
      () => { if (active) setFailed(true) },
    )
    return () => { active = false }
  }, [call, route, id, available])
  if (!available || failed) return <UsageNote>{t('Quota unavailable')}</UsageNote>
  if (!quota) return <UsageNote>{t('Reading saved quota…')}</UsageNote>
  const credits = quota.credits
  return <View style={styles.quota}>
    <UsageNote>{t('Provider quota')}{quotaState[quota.status] ? ' · ' + t(quotaState[quota.status]) : ''}</UsageNote>
    {quota.windows.map(window => {
      const figure = window.disabled ? t('Disabled')
        : window.usedPercent !== null ? t('{count}% used', { count: fmt(window.usedPercent) })
        : window.remainingPercent !== null ? t('{count}% remaining', { count: fmt(window.remainingPercent) })
        : window.remainingAmount !== null ? t('{count} remaining', { count: fmt(window.remainingAmount) }) : ''
      return <View key={window.id}>
        <UsageNote>{[window.label, figure].filter(Boolean).join(' · ')}</UsageNote>
        {window.resetsAt ? <UsageNote>{t('Resets {time}', { time: localDate(window.resetsAt) })}</UsageNote> : null}
      </View>
    })}
    {credits?.unlimited === true ? <UsageNote>{t('Unlimited credits')}</UsageNote>
      : typeof credits?.balance === 'number' ? <UsageNote>{t('{count} credits', { count: fmt(credits.balance) })}</UsageNote> : null}
    {quota.updatedAt ? <UsageNote>{t('Quota checked {time}', { time: localDate(quota.updatedAt) })}</UsageNote> : null}
  </View>
}

function AgentDetails({ agent, period, asOf, online }: { agent: LocalAgent; period: UsagePeriod; asOf: string; online: boolean }) {
  const { p } = useTheme()
  const accounts = agentAccounts(agent, period)
  return <View style={[styles.details, { backgroundColor: p.hover }]}>
    {accounts.length > 1 ? <TokenBreakdown totals={agent.periods?.[period]} /> : null}
    {accounts.map(account => {
      const totals = account.usage?.periods[period]
      const name = account.usage?.attribution === 'unknown' ? t('Unknown account')
        : account.name ?? (account.historical ? t('Host history') : t('On this computer'))
      return <View key={account.key} style={styles.account}>
        <Text style={[typeScale.settingsRow, { color: p.ink }]}>{name} · {tokenText(totals)}</Text>
        {account.historical ? <UsageNote>{t('Historical usage')}</UsageNote> : null}
        {missingCalls(totals) ? <UsageNote>{missingCalls(totals)}</UsageNote> : null}
        <TokenBreakdown totals={totals} />
        {account.usage?.models.filter(model => hasUsage(model.periods[period])).map(model =>
          <UsageNote key={model.model ?? ''}>{model.model ?? t('Unknown model')} · {tokenText(model.periods[period])}</UsageNote>)}
        {agent.quotaSupported && !account.historical && online
          ? <SavedQuota key={asOf} route={agent.route} id={account.id} available={account.available} />
          : null}
      </View>
    })}
    {agent.quotaSupported === false ? <UsageNote>{t('Provider quota unavailable for this agent')}</UsageNote> : null}
  </View>
}

function LocalAgentUsagePanel({ online, canRead }: { online: boolean; canRead: boolean }) {
  const { call } = useTeam()
  const { p } = useTheme()
  const focused = useIsFocused()
  const [view, setView] = useState<LocalAgentUsageView | null>(null)
  const [period, setPeriod] = useState<UsagePeriod>('week')
  const [route, setRoute] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const request = useRef(0)
  const refresh = useCallback(async (refreshHistory = false) => {
    const ticket = ++request.current
    setLoading(true)
    setError(false)
    try {
      const deadline = Date.now() + 60_000
      while (ticket === request.current) {
        const value = await call(LOCAL_AGENT_USAGE, { refreshHistory }) as LocalAgentUsageView
        if (ticket !== request.current) break
        setView(value)
        if (!refreshHistory || !value.historyScanning || Date.now() >= deadline) break
        await new Promise(resolve => setTimeout(resolve, 700))
      }
    } catch {
      if (ticket === request.current) setError(true)
    } finally {
      if (ticket === request.current) setLoading(false)
    }
  }, [call])
  useEffect(() => {
    if (focused && online && canRead) void refresh()
    else setLoading(false)
    return () => { request.current++ }
  }, [focused, online, canRead, refresh])
  const agents = useMemo(() => sortAgents(view?.providers ?? [], period), [view, period])
  const totals = view?.totals[period]
  const canRefresh = online && canRead && !loading
  return <ScrollView contentContainerStyle={styles.scroll}>
    <View style={styles.toolbar}>
      <View style={[styles.periods, { backgroundColor: p.hover }]} accessibilityRole="radiogroup">
        {periods.map(key => <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: key === period }}
          onPress={() => setPeriod(key)} style={[styles.period, key === period && { backgroundColor: p.card }]}>
          <Text style={[typeScale.small, { color: key === period ? p.ink : p.ink2, textAlign: 'center' }]}>{t(usagePeriods[key])}</Text>
        </Pressable>)}
      </View>
      {loading ? <ActivityIndicator color={p.accent} /> : null}
      <Pressable accessibilityRole="button" disabled={!canRefresh} onPress={() => void refresh(true)} style={styles.refresh}>
        <Text style={[typeScale.small, { color: canRefresh ? p.accent : p.ink3 }]}>{t('Refresh usage')}</Text>
      </Pressable>
    </View>
    <View style={styles.notice}>
      {!online ? <UsageNote>{t('Connect to the computer to refresh usage.')}</UsageNote> : null}
      {error ? <UsageNote>{t('Could not load local agent usage.')}</UsageNote> : null}
      {view?.historyScanning ? <UsageNote>{t('Session history is still being indexed.')}</UsageNote> : null}
      {view?.ledgerStatus === 'unavailable' ? <UsageNote>{t('Some usage records are unavailable.')}</UsageNote> : null}
      {view?.asOf ? <UsageNote>{t('Usage updated {time}', { time: localDate(view.asOf) })}</UsageNote> : null}
    </View>
    {view ? <>
      <Section label={t('All local agents')}>
        <Row label={t('Godbot session tokens')} value={tokenText(totals)} hint={missingCalls(totals)} />
      </Section>
      {agents.length > 0 ? <Section label={t('Local agents')}>
        {agents.map(agent => {
          const active = route === agent.route
          const interval = agent.periods?.[period]
          const status = agent.archived ? t('Historical usage') : !agent.available ? t('CLI not detected') : ''
          const hint = [status, interval?.reports ? missingCalls(interval) : undefined].filter(Boolean).join(' · ')
          return <View key={agent.route}>
            <Row label={agent.name} value={tokenText(interval)} hint={hint} expanded={active}
              onPress={() => setRoute(active ? '' : agent.route)} />
            {active ? <AgentDetails agent={agent} period={period} asOf={view.asOf} online={online} /> : null}
          </View>
        })}
      </Section> : null}
    </> : null}
  </ScrollView>
}

export function LocalAgentUsage({ navigation }: { navigation: { goBack: () => void } }) {
  const { online, hello } = useTeam()
  const canRead = DEMO || hello?.capabilities.includes(LOCAL_AGENT_USAGE) === true
  return <Screen>
    <Back title={t('Local agent usage')} onBack={navigation.goBack} />
    {hello && !canRead
      ? <View style={styles.notice}><UsageNote>{t('Update Godbot on this computer to see local agent usage.')}</UsageNote></View>
      : <LocalAgentUsagePanel key={hello?.boot} online={online} canRead={canRead} />}
  </Screen>
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginHorizontal: 14, marginTop: 10 },
  periods: { flexDirection: 'row', padding: 2, borderRadius: 9, flexGrow: 1 },
  period: { flex: 1, minHeight: 36, paddingHorizontal: 5, paddingVertical: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  refresh: { minHeight: 44, justifyContent: 'center' },
  notice: { paddingHorizontal: 18, marginTop: 8, gap: 4 },
  parts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  details: { paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  account: { gap: 4 },
  quota: { gap: 4, paddingTop: 4 },
})
