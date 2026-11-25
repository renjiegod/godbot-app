import { useCallback, useEffect, useRef, useState } from 'react'
import { useIsFocused } from '@react-navigation/native'
import * as Crypto from 'expo-crypto'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { openChat } from '../nav/open-chat.ts'
import { confirmDanger } from '../nav/sheet.tsx'
import {
  legacyAutomationView, type AutomationHistory, type AutomationInput, type AutomationItem,
  type AutomationKind, type AutomationTarget, type AutomationTiming, type AutomationTrigger, type AutomationView, type ScheduleKind,
} from '../team/automation.ts'
import { DEMO, useTeam } from '../team/context.tsx'
import { t, timeLabel, weekdayShort } from '../ui/i18n.ts'
import { ChevronRightIcon } from '../ui/icons.tsx'
import { type as typeScale, useTheme } from '../ui/tokens.ts'
import { BackRow, Row, Screen, Section } from './manage.tsx'

const targetLabels = { message: 'Conversation message', task: 'Bot assignment', workflow: 'Workflow' }
const filterLabels = { all: 'All', message: 'Chat messages', task: 'Assignments', workflow: 'Workflows' }
const timingLabels = { once: 'Once', daily: 'Every day', weekly: 'Every week', interval: 'Repeat', cron: 'Cron', rrule: 'Calendar rule (RRULE)' }
const triggerLabels = { schedule: 'On a schedule', webhook: 'Webhook', github: 'GitHub public repository event' }
const statusLabels = { active: 'Active', scheduled: 'Active', overdue: 'Overdue', paused: 'Paused', finished: 'Finished' }
const runLabels: Record<string, string> = {
  delivered: 'Delivered', running: 'Running', completed: 'Accepted', needs_input: 'Needs input',
  failed: 'Failed', unknown: 'Unverified', skipped: 'Skipped', stopped: 'Team stopped',
}
const days = [1, 2, 3, 4, 5, 6, 7]
const units = { '1': 'minutes', '60': 'hours', '1440': 'days' }
const scopeOf = (item: AutomationItem) => ({ source: item.source, id: item.id, sessionId: item.sessionId, updatedAt: item.updatedAt, revision: item.revision })
const keyOf = (item: AutomationItem) => item.source + '/' + item.id
const stamp = (time: number | string) => timeLabel(new Date(time).getTime())
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

function triggerText(trigger: AutomationTrigger): string {
  if (trigger.kind === 'webhook') return 'Webhook'
  if (trigger.kind === 'github') return [trigger.repo, trigger.eventType].filter(Boolean).join(' · ')
  const when = trigger.when
  if (!when) return t('Custom schedule')
  if (when.kind === 'once') return when.at == null ? t('Once') : t('Once, {time}', { time: stamp(when.at) })
  if (when.kind === 'interval') {
    if (when.seconds && when.seconds % 60) return t('Every {count} seconds', { count: when.seconds })
    const minutes = when.minutes ?? 0
    if (minutes > 0 && minutes % 1440 === 0) return t('Every {count} days', { count: minutes / 1440 })
    if (minutes > 0 && minutes % 60 === 0) return t('Every {count} hours', { count: minutes / 60 })
    return t('Every {count} minutes', { count: minutes })
  }
  if (when.kind === 'rrule') return t('Calendar rule (RRULE)')
  const time = (when.time ?? '').replace(/^(\d\d:\d\d):00(?:\.000)?$/, '$1').replace(/\.000$/, '')
  const text = when.kind === 'cron' ? t('On the schedule {expression}', { expression: when.expression ?? '' })
    : when.kind === 'weekly' ? t('Every {days} at {time}', { days: scheduledWeekdays(when.weekdays ?? []), time })
    : t('Every day at {time}', { time })
  return [text, when.timeZone].filter(Boolean).join(' · ')
}

function scheduledWeekdays(values: number[]) {
  const labels = values.map(weekdayShort)
  const chinese = labels.some(day => /^[一二三四五六日]$/.test(day))
  return chinese ? labels.map(day => '周' + day).join('、') : labels.join(', ')
}

