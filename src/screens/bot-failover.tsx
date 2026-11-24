import { useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import type { Bot, FailoverEvent, FailoverPolicy, FailoverTrigger, TeamState } from '../connection.ts'
import { openChat } from '../nav/open-chat.ts'
import { useTeam } from '../team/context.tsx'
import { hostText, t } from '../ui/i18n.ts'
import { type as typeScale, useTheme } from '../ui/tokens.ts'

const reasons: Record<FailoverTrigger, string> = {
  timeout: 'Timeout',
  network: 'API and network errors',
  authentication: 'Sign-in or credential errors',
  quota: 'Rate limit or quota',
  agent: 'Agent unavailable',
}
const statuses: Record<FailoverEvent['status'], string> = {
  switched: 'Switched Agent',
  queued: 'Handoff queued',
  running: 'Backup Bot working',
  completed: 'Handoff completed',
  failed: 'Handoff failed',
  exhausted: 'No backup Bot available',
  stopped: 'Handoff stopped',
}
type BackupKind = 'agents' | 'bots'
type Choice = { id: string; name: string }

function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { p } = useTheme()
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[styles.action, { backgroundColor: p.hover, opacity: disabled ? 0.5 : 1 }]}>
    <Text style={[typeScale.small, { color: p.ink }]}>{label}</Text>
  </Pressable>
}

export function FailoverActivity({ row, navigation }: { row: FailoverEvent; navigation: Parameters<typeof openChat>[0] }) {
  const { p } = useTheme()
  const { team, call, online } = useTeam()
  const target = team?.bots.find(bot => bot.id === row.targetBotId)
  const part = row.targetSessionId
  const name = row.kind === 'agent' ? row.target : target?.name
  const label = [t(statuses[row.status] ?? row.status), name].filter(Boolean).join(' · ')
  const canOpen = online && !team?.readOnly && !row.roomId && target && part
  const go = async () => {
    if (!target || !part) return
    try {
      await call('bot-open-part', { botId: target.id, sessionId: part })
      openChat(navigation, { kind: 'bot', id: target.id })
    } catch (cause) {
      if ((cause as { code?: string })?.code !== 'unlock/canceled') Alert.alert(t('Error'), hostText((cause as Error).message))
    }
  }
  return <View style={[styles.activity, { backgroundColor: p.hover }]}>
    {canOpen
      ? <Pressable accessibilityRole="button" onPress={() => void go()}><Text numberOfLines={2} style={[typeScale.small, { color: p.accent }]}>{label}</Text></Pressable>
      : <Text numberOfLines={2} style={[typeScale.small, { color: p.ink2 }]}>{label}</Text>}
  </View>
}

function Routes({ label, kind, values, choices, setValues, choose, busy }: {
  label: string; kind: BackupKind; values: string[]; choices: Choice[];
  setValues: (values: string[]) => void; choose: (kind: BackupKind) => void; busy: boolean;
}) {
  const { p } = useTheme()
  const move = (index: number, offset: number) => {
    const next = [...values]
    const other = index + offset
    ;[next[index], next[other]] = [next[other], next[index]]
    setValues(next)
  }
  return <View style={styles.group}>
    <Text style={[typeScale.settingsRow, { color: p.ink }]}>{label}</Text>
    {values.map((id, index) => (
      <View key={id} style={styles.route}>
        <Text style={[typeScale.small, { color: p.ink, flex: 1 }]} numberOfLines={2}>{index + 1}. {choices.find(choice => choice.id === id)?.name ?? id}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Move up')} disabled={busy || index === 0} onPress={() => move(index, -1)} style={styles.step}>
          <Text style={{ color: busy || index === 0 ? p.ink3 : p.accent }}>↑</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Move down')} disabled={busy || index === values.length - 1} onPress={() => move(index, 1)} style={styles.step}>
          <Text style={{ color: busy || index === values.length - 1 ? p.ink3 : p.accent }}>↓</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Remove')} disabled={busy} onPress={() => setValues(values.filter(value => value !== id))} style={styles.step}>
          <Text style={{ color: p.ink2 }}>×</Text>
        </Pressable>
      </View>
    ))}
    {values.length < 5 && <Action label={t(kind === 'agents' ? 'Add backup Agent' : 'Add backup Bot')} disabled={busy || !choices.some(choice => !values.includes(choice.id))} onPress={() => choose(kind)} />}
  </View>
}