function localDate(value: number | string) {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19)
}

function Action({ label, onPress, primary = false, disabled = false, selected }: {
  label: string; onPress: () => void; primary?: boolean; disabled?: boolean; selected?: boolean
}) {
  const { p } = useTheme()
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }} onPress={onPress} disabled={disabled}
    style={({ pressed }) => [styles.button, {
      backgroundColor: primary ? p.accent : pressed || selected ? p.hover : p.card,
      borderColor: primary ? p.accent : p.line, opacity: disabled ? 0.5 : 1,
    }]}>
    <Text style={[typeScale.small, { color: primary ? p.accentInk : p.ink, fontWeight: primary || selected ? '600' : '400' }]}>{label}</Text>
  </Pressable>
}

function Choices({ label, options, value, onPick }: {
  label?: string; options: [string, string][]; value: string; onPick: (id: string) => void
}) {
  const { p } = useTheme()
  return <View style={styles.field}>
    {label ? <Text style={[typeScale.caption, { color: p.ink2 }]}>{t(label)}</Text> : null}
    <View style={styles.actions}>{options.map(([id, name]) =>
      <Action key={id} label={name} selected={value === id} onPress={() => onPick(id)} />)}</View>
  </View>
}

function Field({ label, value, onChange, placeholder, multiline = false, number = false }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean; number?: boolean
}) {
  const { p } = useTheme()
  return <View style={styles.field}>
    <Text style={[typeScale.caption, { color: p.ink2 }]}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={p.ink3}
      multiline={multiline} keyboardType={number ? 'number-pad' : 'default'} autoCapitalize="none"
      style={[typeScale.settingsRow, styles.input, { color: p.ink, borderColor: p.line, backgroundColor: p.main,
        minHeight: multiline ? 80 : 42, textAlignVertical: multiline ? 'top' : 'center' }]} />
  </View>
}

type Choice = { id: string; name: string; revision?: number; room?: boolean }

function Editor({ item, initialKind, initialTarget, view, bots, rooms, full, busy, onSave, onCancel }: {
  item?: AutomationItem; initialKind: AutomationKind; initialTarget: string; view: AutomationView; bots: Choice[];
  rooms: Choice[]; full: boolean; busy: boolean; onSave: (fields: AutomationInput) => void; onCancel: () => void
}) {
  const { p } = useTheme()
  const original = item?.trigger.kind === 'schedule' ? item.trigger.when : undefined
  const [type, setType] = useState(item?.target.kind ?? initialKind)
  const [targetId, setTarget] = useState(item?.target.id ?? initialTarget)
  const [revision, setRevision] = useState(item?.target.revision)
  const [choosing, setChoosing] = useState(false)
  const [title, setTitle] = useState(item?.title ?? '')
  const [instructions, setInstructions] = useState(item?.instructions ?? '')
  const [trigger, setTrigger] = useState<AutomationTrigger['kind']>('schedule')
  const [kind, setKind] = useState<ScheduleKind>(original?.kind ?? 'daily')
  const [replace, setReplace] = useState(!item)
  const [when, setWhen] = useState(() => {
    const at = localDate(original?.at ?? Date.now() + 3600000)
    const minutes = Number.isInteger(original?.minutes) ? Number(original?.minutes) : 60
    const unit = [1440, 60, 1].find(scale => minutes % scale === 0) ?? 1
    return {
      date: at.slice(0, 10), at: at.slice(11), count: String(minutes / unit), unit: String(unit),
      time: original?.time?.split('.')[0] ?? '09:00', zone: original?.timeZone ?? localZone(), days: original?.weekdays ?? [1, 2, 3, 4, 5],
      expression: original?.expression ?? '', rule: original?.rrule ?? '',
    }
  })
  const [repo, setRepo] = useState('')
  const [event, setEvent] = useState('')
  const [includeLatest, setIncludeLatest] = useState(false)
  const [checkOnly, setCheckOnly] = useState(false)
  const [problem, setProblem] = useState('')
  const choices: Choice[] = type === 'workflow' ? view.workflows : type === 'task' ? bots : [...bots, ...rooms]
  const pinned = item?.target.kind === 'workflow' && item.target.id === targetId ? item.target : undefined
  const target = choices.find(choice => choice.id === targetId) ?? pinned
  const versions = [...new Set([target?.revision, pinned?.revision].filter((value): value is number => value !== undefined))]
  const targetName = (choice: Choice | AutomationTarget) => 'room' in choice && choice.room ? t('Group · {name}', { name: choice.name }) : choice.name ?? choice.id
  const scheduleKinds = Object.entries(timingLabels).filter(([key]) => full && type === 'message' || !['cron', 'rrule'].includes(key))
  const actionKinds = Object.entries(targetLabels).filter(([key]) =>
    !full || item?.source === 'message' ? key === 'message' : item?.source === 'routine' ? key !== 'message' : true)
  const canSet = type !== 'message' || view.available
  const changeWhen = <K extends keyof typeof when>(key: K, value: (typeof when)[K]) => setWhen(old => ({ ...old, [key]: value }))

  function submit() {
    if (!target || !canSet || busy || (type === 'workflow' && !(revision ?? target.revision))) return
    if (!title.trim() || (type !== 'workflow' && !instructions.trim())) {
      setProblem(t('Enter a name and the instructions.'))
      return
    }
    let timing: AutomationTiming | undefined
    if (trigger === 'schedule' && replace) {
      timing = { kind }
      if (kind === 'once') {
        const value = when.date + 'T' + when.at
        const date = new Date(value)
        if (!Number.isFinite(date.getTime()) || localDate(date.getTime()).slice(0, value.length) !== value) {
          setProblem(t('Pick a valid date and time.'))
          return
        }
        timing.at = date.toISOString()
      } else if (kind === 'interval') {
        const minutes = Number(when.count) * Number(when.unit)
        if (!Number.isSafeInteger(minutes) || minutes <= 0) {
          setProblem(t('Enter a positive interval.'))
          return
        }
        timing.minutes = minutes
      } else if (kind === 'rrule') timing.rrule = when.rule.trim()
      else {
        timing.timeZone = when.zone.trim()
        if (kind === 'cron') timing.expression = when.expression.trim()
        else timing.time = when.time.trim()
        if (kind === 'weekly') {
          if (!when.days.length) { setProblem(t('Pick at least one day.')); return }
          timing.weekdays = when.days
        }
      }
    }
    const input: AutomationInput = {
      title: title.trim(), instructions: type === 'workflow' ? undefined : instructions.trim(),
      target: { kind: type, id: target.id, ...(type === 'workflow' ? { revision: revision ?? target.revision } : {}) },
    }
    setProblem('')
    if (item) {
      if (type === 'message' && target.id === item.target.id) delete input.target
      onSave({ ...input, when: timing })
    } else {
      const rule: AutomationTrigger = trigger === 'schedule' ? { kind: trigger, when: timing }
        : trigger === 'github' ? { kind: trigger, repo: repo.trim(), eventType: event.trim(), includeLatest } : { kind: trigger }
      onSave({ ...input, trigger: rule, checkOnly })
    }
  }

  return <>
    <Section label={t(item ? 'Edit automation' : 'New automation')}>
      <Field label={t('Automation name')} value={title} onChange={setTitle} />
      {actionKinds.length > 1 ? <Choices label="Action" options={actionKinds.map(([id, name]) => [id, t(name)])} value={type}
        onPick={id => {
          if (id === type) return
          setType(id as AutomationKind); setTarget(''); setRevision(undefined); setChoosing(false)
          if (id === 'message') setTrigger('schedule')
          else if (kind === 'cron' || kind === 'rrule') setKind('daily')
        }} /> : null}
      <Row label={t('Target')} value={target ? targetName(target) : t('Choose a target')} onPress={() => setChoosing(!choosing)} />
      {choosing ? [...choices, ...(pinned && !choices.some(choice => choice.id === pinned.id) ? [pinned] : [])].map(choice =>
        <Row key={choice.id} label={targetName(choice)} onPress={() => {
          setTarget(choice.id); setRevision(choice.revision); setChoosing(false)
        }} />) : null}
      {type === 'workflow' && versions.length ? <Choices label="Pinned revision" value={String(revision ?? target?.revision)}
        onPick={id => setRevision(Number(id))} options={versions.map(version => [String(version), 'v' + version])} /> : null}
      {type !== 'workflow' ? <Field label={t(type === 'message' ? 'Message or instructions' : 'Instructions and acceptance criteria')}
        value={instructions} onChange={setInstructions} multiline /> : null}
      {full && !item && type !== 'message' ? <Choices label="Trigger" options={Object.entries(triggerLabels).map(([id, label]) => [id, t(label)])}
        value={trigger} onPick={id => setTrigger(id as AutomationTrigger['kind'])} /> : null}
      {item ? <Row label={t('Change schedule')} value={t(replace ? 'On' : 'Off')} onPress={() => setReplace(!replace)} /> : null}
      {trigger === 'schedule' && replace ? <Choices label="Frequency" options={scheduleKinds.map(([id, label]) => [id, t(label)])}
        value={kind} onPick={id => setKind(id as ScheduleKind)} /> : null}
      {trigger === 'schedule' && replace && kind === 'once' ? <View style={styles.timing}>
        <Field label={t('Date')} placeholder="YYYY-MM-DD" value={when.date} onChange={value => changeWhen('date', value)} />
        <Field label={t('Run at ({zone})', { zone: localZone() })} placeholder="09:00" value={when.at} onChange={value => changeWhen('at', value)} />
      </View> : null}
      {trigger === 'schedule' && replace && kind === 'interval' ? <View>
        <Field label={t('Interval')} value={when.count} onChange={value => changeWhen('count', value)} number />
        <Choices label="Unit" options={Object.entries(units).map(([id, label]) => [id, t(label)])}
          value={when.unit} onPick={value => changeWhen('unit', value)} />
      </View> : null}
      {trigger === 'schedule' && replace && kind === 'weekly' ? <View style={styles.field}>
        <Text style={[typeScale.caption, { color: p.ink2 }]}>{t('Days of the week')}</Text>
        <View style={styles.actions}>{days.map(day => <Action key={day} label={weekdayShort(day)} selected={when.days.includes(day)}
          onPress={() => changeWhen('days', when.days.includes(day) ? when.days.filter(d => d !== day) : [...when.days, day].sort())} />)}</View>
      </View> : null}
      {trigger === 'schedule' && replace && ['weekly', 'daily', 'cron'].includes(kind) ? <View>
        {kind === 'cron' ? <Field label={t('Cron expression')} placeholder="0 9 * * 1-5" value={when.expression} onChange={value => changeWhen('expression', value)} />
          : <Field label={t('Time')} placeholder="09:00" value={when.time} onChange={value => changeWhen('time', value)} />}
        <Field label={t('Time zone')} value={when.zone} onChange={value => changeWhen('zone', value)} />
      </View> : null}
      {trigger === 'schedule' && replace && kind === 'rrule' ? <Field label={t('Calendar rule (RRULE)')}
        value={when.rule} onChange={value => changeWhen('rule', value)} multiline /> : null}
      {trigger === 'github' ? <View>
        <Field label={t('Repository')} placeholder="owner/repository" value={repo} onChange={setRepo} />
        <Field label={t('Event type')} placeholder="IssuesEvent" value={event} onChange={setEvent} />
        <Row label={t('Process the latest matching event')} value={t(includeLatest ? 'On' : 'Off')} onPress={() => setIncludeLatest(!includeLatest)} />
      </View> : null}
      {trigger === 'webhook' ? <Row label={t('Save the URL and signing secret shown after creation.')} /> : null}
      {full && !item ? <Choices label="Execution policy" value={checkOnly ? 'check' : 'normal'} onPick={id => setCheckOnly(id === 'check')}
        options={ [['normal', t('Use Bot and workspace policy')], ['check', t('Check and report only')]] } /> : null}
    </Section>
    {problem ? <Text accessibilityRole="alert" style={[typeScale.small, styles.message, { color: p.danger }]}>{problem}</Text> : null}
    {!canSet ? <Text style={[typeScale.small, styles.message, { color: p.ink2 }]}>{t('Switch on Automation tasks on the Plugins page in Settings.')}</Text> : null}
    <View style={[styles.actions, styles.message]}>
      <Action label={t('Cancel')} disabled={busy} onPress={onCancel} />
      <Action label={t(busy ? 'Saving…' : item ? 'Save changes' : 'Create automation')} disabled={busy || !target || !canSet} primary onPress={submit} />
    </View>
  </>
}