export function BotFailoverEditor({ bot, team, save, close }: {
  bot: Bot; team: TeamState | null; save: (policy: FailoverPolicy | null) => Promise<boolean>; close: () => void;
}) {
  const { p } = useTheme()
  const [draft, setDraft] = useState<FailoverPolicy>(() => bot.failover ? { ...bot.failover, bots: bot.private ? [] : bot.failover.bots } : {
    triggers: Object.keys(reasons) as FailoverTrigger[], agents: [], bots: [], timeoutSeconds: null,
  })
  const [timeout, setTimeoutText] = useState(String(bot.failover?.timeoutSeconds ?? ''))
  const [picker, setPicker] = useState<BackupKind | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const primary = bot.model ?? bot.appliedModel
  const choices: Record<BackupKind, Choice[]> = {
    agents: (team?.models ?? []).filter(model => model.ref && model.ref !== primary &&
      !model.ref.startsWith('local-sandbox-') && !model.ref.startsWith('ag-ui-'))
      .map(model => ({ id: model.ref, name: [model.providerName ?? model.provider, model.name ?? model.id].filter(Boolean).join(' · ') })),
    bots: (team?.bots ?? []).filter(candidate => candidate.id !== bot.id && !candidate.private && !candidate.accountProfileId &&
      !(candidate.model ?? candidate.appliedModel)?.startsWith('ag-ui-')).map(candidate => ({ id: candidate.id, name: candidate.name })),
  }
  const choose = (kind: BackupKind) => { setSearch(''); setPicker(kind) }
  const setValues = (kind: BackupKind, values: string[]) => setDraft(current => ({ ...current, [kind]: values }))
  const hasTimeout = draft.triggers.includes('timeout')
  const seconds = hasTimeout && timeout !== '' ? Number(timeout) : null
  const valid = draft.triggers.length > 0 && draft.agents.length + draft.bots.length > 0 &&
    (seconds === null || (Number.isInteger(seconds) && seconds > 0 && seconds <= 600))
  const submit = async (policy: FailoverPolicy | null) => {
    setBusy(true)
    try { if (await save(policy)) close() } finally { setBusy(false) }
  }
  const label = { agents: t('Backup Agents in order'), bots: t('Backup Bots in order') }
  return <View style={styles.editor}>
    <Text style={[typeScale.settingsRow, { color: p.ink }]}>{t('Failover triggers')}</Text>
    {(Object.keys(reasons) as FailoverTrigger[]).map(kind => (
      <View key={kind} style={styles.route}>
        <Text style={[typeScale.small, { color: p.ink, flex: 1 }]}>{t(reasons[kind])}</Text>
        <Switch accessibilityLabel={t(reasons[kind])} disabled={busy} value={draft.triggers.includes(kind)} onValueChange={on =>
          setDraft(current => ({ ...current, triggers: on ? [...current.triggers, kind] : current.triggers.filter(value => value !== kind) }))} />
      </View>
    ))}
    {hasTimeout && <View style={styles.route}>
      <Text style={[typeScale.small, { color: p.ink, flex: 1 }]}>{t('Agent deadline in seconds')}</Text>
      <TextInput accessibilityLabel={t('Agent deadline in seconds')} keyboardType="number-pad" maxLength={3} value={timeout} onChangeText={setTimeoutText}
        editable={!busy} placeholder="—" placeholderTextColor={p.ink3} style={[styles.field, typeScale.small, { color: p.ink, borderColor: p.line }]} />
    </View>}
    <Routes label={label.agents} kind="agents" values={draft.agents} choices={choices.agents} setValues={values => setValues('agents', values)} choose={choose} busy={busy} />
    {!bot.private && <Routes label={label.bots} kind="bots" values={draft.bots} choices={choices.bots} setValues={values => setValues('bots', values)} choose={choose} busy={busy} />}
    <Text style={[typeScale.small, { color: p.ink3 }]}>{t('Agents keep the current conversation. A backup Bot receives the task in its own conversation, or in the same group chat. Handoffs require matching permissions and a turn with no tools or reply yet.')}</Text>
    <View style={styles.actions}>
      {bot.failover && <Action label={t('Disable failover')} disabled={busy} onPress={() => void submit(null)} />}
      <Action label={t('Cancel')} disabled={busy} onPress={close} />
      <Action label={t('Save')} disabled={busy || !valid} onPress={() => void submit({ ...draft, timeoutSeconds: seconds })} />
    </View>
    {picker && <Modal visible transparent animationType="fade" onRequestClose={() => setPicker(null)}>
      <View style={styles.backdrop}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={() => setPicker(null)} />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: p.card }]}>
          <View style={styles.route}>
            <Text style={[typeScale.settingsRow, { color: p.ink, flex: 1 }]}>{label[picker]}</Text>
            <Action label={t('Close')} onPress={() => setPicker(null)} />
          </View>
          <TextInput accessibilityLabel={t('Search')} value={search} onChangeText={setSearch} placeholder={t('Search')}
            placeholderTextColor={p.ink3} style={[styles.field, typeScale.small, { color: p.ink, borderColor: p.line }]} />
          <ScrollView keyboardShouldPersistTaps="handled">
            {choices[picker].filter(choice => !draft[picker].includes(choice.id) && choice.name.toLowerCase().includes(search.toLowerCase())).map(choice => (
              <Pressable key={choice.id} accessibilityRole="button" style={styles.item} onPress={() => {
                setValues(picker, [...draft[picker], choice.id]); setPicker(null)
              }}>
                <Text style={[typeScale.settingsRow, { color: p.ink }]}>{choice.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>}
  </View>
}

const styles = StyleSheet.create({
  activity: { marginHorizontal: 14, marginVertical: 3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  editor: { padding: 12, gap: 8 },
  group: { gap: 4, paddingTop: 6 },
  route: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  action: { alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 6 },
  step: { width: 40, height: 42, alignItems: 'center', justifyContent: 'center' },
  field: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, minWidth: 60, minHeight: 42, paddingHorizontal: 8 },
  backdrop: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: '#0007' },
  sheet: { borderRadius: 16, padding: 14, gap: 8, maxHeight: '70%' },
  item: { minHeight: 44, justifyContent: 'center', paddingVertical: 8 },
})