function History({ item, open }: { item: AutomationItem; open: (item: AutomationItem, sessionId?: string) => void }) {
  const { call } = useTeam()
  const { p } = useTheme()
  const [data, setData] = useState<AutomationHistory | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const seq = useRef(0)
  const { source, id, sessionId } = item
  const read = useCallback(async (before?: string) => {
    const token = ++seq.current
    setBusy(true)
    setError('')
    try {
      const result = await call('automation-history', { source, id, sessionId, before }) as AutomationHistory
      if (token === seq.current) setData(old => before && old ? { ...result, items: [...old.items, ...result.items] } : result)
    } catch (failure) {
      if (token === seq.current) setError((failure as Error).message)
    } finally {
      if (token === seq.current) setBusy(false)
    }
  }, [call, source, id, sessionId])
  useEffect(() => { void read(); return () => { seq.current++ } }, [read])
  return <View style={[styles.detail, { borderTopColor: p.line }]}>
    <View style={styles.actions}>
      <Text style={[typeScale.small, { color: p.ink, fontWeight: '600' }]}>{t('Run history')}</Text>
      <Action label={t('Refresh')} disabled={busy} onPress={() => void read()} />
    </View>
    {error ? <Text accessibilityRole="alert" style={{ color: p.danger }}>{error}</Text> : null}
    {!data && busy ? <Text style={{ color: p.ink2 }}>{t('Loading…')}</Text> : null}
    {data?.items.length === 0 ? <Text style={{ color: p.ink2 }}>{t('No runs yet.')}</Text> : null}
    {data?.items.map(record => <View key={record.id} style={styles.record}>
      <Text style={[typeScale.small, { color: p.ink }]}>
        {[stamp(record.at), record.trigger && t(record.trigger === 'manual' ? 'Manual run' : 'Scheduled run'), t(runLabels[record.state] ?? record.state),
          record.workflowRevision && 'v' + record.workflowRevision].filter(Boolean).join(' · ')}
      </Text>
      {record.prompt || record.reason ? <Text style={[typeScale.small, { color: p.ink2 }]}>{record.prompt ?? record.reason}</Text> : null}
      {record.nodes?.map(node => <Text key={node.nodeId} style={[typeScale.small, { color: p.ink2 }]}>{node.title + ' · ' + node.status}</Text>)}
      {record.sessionId ? <Action label={t('Open conversation')} onPress={() => open(item, record.sessionId)} /> : null}
    </View>)}
    {data?.nextBefore ? <Action label={t('Older runs')} disabled={busy} onPress={() => void read(data.nextBefore)} /> : null}
    {data && !data.nextBefore && data.earlierRecordsUnavailable ? <Text style={{ color: p.ink2 }}>
      {t(data.earlierRecordsPruned ? 'Older runs expired.' : 'The host has no older delivery records.')}
    </Text> : null}
  </View>
}

export function Automation({ route, navigation }: any) {
  const { p } = useTheme()
  const insets = useSafeAreaInsets()
  const { team, online, call, hello, computer } = useTeam()
  const scope = (computer?.hostDeviceId ?? '') + '/' + (hello?.boot ?? '')
  const focused = useIsFocused()
  const full = hello?.capabilities.includes('unified-automation') === true
  const initialTarget = String(route.params?.botId ?? route.params?.roomId ?? '')
  const [targetFilter, setTargetFilter] = useState(initialTarget)
  const [filter, setFilter] = useState<AutomationKind | 'all'>('all')
  const [snapshot, setSnapshot] = useState<{ scope: string; data: AutomationView } | null>(null)
  const view = snapshot?.scope === scope ? snapshot.data : null
  const [expanded, setExpanded] = useState('')
  const [history, setHistory] = useState('')
  const [runVersion, setRunVersion] = useState(0)
  const [editor, setEditor] = useState<{ item?: AutomationItem } | null>(null)
  const [issued, setIssued] = useState<{ url: string; secret: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const attempt = useRef<{ signature: string; id: string } | null>(null)
  const seq = useRef(0)
  const read = useCallback(async () => {
    const token = ++seq.current
    try {
      const response = full ? await call('automation-view') as AutomationView
        : legacyAutomationView(await call('schedules') as Parameters<typeof legacyAutomationView>[0])
      if (seq.current === token) {
        setSnapshot({ scope, data: response })
        setLoadError('')
      }
    } catch (failure) {
      if (seq.current === token) setLoadError((failure as Error).message)
    }
  }, [call, full, scope])
  useEffect(() => {
    if (!focused || !online) return
    let live = true
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      if (!pending.current) await read()
      if (live) timer = setTimeout(poll, 7000)
    }
    void poll()
    return () => { live = false; seq.current++; clearTimeout(timer) }
  }, [focused, online, read])

  const bots = team?.bots ?? []
  const rooms = (team?.rooms ?? []).map(room => ({ ...room, room: true }))
  const targets = [...bots, ...rooms]
  const names = new Map(targets.map(target => [target.id, target.name]))
  const writable = online && !team?.readOnly
  const rows = view?.items.filter(item => (filter === 'all' || item.target.kind === filter) && (!targetFilter || item.target.id === targetFilter))
    .sort((a, b) => (a.nextAt == null ? Infinity : new Date(a.nextAt).getTime()) -
      (b.nextAt == null ? Infinity : new Date(b.nextAt).getTime()) || a.title.localeCompare(b.title)) ?? []
  function goToChat(item: AutomationItem, sessionId?: string) {
    const target = targets.find(row => row.id === item.target.id)
    if (!target) return
    const kind = 'room' in target ? 'room' : 'bot'
    const readOnlyPart = kind === 'bot' && sessionId && sessionId !== target.sessionId ? sessionId : undefined
    openChat(navigation, { kind, id: target.id, readOnlyPart })
  }
  async function mutate(operation: string, item?: AutomationItem, fields?: AutomationInput) {
    if (!writable || pending.current) return
    pending.current = true
    seq.current++
    setBusy(true)
    setError('')
    setNotice('')
    const body = item ? { ...scopeOf(item), operation, ...fields } : fields
    const signature = JSON.stringify([scope, operation, body])
    if (attempt.current?.signature !== signature) attempt.current = { signature, id: Crypto.randomUUID() }
    try {
      const result = full
        ? await call(operation === 'create' ? 'automation-create' : 'automation-change', { ...body, requestId: attempt.current.id })
        : operation === 'delete' ? await call('schedule-delete', { id: item?.id, sessionId: item?.sessionId })
        : await call('schedule-create', {
          title: fields?.title, prompt: fields?.instructions, target: fields?.target?.id,
          when: fields?.trigger?.kind === 'schedule' ? {
            ...fields.trigger.when,
            kind: fields.trigger.when?.kind === 'once' ? 'at' : fields.trigger.when?.kind === 'interval' ? 'every' : fields.trigger.when?.kind,
          } : undefined,
        })
      attempt.current = null
      if (operation === 'create' || operation === 'update') {
        setEditor(null)
        setFilter('all')
        if (targetFilter && fields?.target && fields.target.id !== targetFilter) setTargetFilter('')
      }
      if (operation === 'run' && item) { setHistory(keyOf(item)); setRunVersion(version => version + 1) }
      const created = result as { id?: string; mode?: string; url?: string; secret?: string }
      if (created?.url && created.secret) setIssued({ url: created.url, secret: created.secret })
      setNotice(t(({ create: 'Automation created', update: 'Changes saved', run: 'Run requested', delete: 'Automation deleted',
        pause: 'Automation paused', resume: 'Automation resumed', poll: 'Events checked' } as Record<string, string>)[operation]))
    } catch (failure) {
      if ((failure as { code?: string }).code !== 'unlock/canceled') setError((failure as Error).message)
    } finally {
      await read()
      pending.current = false
      setBusy(false)
    }
  }
  function edit(draft: { item?: AutomationItem } | null) {
    setError('')
    setNotice('')
    setEditor(draft)
  }

  return <Screen title="">
    <BackRow title={t('Automation')} onBack={() => navigation.goBack()} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
      {error || loadError ? <View style={[styles.actions, styles.message]}>
        <Text accessibilityRole="alert" style={[typeScale.small, { color: p.danger }]}>{error || loadError}</Text>
        {loadError ? <Action label={t('Retry')} onPress={() => void read()} /> : null}
      </View> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={[typeScale.small, styles.message, { color: p.ink2 }]}>{notice}</Text> : null}
      {issued ? <Section label="Webhook">
        <Row label={t('Save the Webhook signing secret now.')} />
        <Text selectable style={[typeScale.small, styles.message, { color: p.ink }]}>{issued.url}</Text>
        <Text selectable style={[typeScale.small, styles.message, { color: p.ink }]}>{issued.secret}</Text>
        <Row label={t('Done')} onPress={() => setIssued(null)} />
      </Section> : null}
      {view && editor ? <Editor key={editor.item?.id ?? 'new'} view={view} item={editor.item} initialTarget={targetFilter || team?.mainBotId || ''}
        initialKind={filter !== 'all' ? filter : view.available || !full ? 'message' : 'task'} bots={bots} rooms={rooms}
        full={full} busy={busy || !writable} onSave={fields => void mutate(editor.item ? 'update' : 'create', editor.item, fields)} onCancel={() => edit(null)} />
        : <>
          {view && writable && (full || view.available) ? <View style={[styles.actions, styles.message]}>
            <Action label={t('New automation')} primary onPress={() => edit({})} />
          </View> : null}
          {view && full ? <View style={[styles.actions, styles.message]}>
            {Object.entries(filterLabels).map(([id, label]) =>
              <Action key={id} label={t(label)} selected={id === filter} onPress={() => setFilter(id as typeof filter)} />)}
          </View> : null}
          {targetFilter ? <View style={[styles.actions, styles.message]}>
            <Text style={[typeScale.small, { color: p.ink2 }]}>{names.get(targetFilter) ?? targetFilter}</Text>
            <Action label={t('Clear target filter')} onPress={() => setTargetFilter('')} />
          </View> : null}
          {view && !full && !DEMO ? <Text style={[typeScale.small, styles.message, { color: p.ink2 }]}>
            {t('Update Godbot on the computer to use Bot assignments and workflows.')}
          </Text> : null}
          {view?.available === false && (filter === 'all' || filter === 'message') ? <Text style={[typeScale.small, styles.message, { color: p.ink2 }]}>
            {t('Switch on Automation tasks on the Plugins page in Settings.')}
          </Text> : null}
          <Section>
            {view === null && !loadError ? <Row label={t(online ? 'Loading…' : 'Offline')} /> : null}
            {view && rows.length === 0 ? <Row label={t(filter === 'all' && !targetFilter ? 'No automations yet.' : 'No matching automations.')} /> : null}
            {rows.map(item => {
              const key = keyOf(item)
              const shown = key === expanded
              const target = item.target
              const name = target.kind === 'workflow' ? (target.name ?? view?.workflows.find(flow => flow.id === target.id)?.name ?? target.id) + ' · v' + target.revision
                : names.get(target.id) ?? target.id
              const canRun = !item.executionActive && !(Date.parse(item.deliveryFloorEndsAt ?? '') > Date.now())
              const scheduled = item.trigger.kind === 'schedule'
              const paused = item.status === 'paused'
              return <View key={key}>
                <Pressable accessibilityRole="button" accessibilityLabel={item.title} accessibilityState={{ expanded: shown }}
                  onPress={() => setExpanded(shown ? '' : key)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: p.hover }]}>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <Text style={[typeScale.settingsRow, { color: p.ink, fontWeight: '600' }]}>{item.title}</Text>
                    <Text style={[typeScale.small, { color: p.ink2 }]}>{[t(targetLabels[target.kind]), name, triggerText(item.trigger)].join(' · ')}</Text>
                    <Text style={[typeScale.small, { color: item.status === 'overdue' ? p.danger : p.ink2 }]}>
                      {[t(statusLabels[item.status]), item.nextAt != null && t('Next: {time}', { time: stamp(item.nextAt) })].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <ChevronRightIcon size={16} />
                </Pressable>
                {shown ? <View style={[styles.detail, { borderTopColor: p.line }]}>
                  {item.instructions ? <Text style={[typeScale.settingsRow, { color: p.ink }]}>{item.instructions}</Text> : null}
                  {item.trigger.kind === 'webhook' && item.trigger.url ? <Text selectable style={{ color: p.ink2 }}>{item.trigger.url}</Text> : null}
                  {item.issue ? <Text style={{ color: p.danger }}>{item.issue}</Text> : null}
                  {item.lastChecked ? <Text style={{ color: p.ink2 }}>{t('Last checked {time}', { time: stamp(item.lastChecked) })}</Text> : null}
                  {item.checkOnly ? <Text style={{ color: p.ink2 }}>{t('Check and report only')}</Text> : null}
                  <View style={styles.actions}>
                    {writable && full && scheduled ? <Action label={t('Edit')} disabled={busy} onPress={() => edit({ item })} /> : null}
                    {writable && full && scheduled ? <Action label={t('Run now')} disabled={busy || !canRun} onPress={() => void mutate('run', item)} /> : null}
                    {writable && full && item.source === 'github' ? <Action label={t('Check events')} disabled={busy || paused} onPress={() => void mutate('poll', item)} /> : null}
                    {writable && full && item.status !== 'finished' ? <Action label={t(paused ? 'Resume automation' : 'Pause')} disabled={busy} onPress={() => void mutate(paused ? 'resume' : 'pause', item)} /> : null}
                    {full && scheduled ? <Action label={t('Run history')} selected={history === key} onPress={() => setHistory(history === key ? '' : key)} /> : null}
                    {writable && scheduled ? <Action label={t('Delete')} disabled={busy} onPress={() => confirmDanger(
                      t(item.source === 'message' ? 'Delete this automation and its delivery history?' : 'Delete this automation? Assigned tasks stay on the task board.'),
                      t('Delete'), () => void mutate('delete', item))} /> : null}
                  </View>
                  {full && history === key ? <History key={runVersion} item={item} open={goToChat} /> : null}
                </View> : null}
              </View>
            })}
          </Section>
        </>}
    </ScrollView>
  </Screen>
}

const styles = StyleSheet.create({
  field: { paddingHorizontal: 14, paddingVertical: 10, gap: 5 },
  timing: { flexDirection: 'row', flexWrap: 'wrap' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, gap: 12 },
  detail: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10 },
  record: { gap: 5, alignItems: 'flex-start' },
  input: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 7 },
  button: { borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, minHeight: 36, paddingHorizontal: 10, justifyContent: 'center' },
  message: { marginHorizontal: 18, marginTop: 12 },
})
