// Modified for Godbot. See NOTICE.
// Bot and group management screens, mirroring the desktop details drawer and
// settings forms: Bot details, Edit Bot, Create Bot, group settings, and the
// "new" sheet. Every write goes through the same endpoints the desktop calls.
import { Children, Fragment, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useIsFocused } from '@react-navigation/native'
import { Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { confirmDanger, Sheet, SheetHeader, useInSheet } from '../nav/sheet.tsx'
import { openChat } from '../nav/open-chat.ts'
import * as Crypto from 'expo-crypto'
import { listComputers, removeComputer, type StoredComputer } from '../store.ts'
import { ComputersCtx } from '../nav/computers.ts'
import * as ImagePicker from 'expo-image-picker'
import { DEMO, useTeam } from '../team/context.tsx'
import { memorySummaryText } from '../team/memory.ts'
import { botPrivacyBlock, botSessions, isLocalModel, modelRoute, sessionFigures, sessionUsage, type SessionStats } from '../team/bot-details.ts'
import { connectorRows } from '../team/connectors.ts'
import { folderPlan, type FolderPlan, type FoldersView } from '../team/folders.ts'
import { t, timeLabel, weekdayShort } from '../ui/i18n.ts'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, GearIcon, PlusIcon } from '../ui/icons.tsx'
import { Avatar, COLOR_PAINT, RoomAvatar } from '../ui/marks.tsx'
import { inkColor, radius, shadow, type as typeScale, useTheme, type Palette } from '../ui/tokens.ts'
import type { Bot, Room, TeamState } from '../connection.ts'
import { capabilityStatusText } from '../team/capabilities.ts'
import { modelOf, ModelMenu, ModelPicker } from './model-menu.tsx'

export const SHAPES = ['acorn', 'berry', 'bunny', 'gem', 'gumdrop', 'kitty', 'moon', 'peanut', 'star', 'wave']
export const COLORS = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'magenta', 'gray', 'aurora']

export const pickPhoto = async (): Promise<string | null> => {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8, base64: true })
  const asset = result.canceled ? null : result.assets?.[0]
  if (!asset?.base64) return null
  const mime = asset.mimeType ?? 'image/jpeg'
  return `data:${mime};base64,${asset.base64}`
}

const botOf = (team: TeamState | null, id: string) => team?.bots?.find(b => b.id === id)
export const roomOf = (team: TeamState | null, id: string) => team?.rooms?.find(r => r.id === id)
const mainsOf = (team: TeamState | null) => new Set(team?.mainBotIds ?? (team?.mainBotId ? [team.mainBotId] : []))
const isMain = (team: TeamState | null, id: string) => mainsOf(team).has(id)

function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  const { p } = useTheme()
  const insets = useSafeAreaInsets()
  const inSheet = useInSheet()
  return (
    <View style={{ flex: 1, backgroundColor: p.main, paddingTop: inSheet ? 0 : insets.top }}>
      {children}
    </View>
  )
}

export function BackRow({ title, onBack, end }: { title: string; onBack: () => void; end?: React.ReactNode }) {
  const { p } = useTheme()
  return (
    <View style={styles.backRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Back')} onPress={onBack} hitSlop={8} style={styles.backBtn}>
        <ChevronLeftIcon size={20} color={p.ink2} />
      </Pressable>
      <Text style={[typeScale.rowName, { color: p.ink, flex: 1, textAlign: 'center' }]} numberOfLines={1}>{title}</Text>
      <View style={styles.backBtn}>{end}</View>
    </View>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const { p } = useTheme()
  const items = Children.toArray(children).filter(Boolean)
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={[typeScale.caption, { color: p.ink3, paddingHorizontal: 18, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 11 }]}>{label}</Text>
      <View style={[styles.card, { backgroundColor: p.card, borderColor: p.line }]}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={[styles.divider, { backgroundColor: p.line }]} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
    </View>
  )
}

function Row({ label, hint, value, onPress, disabled, end }: { label: string; hint?: string; value?: string; onPress?: () => void; disabled?: boolean; end?: React.ReactNode }) {
  const { p } = useTheme()
  const body = (
    <View style={styles.row}>
      <View style={{ flex: 1, minWidth: 96 }}>
        <Text style={[typeScale.settingsRow, { color: p.ink }]}>{label}</Text>
        {hint ? <Text style={[typeScale.small, { color: p.ink3, marginTop: 2 }]}>{hint}</Text> : null}
      </View>
      {value !== undefined ? <Text style={[typeScale.settingsRow, { color: p.ink2, flexShrink: 1, maxWidth: '54%', textAlign: 'right' }]} numberOfLines={1}>{value}</Text> : null}
      {end}
      {onPress ? <View style={{ flexShrink: 0 }}><ChevronRightIcon size={16} color={p.ink3} /></View> : null}
    </View>
  )
  if (!onPress || disabled) return <View style={disabled ? { opacity: 0.45 } : null}>{body}</View>
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed ? { backgroundColor: p.hover } : null}>{body}</Pressable>
}

function Field({ label, value, placeholder, multiline, maxLength, editable = true, onSave }: {
  label: string; value?: string; placeholder?: string; multiline?: boolean; maxLength?: number; editable?: boolean; onSave: (next: string) => void
}) {
  const { p } = useTheme()
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.settingsRow, { color: p.ink3, fontSize: 13 }]}>{label}</Text>
        <TextInput
          style={[typeScale.settingsRow, { color: p.ink, paddingVertical: 4 }, multiline ? { minHeight: 90, textAlignVertical: 'top' } : null]}
          value={draft ?? value ?? ''}
          placeholder={placeholder}
          placeholderTextColor={p.ink3}
          accessibilityLabel={label}
          editable={editable}
          maxLength={maxLength}
          multiline={multiline}
          onChangeText={setDraft}
          onBlur={() => {
            const next = draft?.trim()
            setDraft(null)
            if (next !== undefined && next !== (value ?? '')) onSave(next)
          }}
        />
      </View>
    </View>
  )
}

function SwitchRow({ label, hint, on, disabled, onChange }: { label: string; hint?: string; on: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  const { p } = useTheme()
  return (
    <View style={[styles.row, disabled ? { opacity: 0.45 } : null]}>
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.settingsRow, { color: p.ink }]}>{label}</Text>
        {hint ? <Text style={[typeScale.small, { color: p.ink3, marginTop: 2 }]}>{hint}</Text> : null}
      </View>
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: on, disabled }} disabled={disabled} onPress={() => onChange(!on)}
        style={[styles.switch, { backgroundColor: on ? p.accent : p.line }]}>
        <View style={[styles.knob, { backgroundColor: p.accentInk, alignSelf: on ? 'flex-end' : 'flex-start' }]} />
      </Pressable>
    </View>
  )
}

// A choice of a few values, all in view: the same control as the phone's own settings.
function Segmented({ options, value, onPick }: { options: { id: string; label: string }[]; value: string; onPick: (id: string) => void }) {
  const { p } = useTheme()
  return (
    <View style={[styles.segRow, { backgroundColor: p.hover }]} accessibilityRole="radiogroup">
      {options.map(option => {
        const on = option.id === value
        return (
          <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onPick(option.id)}
            style={[styles.seg, on && [{ backgroundColor: p.card }, shadow(1)]]}>
            <Text style={[typeScale.small, { color: on ? p.ink : p.ink2, fontWeight: on ? '600' : '400' }]} numberOfLines={1}>{option.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function DangerRow({ label, confirm, busy, onConfirm }: { label: string; confirm: string; busy?: boolean; onConfirm: () => void }) {
  const { p } = useTheme()
  return (
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => confirmDanger(confirm, label, onConfirm)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: p.hover }]}>
      <Text style={[typeScale.settingsRow, { color: p.danger, flex: 1 }]}>{label}</Text>
    </Pressable>
  )
}

type Model = NonNullable<TeamState['models']>[number]

function useWrite(navigation: any) {
  const { call } = useTeam()
  const [error, setError] = useState<string | null>(null)
  const run = async (name: string, body: Record<string, unknown>, done?: (value: unknown) => void) => {
    try { const value = await call(name, body); setError(null); done?.(value); return true }
    catch (failure) {
      const code = (failure as { code?: string })?.code
      if (code !== 'unlock/canceled') setError((failure as Error)?.message ?? String(failure))
      return false
    }
  }
  return { run, error }
}

// Like the desktop, a Bot or group the user just made (or duplicated) opens
// its chat, once the team lists it.
function useOpenWhenListed(navigation: any) {
  const { team } = useTeam()
  const [target, setTarget] = useState<{ kind: 'bot' | 'room'; id: string } | null>(null)
  useEffect(() => {
    if (target === null) return
    const listed = target.kind === 'bot' ? botOf(team, target.id) !== undefined : (team?.rooms ?? []).some(room => room.id === target.id)
    if (!listed) return
    setTarget(null)
    openChat(navigation, target)
  }, [target, team])
  return setTarget
}

// ------------------------------------------------------------ Bot details

export function BotDetails({ route, navigation }: any) {
  const { p, dark } = useTheme()
  const insets = useSafeAreaInsets()
  const { team, online } = useTeam()
  const { run, error } = useWrite(navigation)
  const bot = botOf(team, route.params?.botId ?? '')
  const stats = useDetailStats(bot)
  if (bot === undefined) return <Screen title=""><BackRow title="" onBack={() => navigation.goBack()} /></Screen>
  const permissions = team?.permissions
  const writable = online && !team?.readOnly
  const save = (patch: Record<string, unknown>) => run('update-bot', { id: bot.id, ...patch })
  return (
    <Screen title={bot.name}>
      <View style={[styles.detailTop, { paddingTop: 8 }]}>
        <RoundButton label={t('Back')} onPress={() => navigation.goBack()}><ChevronLeftIcon color={p.ink2} /></RoundButton>
        <View style={{ flex: 1 }} />
        {writable ? <RoundButton label={t('Edit Bot')} onPress={() => navigation.navigate('BotEdit', { botId: bot.id })}><GearIcon size={18} color={p.ink2} /></RoundButton> : null}
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingHorizontal: 18 }}>
          <View style={styles.detailIdentity}>
            <Avatar bot={bot} dark={dark} size={64} ring={p.main} />
            <DetailIdentity bot={bot} writable={writable} save={save} />
          </View>
          <View style={[styles.tabs, { backgroundColor: p.hover }]} accessibilityRole="tablist">
            <View accessibilityRole="tab" accessibilityState={{ selected: true }} style={[styles.tab, { backgroundColor: p.card }]}><Text style={[typeScale.small, { color: p.ink, fontWeight: '500' }]}>{t('Details')}</Text></View>
            <Pressable accessibilityRole="tab" onPress={() => navigation.navigate('BotBrowser', { bot })} style={styles.tab}><Text style={[typeScale.small, { color: p.ink2 }]}>{t('Browser')}</Text></Pressable>
          </View>
          {error ? <Text accessibilityRole="alert" style={[typeScale.small, { color: p.danger, marginTop: 10 }]}>{error}</Text> : null}
          <DetailStats stats={stats} />
          <DetailTitle text={t('Model')} />
          <ModelMenu bot={bot} readOnly={!writable} onManage={() => navigation.navigate('Settings', { screen: 'Providers', initial: false })} />
          <BotSessions key={bot.id} bot={bot} team={team} writable={writable} navigation={navigation} run={run} />
          {permissions?.options && permissions.options.length > 0 ? (
            <>
              <DetailTitle text={t('Permissions')} />
              <PermissionPicker options={permissions.options} saved={bot.permission ?? permissions.defaultPreset} repick={bot.permission === undefined} disabled={!writable} onPick={permission => void save({ permission })} />
            </>
          ) : null}
          <BotConnectors bot={bot} team={team} writable={writable} run={run} />
          <DetailTitle text={t('Working folder')} />
          <BotFolder bot={bot} navigation={navigation} writable={writable} />
          <DetailAbout key={bot.id} bot={bot} writable={writable} onSave={instructions => save({ instructions })} />
          {team?.memory === false ? null : <MemorySummary bot={bot} onOpen={() => navigation.navigate('Memory', { id: bot.id, name: bot.name, group: false })} />}
          <UsageSummary bot={bot} stats={stats} onOpen={() => navigation.navigate('Usage', { botId: bot.id, name: bot.name })} />
          <ScheduleSummary bot={bot} onOpen={() => navigation.navigate('Schedules', { botId: bot.id, name: bot.name, sessionId: bot.sessionId })} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

type ManageWrite = ReturnType<typeof useWrite>['run']

function DetailIdentity({ bot, writable, save }: {
  bot: Bot; writable: boolean; save: (patch: Record<string, unknown>) => Promise<boolean>
}) {
  const { p } = useTheme()
  const [name, setName] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const commitName = async () => {
    const next = name?.trim()
    if (next && next !== bot.name && !await save({ name: next })) return
    setName(null)
  }
  const commitRole = async () => {
    const next = role?.trim()
    if (next !== undefined && next !== (bot.role ?? '') && !await save({ role: next })) return
    setRole(null)
  }
  return (
    <>
      <TextInput
        accessibilityLabel={t('Bot name')} editable={writable} value={name ?? bot.name} onChangeText={setName} onBlur={() => void commitName()}
        style={[typeScale.rowName, styles.identityName, { color: p.ink }]} maxLength={40} selectTextOnFocus autoCorrect={false}
        returnKeyType="done" submitBehavior="blurAndSubmit"
      />
      {writable || bot.role ? (
        <TextInput accessibilityLabel={t('Label')} editable={writable} value={role ?? bot.role ?? ''} onChangeText={setRole} onBlur={() => void commitRole()}
          placeholder={t('Add a label')} placeholderTextColor={p.ink3} style={[typeScale.caption, styles.identityRole, { color: p.ink2 }]}
          maxLength={24} returnKeyType="done" submitBehavior="blurAndSubmit" />
      ) : null}
    </>
  )
}

function DetailAbout({ bot, writable, onSave }: { bot: Bot; writable: boolean; onSave: (instructions: string) => Promise<boolean> }) {
  const { p } = useTheme()
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const saved = bot.instructions ?? ''
  const changed = draft !== null && draft.trim() !== saved
  const commit = async () => {
    if (!changed || saving) return
    setSaving(true)
    if (await onSave(draft.trim())) setDraft(null)
    setSaving(false)
  }
  if (!writable && saved === '') return null
  return (
    <>
      <DetailTitle text={t('About')} />
      <TextInput
        accessibilityLabel={t('Instructions')} editable={writable && !saving} value={draft ?? saved} onChangeText={setDraft}
        placeholder={t('What this Bot is responsible for…')} placeholderTextColor={p.ink3} multiline
        style={[typeScale.small, styles.aboutInput, { color: p.ink, borderColor: p.line, backgroundColor: p.card }]}
      />
      {changed && writable ? (
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={() => void commit()}
          style={[styles.inlineAction, { backgroundColor: p.accent, alignSelf: 'flex-end', marginTop: 8 }]}>
          <Text style={[typeScale.small, { color: p.accentInk }]}>{t('Save')}</Text>
        </Pressable>
      ) : null}
    </>
  )
}

function BotFolder({ bot, navigation, writable }: { bot: Bot; navigation: any; writable: boolean }) {
  const { p } = useTheme()
  const folder = bot.workDir
  const label = folder ? folder.split(/[\\/]/).filter(Boolean).pop() ?? folder : t('Team workspace')
  const fixed = bot.accountProfileId !== undefined
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !writable || fixed }} disabled={!writable || fixed}
        onPress={() => navigation.navigate('Folder', { current: folder, onPick: 'bot', botId: bot.id })}
        style={[styles.dropdown, { backgroundColor: p.card, borderColor: p.line }]}>
        <Text style={[typeScale.settingsRow, { color: p.ink, flex: 1 }]} numberOfLines={1}>{label}</Text>
        {writable && !fixed ? <ChevronRightIcon size={16} color={p.ink3} /> : null}
      </Pressable>
      {fixed ? <Text style={[typeScale.caption, { color: p.ink3, marginTop: 5 }]}>{t('Manage the sandbox account and its working folder in Godbot Web.')}</Text> : null}
    </>
  )
}

function BotSessions({ bot, team, writable, navigation, run }: { bot: Bot; team: TeamState | null; writable: boolean; navigation: any; run: ManageWrite }) {
  const { p } = useTheme()
  const { refresh } = useTeam()
  const [pending, setPending] = useState<'new' | 'open' | null>(null)
  const asked = useRef(false)
  const [startingFrom, setStartingFrom] = useState<string | null>(null)
  const current = bot.sessionId ?? bot.id
  const state = team?.newSessions?.[bot.id]
  const sessions = botSessions(bot, team)
  const opening = state === 'opening' || pending === 'new' || startingFrom !== null
  const startDisabled = !writable || opening || pending !== null || state === 'empty'
  useEffect(() => {
    if (startingFrom !== null && current !== startingFrom) {
      setStartingFrom(null)
      openChat(navigation, { kind: 'bot', id: bot.id })
    }
  }, [startingFrom, current, navigation, bot.id])
  useEffect(() => {
    if (startingFrom === null || startingFrom !== current || state === 'opening') return
    const timer = setTimeout(() => {
      setStartingFrom(null)
      refresh?.()
    }, 20_000)
    return () => clearTimeout(timer)
  }, [startingFrom, current, state, refresh])
  const start = async () => {
    if (startDisabled || asked.current) return
    asked.current = true
    setPending('new')
    await run('bot-new-part', { botId: bot.id }, result => {
      if (result === true) setStartingFrom(current)
    })
    setPending(null)
    asked.current = false
  }
  const open = async (session: typeof sessions[number]) => {
    if (!writable || opening || pending !== null || asked.current || session.current) return
    asked.current = true
    setPending('open')
    await run('bot-open-part', { botId: bot.id, sessionId: session.id }, () => {
      openChat(navigation, { kind: 'bot', id: bot.id, ...(session.running ? { readOnlyPart: session.id } : {}) })
    })
    setPending(null)
    asked.current = false
  }
  return (
    <>
      <DetailTitle text={t('Sessions')} />
      {writable ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('New session')} accessibilityState={{ disabled: startDisabled, busy: opening }}
          accessibilityHint={state === 'empty' ? t('This is already a new session. Send a message to begin.') : undefined}
          disabled={startDisabled} onPress={() => void start()}
          style={[styles.inlineAction, { backgroundColor: p.hover, marginBottom: 8, opacity: startDisabled ? 0.65 : 1 }]}>
          <PlusIcon size={16} color={p.accent} />
          <Text style={[typeScale.small, { color: p.ink }]}>{opening ? t('Starting…') : t('New session')}</Text>
        </Pressable>
      ) : null}
      {sessions.some(session => session.running && !session.current) ? (
        <Text style={[typeScale.caption, { color: p.ink2, marginBottom: 8 }]}>{t('A running session keeps using model calls in the background.')}</Text>
      ) : null}
      <View style={[styles.detailRows, { borderColor: p.line, backgroundColor: p.card }]}>
        {sessions.map((session, index) => {
          const label = session.fresh ? t('New session') : t('Session {number}', { number: session.number })
          const meta = session.running ? t('Running') : session.current ? t('Current') : ''
          const disabled = !writable || session.current || opening || pending !== null
          return (
            <Pressable key={session.id} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={meta || undefined}
              accessibilityState={{ disabled, selected: session.current }} disabled={disabled} onPress={() => void open(session)}
              style={[styles.detailListRow, { backgroundColor: session.current ? p.hover : p.card, borderTopColor: p.line, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth }]}>
              <Text style={[typeScale.small, { color: p.ink, flex: 1 }]} numberOfLines={1}>{label}</Text>
              {meta ? <Text style={[typeScale.caption, { color: session.running ? p.accent : p.ink3 }]}>{meta}</Text> : null}
              {!disabled ? <ChevronRightIcon size={15} color={p.ink3} /> : null}
            </Pressable>
          )
        })}
      </View>
    </>
  )
}

function BotConnectors({ bot, team, writable, run }: { bot: Bot; team: TeamState | null; writable: boolean; run: ManageWrite }) {
  const { p } = useTheme()
  const [pending, setPending] = useState<string | null>(null)
  const data = team?.connectors
  const list = connectorRows(data).filter(connector => connector.state === 'ready')
  const rows = [...list, ...(data?.mail?.accounts?.length ? [{ id: 'mail', name: t('Mailbox'), offFor: data.mail.offFor }] : [])]
  if (rows.length === 0) return null
  return (
    <>
      <DetailTitle text={t('Connectors')} />
      <View style={[styles.detailRows, { borderColor: p.line, backgroundColor: p.card }]}>
        {rows.map((row, index) => {
          const offFor = row.offFor ?? []
          const on = !offFor.includes(bot.id)
          const change = async (activate: boolean) => {
            setPending(row.id)
            await run('connector-set', { id: row.id, offFor: activate ? offFor.filter(id => id !== bot.id) : [...offFor, bot.id] })
            setPending(null)
          }
          return (
            <Fragment key={row.id}>
              {index > 0 ? <View style={[styles.divider, { backgroundColor: p.line }]} /> : null}
              <SwitchRow label={row.name} on={on} disabled={!writable || pending !== null} onChange={value => void change(value)} />
            </Fragment>
          )
        })}
      </View>
    </>
  )
}

function RoundButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  const { p } = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
      style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: p.line, backgroundColor: p.card }}>
      {children}
    </Pressable>
  )
}

function DetailTitle({ text }: { text: string }) {
  const { p } = useTheme()
  return <Text style={[typeScale.caption, { color: p.ink2, marginTop: 18, marginBottom: 8 }]}>{text}</Text>
}

const PRESET_LABELS: Record<string, string> = { 'read-only': 'Read only', 'workspace-write': 'Workspace', 'danger-full-access': 'Full access' }

// An inherited preset can be saved explicitly, as on the Web.
function PermissionPicker({ options, saved, repick, disabled, onPick }: {
  options: { value: string; name: string }[]; saved?: string; repick: boolean; disabled: boolean; onPick: (value: string) => void
}) {
  const { p } = useTheme()
  return (
    <View style={[styles.segments, { backgroundColor: p.hover }]} accessibilityRole="radiogroup">
      {options.map(option => {
        const on = option.value === saved
        const danger = option.value === 'danger-full-access'
        return (
          <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: on, disabled }} disabled={disabled}
            onPress={() => { if (!on || repick) onPick(option.value) }}
            style={[styles.segment, on ? { backgroundColor: p.card } : null]}>
            <Text style={[typeScale.small, { color: danger ? p.danger : on ? p.ink : p.ink2, fontWeight: on ? '500' : '400', textAlign: 'center' }]}>
              {PRESET_LABELS[option.value] ? t(PRESET_LABELS[option.value]) : option.name}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// memory-panel.js MemoryRow: how much the Bot keeps, and the way in.
function MemorySummary({ bot, onOpen }: { bot: Bot; onOpen: () => void }) {
  const { p } = useTheme()
  const { call, team } = useTeam()
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    call('memory-view', { botId: bot.id }).then(view => { if (live) setCount((view as { entries?: unknown[] })?.entries?.length ?? 0) }).catch(() => {})
    return () => { live = false }
  }, [bot.id, team?.revision])
  const label = count === null ? t('Loading…') : count === 0 ? t('Nothing saved yet') : count === 1 ? t('1 entry') : t('{count} entries', { count })
  return (
    <>
      <DetailTitle text={t('Memory')} />
      <Pressable accessibilityRole="button" accessibilityLabel={t("Manage {name}'s memory", { name: bot.name })} onPress={onOpen}
        style={[styles.dropdown, { backgroundColor: p.card, borderColor: p.line }]}>
        <Text style={[typeScale.settingsRow, { color: p.ink, flex: 1 }]}>{label}</Text>
        <Text style={[typeScale.small, { color: p.ink3 }]}>{t('Manage')}</Text>
        <ChevronRightIcon color={p.ink3} />
      </Pressable>
    </>
  )
}

const formatTokens = (count: number) => (count >= 1e6 ? `${(count / 1e6).toFixed(1)}M` : count >= 1e3 ? `${(count / 1e3).toFixed(1)}K` : String(count))

function useDetailStats(bot?: Bot) {
  const { call, team, computer, hello, online } = useTeam()
  const scope = `${computer?.hostDeviceId ?? ''}:${hello?.boot ?? ''}:${bot?.id ?? ''}:${bot?.sessionId ?? ''}`
  const running = team?.partsRunning?.[bot?.sessionId ?? ''] === true
  const [read, setRead] = useState<{ scope: string; stats: SessionStats | null } | null>(null)
  useEffect(() => {
    if (!online || bot === undefined) return
    let live = true
    call('run-stats', { botId: bot.id }).then(value => {
      if (live) setRead({ scope, stats: value as SessionStats | null })
    }).catch(() => {})
    return () => { live = false }
  }, [call, scope, running, online])
  return read?.scope === scope ? read.stats : null
}

function DetailStats({ stats }: { stats: SessionStats | null }) {
  const { p } = useTheme()
  const { turns, speed, cacheHit, context } = sessionFigures(stats)
  const labels = [
    turns > 0 ? turns === 1 ? t('1 turn') : t('{count} turns', { count: turns }) : '',
    speed !== null ? t('{speed} tok/s', { speed }) : '',
    cacheHit !== null ? t('Cache hit {hit}%', { hit: cacheHit }) : '',
    context !== null ? t('Context {percent}%', { percent: context }) : '',
  ].filter(Boolean)
  return labels.length === 0 ? null : (
    <Text style={[typeScale.caption, { color: p.ink2, marginTop: 16, textAlign: 'center' }]}>{labels.join(' · ')}</Text>
  )
}

function UsageSummary({ bot, stats, onOpen }: { bot: Bot; stats: SessionStats | null; onOpen: () => void }) {
  const { p } = useTheme()
  const { total, input, cacheRead } = sessionUsage(stats)
  const text = total === 0 ? '' : t('{tokens} tok · Cache hit {hit}%', { tokens: formatTokens(total), hit: input > 0 ? Math.round(cacheRead / input * 100) : 0 })
  return (
    <>
      <DetailTitle text={t('Usage')} />
      <Pressable accessibilityRole="button" accessibilityLabel={t("{name}'s usage", { name: bot.name })} onPress={onOpen} style={{ flexDirection: 'row', justifyContent: 'space-between', minHeight: 32, alignItems: 'center' }}>
        <Text style={[typeScale.small, { color: p.ink2 }]}>{t('Current session')}</Text>
        <Text style={[typeScale.small, { color: text === '' ? p.ink3 : p.ink }]}>{text === '' ? t('No usage yet') : text}</Text>
      </Pressable>
    </>
  )
}

// schedules.js ScheduleSummary: the Bot's active tasks, or the way to add one.
function ScheduleSummary({ bot, onOpen }: { bot: Bot; onOpen: () => void }) {
  const { p } = useTheme()
  const { call, online } = useTeam()
  const focused = useIsFocused()
  const [view, setView] = useState<{ available?: boolean; tasks?: { id: string; botId?: string; status?: string; title?: string }[] } | null>(null)
  useEffect(() => {
    if (!focused || !online) return
    let live = true
    call('schedules').then(value => { if (live) setView(value as typeof view) }).catch(() => {})
    return () => { live = false }
  }, [call, focused, online, bot.sessionId])
  const tasks = view?.available ? (view.tasks ?? []).filter(task => task.botId === bot.id && task.status === 'active') : []
  return (
    <>
      <DetailTitle text={tasks.length === 0 ? t('Scheduled tasks') : t('Scheduled tasks · {count}', { count: tasks.length })} />
      {tasks.length === 0
        ? <Pressable accessibilityRole="button" onPress={onOpen} style={{ minHeight: 32, justifyContent: 'center' }}>
            <Text style={[typeScale.small, { color: p.ink3 }]}>{view?.available === false ? t('Switch on Automation tasks on the Plugins page in Settings.') : t('No scheduled tasks yet. Add one')}</Text>
          </Pressable>
        : tasks.slice(0, 3).map(task => (
            <Pressable key={task.id} accessibilityRole="button" onPress={onOpen} style={{ minHeight: 36, justifyContent: 'center' }}>
              <Text style={[typeScale.small, { color: p.ink }]} numberOfLines={1}>{task.title}</Text>
            </Pressable>
          ))}
    </>
  )
}

// The desktop's BotCapabilitiesCard: packs first, then by name; a switch per
// library item, with its status for this Bot while attached.
function BotCapabilities({ bot, team, run, writable = true }: { bot: Bot; team: TeamState | null; run: ManageWrite; writable?: boolean }) {
  const library = (team as { capabilities?: { name: string; kind?: string }[] } | null)?.capabilities ?? []
  if (library.length === 0) return null
  const items = [...library].sort((a, b) => Number(b.kind === 'pack') - Number(a.kind === 'pack') || a.name.localeCompare(b.name))
  const attached = new Set(bot.capabilities ?? [])
  const statuses = (team as { capabilityStatuses?: Record<string, Record<string, { state?: string; error?: string }>> } | null)?.capabilityStatuses?.[bot.id] ?? {}
  return (
    <Section label={t('Capabilities')}>
      {items.map(item => (
        <SwitchRow key={item.name} label={item.name} hint={attached.has(item.name) ? capabilityStatusText(statuses[item.name]) : undefined}
          on={attached.has(item.name)} disabled={!writable} onChange={next => void run('bot-capability', { botId: bot.id, name: item.name, attached: next })} />
      ))}
    </Section>
  )
}

// ------------------------------------------------------------ Edit Bot

export function BotEdit({ route, navigation }: any) {
  const { p, dark } = useTheme()
  const { team, online } = useTeam()
  const { run, error } = useWrite(navigation)
  const open = useOpenWhenListed(navigation)
  const bot = botOf(team, route.params?.botId ?? '')
  if (bot === undefined) return <Screen title=""><BackRow title="" onBack={() => navigation.goBack()} /></Screen>
  const writable = online && !team?.readOnly
  const save = (patch: Record<string, unknown>) => (writable ? run('update-bot', { id: bot.id, ...patch }) : Promise.resolve(false))
  const shape = bot.avatar?.shape ?? 'star'
  const color = bot.color ?? 'blue'
  const main = isMain(team, bot.id)
  const primary = team?.mainBotId === bot.id
  const privacyBlock = botPrivacyBlock(bot, team)
  return (
    <Screen title={bot.name}>
      <BackRow title={t('Settings')} onBack={() => navigation.goBack()} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ alignItems: 'center', paddingTop: 12 }}>
          <Avatar bot={bot} dark={dark} size={56} ring={p.main} />
        </View>
        {error ? <Text accessibilityRole="alert" style={[typeScale.small, { color: p.danger, marginHorizontal: 18, marginTop: 10 }]}>{error}</Text> : null}
        <Section label={t('Profile')}>
          <Field label={t('Name')} value={bot.name} placeholder="Bob" maxLength={40} editable={writable} onSave={name => { if (name) void save({ name }) }} />
          <Field label={t('Label')} value={bot.role} placeholder={t('Research, admin…')} maxLength={24} editable={writable} onSave={role => void save({ role })} />
        </Section>
        {writable ? <><Section label={t('Character shape')}>
          <PickGrid columns={5} ids={SHAPES} picked={shape} onPick={id => save({ avatar: { ...bot.avatar, shape: id } })}
            draw={(id, size) => <Avatar bot={{ ...bot, avatar: { ...bot.avatar, shape: id }, color } as Bot} dark={dark} size={size * 0.72} ring={p.card} />} />
        </Section>
        <Section label={t('Character color')}>
          <PickGrid columns={6} ids={COLORS} picked={color} onPick={id => save({ color: id })}
            draw={(id, size) => <View style={{ width: size * 0.52, height: size * 0.52, borderRadius: size, backgroundColor: COLOR_PAINT[id] ?? inkColor(id, dark) }} />} />
        </Section>
        <Section label={t('Photo')}>
          <Row label={t('Upload photo')} onPress={() => { void pickPhoto().then(image => { if (image !== null) save({ avatar: { ...bot.avatar, image } }) }) }} />
          {bot.avatar?.image ? <Row label={t('Remove photo')} onPress={() => save({ avatar: { shape: bot.avatar?.shape } })} /> : null}
        </Section></> : null}
        <BotRunMode bot={bot} team={team} writable={writable} save={save} />
        <Section label={t('Model')}>
          <View style={{ padding: 12 }}><ModelMenu bot={bot} readOnly={!writable} onManage={() => navigation.navigate('Settings', { screen: 'Providers', initial: false })} /></View>
        </Section>
        <Section label={t('Working folder')}>
          <View style={{ padding: 12 }}><BotFolder bot={bot} navigation={navigation} writable={writable} /></View>
        </Section>
        <Section label={t('Privacy')}>
          <SwitchRow label={t('Private')} hint={t(privacyBlock ?? 'Other Bots cannot read its folder, memory or chats, and you approve what it shares with them.')}
            on={bot.private === true} disabled={!writable || privacyBlock !== undefined} onChange={next => void save({ private: next })} />
        </Section>
        <Section label={t('Instructions')}>
          <Field label={t('What this Bot does')} value={bot.instructions} multiline editable={writable} placeholder={t('What this Bot is responsible for…')} onSave={instructions => void save({ instructions })} />
        </Section>
        <BotCapabilities bot={bot} team={team} run={run} writable={writable} />
        {team?.memory === false ? null : <Section label={t('Memory')}>
          <Row label={t("Manage {name}'s memory", { name: bot.name })} onPress={() => navigation.navigate('Memory', { id: bot.id, name: bot.name })} />
        </Section>}
        <Section label={t('Scheduled tasks')}>
          <Row label={t('Schedules')} onPress={() => navigation.navigate('Schedules', { botId: bot.id, name: bot.name, sessionId: bot.sessionId })} />
        </Section>
        <MainBotSettings bot={bot} team={team} writable={writable} run={run} />
        {primary ? null : <Section label={t('Sidebar')}>
          <SwitchRow label={t('Pin')} hint={t('Kept above the other chats.')} on={bot.pinned === true} disabled={!writable}
            onChange={pinned => void run('set-flags', { id: bot.id, pinned })} />
          {main ? null : <SwitchRow label={t('Hide from sidebar')} hint={t('Search still finds it.')} on={bot.hidden === true} disabled={!writable}
            onChange={hidden => void run('set-flags', { id: bot.id, hidden })} />}
        </Section>}
        {writable && (bot.private !== true || !main) ? <Section label={t('Manage')}>
          {bot.private === true ? null : <Row label={t('Duplicate')} hint={t('A copy with the same job and model, and fresh memory.')} onPress={() => void run('duplicate-bot', { id: bot.id }, value => open({ kind: 'bot', id: (value as Bot).id }))} />}
          {main ? null : <DangerRow label={t('Delete Bot')} confirm={t('Delete {name}?', { name: bot.name })} onConfirm={() => void run('delete-bot', { id: bot.id }, () => openChat(navigation))} />}
        </Section> : null}
      </ScrollView>
    </Screen>
  )
}

function MainBotSettings({ bot, team, writable, run }: { bot: Bot; team: TeamState | null; writable: boolean; run: ManageWrite }) {
  const [choosing, setChoosing] = useState(false)
  const main = isMain(team, bot.id)
  const onlyMain = main && mainsOf(team).size === 1
  const replacements = (team?.bots ?? []).filter(candidate => candidate.id !== bot.id && candidate.private !== true)
  return (
    <Section label={t('Main Bot')}>
      {onlyMain ? (
        <Row label={t('Main Bot')} hint={t('Can create and change Bots, and runs every group chat.')}
          value={writable && replacements.length > 0 ? t(choosing ? 'Cancel' : 'Change') : undefined}
          onPress={writable && replacements.length > 0 ? () => setChoosing(!choosing) : undefined} />
      ) : (
        <SwitchRow label={t('Main Bot')} hint={t(bot.private === true ? 'A private Bot cannot be a Main Bot.' : 'Can create and change Bots, and runs every group chat.')}
          on={main} disabled={!writable || bot.private === true} onChange={next => void run('set-main', { id: bot.id, main: next })} />
      )}
      {choosing && onlyMain && writable ? replacements.map(candidate => (
        <Row key={candidate.id} label={candidate.name} onPress={() => void run('set-main', { id: candidate.id, main: true, replace: bot.id }, () => setChoosing(false))} />
      )) : null}
    </Section>
  )
}

interface DiscoveredAgent { route: string; name: string; accountProfileId?: string; sandbox?: boolean; signedIn?: boolean | null }

function BotRunMode({ bot, team, writable, save }: {
  bot: Bot; team: TeamState | null; writable: boolean; save: (patch: Record<string, unknown>) => Promise<boolean>
}) {
  const { call } = useTeam()
  const [choice, setChoice] = useState<'local' | 'model' | null>(null)
  const [agents, setAgents] = useState<DiscoveredAgent[] | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)
  const engine = modelRoute(bot.model ?? bot.appliedModel)
  const local = isLocalModel(engine)
  const fixed = bot.accountProfileId !== undefined
  const catalog = team?.models ?? []
  const current = modelOf(bot, catalog)
  const label = local ? current?.provider ?? bot.engine ?? engine : t('Godbot model')
  useEffect(() => {
    if (choice !== 'local') return
    let live = true
    setAgents(null)
    setAgentError(null)
    void call('local-agents').then(answer => {
      if (!live) return
      const view = answer as { detected?: DiscoveredAgent[]; custom?: DiscoveredAgent[] }
      setAgents([...(view.detected ?? []), ...(view.custom ?? [])].filter(agent => !agent.sandbox && !agent.accountProfileId && agent.route !== engine))
    }, failure => { if (live) setAgentError((failure as Error)?.message ?? String(failure)) })
    return () => { live = false }
  }, [call, choice, engine])
  const pick = (ref: string, agent?: DiscoveredAgent) => {
    const groups = (team?.rooms ?? []).filter(room => room.members?.includes(bot.id)).length
    const note = groups === 0
      ? t('Its own chat starts a new part with a handoff before the next turn.')
      : t('Its own chat and {count} group chats each start a new part with a handoff before the next turn.', { count: groups })
    const signedOut = agent?.signedIn === false ? t('{agent} is not signed in. Sign in first, or its turns fail.', { agent: agent.name }) : ''
    const privacy = bot.private === true && agent ? t('The privacy rules of a private Bot do not cover the tools of a local agent.') : ''
    Alert.alert(t('Change what {name} runs on?', { name: bot.name }), [note, signedOut, privacy].filter(Boolean).join('\n\n'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Change and start a new part'), onPress: () => {
        void save({ model: ref, changeEngine: true }).then(ok => { if (ok) setChoice(null) })
      } },
    ])
  }
  return (
    <Section label={t('Runs on')}>
      <Row label={label} hint={t(fixed ? 'Manage the sandbox account and its working folder in Godbot Web.'
        : local ? 'Answers through this CLI on your computer, with its own tools and sign-in.'
          : "Answers with a model served by Godbot, with Godbot's tools.")}
        value={writable && !fixed ? t(choice === null ? 'Change' : 'Cancel') : undefined}
        onPress={writable && !fixed ? () => setChoice(choice === null ? local ? 'model' : 'local' : null) : undefined} />
      {choice !== null ? (
        <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
          <Segmented options={[{ id: 'model', label: t('Godbot model') }, { id: 'local', label: t('Local agent') }]} value={choice} onPick={id => setChoice(id === 'model' ? 'model' : 'local')} />
          {choice === 'model' && local ? <View style={{ marginTop: 8 }}><ModelPicker hostedOnly onPick={ref => pick(ref)} /></View> : null}
        </View>
      ) : null}
      {choice === 'local' ? (
        agentError !== null ? <Row label={agentError} />
          : agents === null ? <Row label={t('Looking for agent CLIs…')} />
            : agents.length === 0 ? <Row label={t('No agent CLIs found')} />
              : agents.map(agent => <Row key={agent.route} label={agent.name} hint={t(agent.signedIn === true ? 'Signed in' : agent.signedIn === false ? 'Not signed in' : 'Sign-in unknown')}
                  onPress={() => pick(`${agent.route}/default`, agent)} />)
      ) : null}
    </Section>
  )
}

// ------------------------------------------------------------ Create Bot

// Square choices in even columns that fill the card's width.
function PickGrid({ columns, ids, picked, onPick, draw }: { columns: number; ids: string[]; picked: string; onPick: (id: string) => void; draw: (id: string, size: number) => React.ReactNode }) {
  const { p } = useTheme()
  const [width, setWidth] = useState(0)
  const gap = 8
  const size = width === 0 ? 0 : Math.floor((width - gap * (columns - 1)) / columns)
  return (
    <View onLayout={event => setWidth(event.nativeEvent.layout.width - 24)} style={[styles.grid, { gap }]}>
      {size > 0 ? ids.map(id => (
        <Pressable key={id} accessibilityRole="radio" accessibilityState={{ checked: picked === id }} onPress={() => onPick(id)}
          style={[styles.cell, { width: size, height: size }, picked === id ? { borderColor: p.accent, borderWidth: 2 } : { borderColor: p.line }]}>
          {draw(id, size)}
        </Pressable>
      )) : null}
    </View>
  )
}

export function NewBot({ navigation }: any) {
  const { p, dark } = useTheme()
  const { team } = useTeam()
  const { run, error } = useWrite(navigation)
  const [name, setName] = useState('')
  const [shape, setShape] = useState('star')
  const [color, setColor] = useState('blue')
  const models = team?.models ?? []
  const [model, setModel] = useState<string | undefined>(() => (models.find(m => m.ref === team?.defaultModel) ?? models[0])?.ref)
  const [busy, setBusy] = useState(false)
  const open = useOpenWhenListed(navigation)
  const finalName = name.trim() || t('New Bot')
  const clash = (team?.bots ?? []).some(bot => bot.name.toLowerCase() === finalName.toLowerCase())
  const create = async () => {
    if (busy || clash) return
    setBusy(true)
    await run('create-bot', { name: finalName, color, avatar: { shape }, ...(model !== undefined ? { model } : {}) },
      value => open({ kind: 'bot', id: (value as Bot).id }))
    setBusy(false)
  }
  return (
    <Sheet>
      <SheetHeader title={t('Create new Bot')} left={{ label: t('Cancel'), onPress: () => navigation.goBack() }}
        right={{ label: t('Create'), onPress: () => void create(), disabled: busy || clash, strong: true }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
        {error ? <Text style={[typeScale.small, { color: p.danger, marginHorizontal: 18, marginTop: 10 }]}>{error}</Text> : null}
        {/* The Bot as it will look, over its name, as the picks change. */}
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <Avatar bot={{ id: '', name: finalName, avatar: { shape }, color } as Bot} dark={dark} size={72} ring={p.main} />
        </View>
        <Section label={t('Name')}>
          <View style={styles.row}>
            <TextInput style={[typeScale.settingsRow, { color: p.ink, flex: 1 }]} value={name} onChangeText={setName}
              placeholder={t('New Bot')} placeholderTextColor={p.ink3} autoCapitalize="none" />
          </View>
          {clash ? <Text style={[typeScale.small, { color: p.danger, paddingHorizontal: 16, paddingBottom: 10 }]}>{t('Another Bot has this name.')}</Text> : null}
        </Section>
        <Section label={t('Character shape')}>
          <PickGrid columns={5} ids={SHAPES} picked={shape} onPick={setShape}
            draw={(id, size) => <Avatar bot={{ id: '', name: finalName, avatar: { shape: id }, color } as Bot} dark={dark} size={size * 0.72} ring={p.card} />} />
        </Section>
        <Section label={t('Character color')}>
          <PickGrid columns={6} ids={COLORS} picked={color} onPick={setColor}
            draw={(id, size) => <View style={{ width: size * 0.52, height: size * 0.52, borderRadius: size, backgroundColor: COLOR_PAINT[id] ?? inkColor(id, dark) }} />} />
        </Section>
        <View style={{ marginHorizontal: 14, marginTop: 18 }}>
          <Text style={[typeScale.caption, { color: p.ink3, marginBottom: 6, marginLeft: 4 }]}>{t('Model')}</Text>
          <ModelPicker current={model} onPick={setModel} />
        </View>
      </ScrollView>
    </Sheet>
  )
}

// ------------------------------------------------------------ Group settings

const ROOM_MODES: [string, string][] = [['admin', 'Admin leads'], ['everyone', 'Everyone']]

// The desktop's group overview (details-drawer.js GroupOverview): members with the
// admin marked, the goal, who answers, memory and usage. Its gear opens the group settings.
export function GroupDetails({ route, navigation }: any) {
  const { p, dark } = useTheme()
  const { team } = useTeam()
  const room = roomOf(team, route.params?.roomId ?? '')
  if (room === undefined) return <Screen title=""><BackRow title="" onBack={() => navigation.goBack()} /></Screen>
  const bots = team?.bots ?? []
  const members = (room.members ?? []).map(id => botOf(team, id)).filter((bot): bot is Bot => bot !== undefined)
  const admin = botOf(team, room.admin ?? '')
  const mode = admin !== undefined ? (room.mode ?? 'admin') : 'everyone'
  const notice = (room as { notice?: string }).notice
  return (
    <Screen title={room.name}>
      <View style={[styles.detailTop, { paddingTop: 8 }]}>
        <RoundButton label={t('Back')} onPress={() => navigation.goBack()}><ChevronLeftIcon color={p.ink2} /></RoundButton>
        <View style={{ flex: 1 }} />
        <RoundButton label={t('Group settings')} onPress={() => navigation.navigate('GroupSettings', { roomId: room.id })}><GearIcon size={18} color={p.ink2} /></RoundButton>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 18 }}>
        <View style={{ alignItems: 'center', paddingTop: 4 }}>
          <RoomAvatar room={room} bots={bots} dark={dark} size={56} ring={p.main} />
          <Text style={[typeScale.rowName, { color: p.ink, marginTop: 10, fontSize: 18, textAlign: 'center' }]}>{room.name}</Text>
          <Text style={[typeScale.caption, { color: p.ink3, marginTop: 2 }]}>{[t('{count} members', { count: members.length }), admin ? t('Admin {name}', { name: admin.name }) : t('No admin')].join(' · ')}</Text>
        </View>
        {notice
          ? <Text style={[typeScale.small, { color: p.ink2, marginTop: 14 }]} numberOfLines={5}>{notice}</Text>
          : <Pressable accessibilityRole="button" onPress={() => navigation.navigate('GroupSettings', { roomId: room.id })} style={{ alignItems: 'center', paddingVertical: 14 }}>
              <Text style={[typeScale.small, { color: p.ink3 }]}>{t('Add a notice in group settings')}</Text>
            </Pressable>}
        <DetailTitle text={t('Members · {count}', { count: members.length })} />
        {members.map(member => (
          <Pressable key={member.id} accessibilityRole="button" onPress={() => navigation.navigate('BotDetails', { botId: member.id })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }}>
            <Avatar bot={member} dark={dark} size={32} ring={p.main} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[typeScale.settingsRow, { color: p.ink }]} numberOfLines={1}>{member.name}</Text>
                {member.id === room.admin ? <Text style={{ fontSize: 11, lineHeight: 16, paddingHorizontal: 6, borderRadius: 6, overflow: 'hidden', backgroundColor: p.hover, color: p.ink3 }}>{t('Admin')}</Text> : null}
              </View>
              {member.role ? <Text style={[typeScale.caption, { color: p.ink3 }]} numberOfLines={1}>{member.role}</Text> : null}
            </View>
          </Pressable>
        ))}
        <DetailTitle text={t('Who answers')} />
        <Text style={[typeScale.small, { color: p.ink }]}>{mode === 'admin' ? t('Admin leads') : t('Everyone')}</Text>
        {team?.memory === false ? null : (
          <>
            <DetailTitle text={t('Memory')} />
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Memory', { id: room.id, name: room.name, group: true })}
              style={[styles.dropdown, { backgroundColor: p.card, borderColor: p.line }]}>
              <Text style={[typeScale.settingsRow, { color: p.ink, flex: 1 }]}>{t('Memory')}</Text>
              <Text style={[typeScale.small, { color: p.ink3 }]}>{t('Manage')}</Text>
              <ChevronRightIcon color={p.ink3} />
            </Pressable>
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

export function GroupSettings({ route, navigation }: any) {
  const { p, dark } = useTheme()
  const { team } = useTeam()
  const { run, error } = useWrite(navigation)
  const room = roomOf(team, route.params?.roomId ?? '')
  if (room === undefined) return <Screen title=""><BackRow title="" onBack={() => navigation.goBack()} /></Screen>
  const bots = team?.bots ?? []
  const members = new Set(room.members ?? [])
  const update = (patch: Record<string, unknown>) => void run('update-room', { id: room.id, ...patch })
  const mode = room.admin !== undefined && bots.some(b => b.id === room.admin) ? (room.mode ?? 'admin') : 'everyone'
  return (
    <Screen title={room.name}>
      <BackRow title={t('Group settings')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {error ? <Text style={[typeScale.small, { color: p.danger, marginHorizontal: 18, marginTop: 10 }]}>{error}</Text> : null}
        <Section label={t('Profile')}>
          <Field label={t('Name')} value={room.named === true ? room.name : ''} placeholder={t('Name after members')} onSave={name => update({ name })} />
          <Field label={t('Notice')} value={room.notice} multiline placeholder={t('Shared instructions every member reads before speaking…')} onSave={notice => update({ notice })} />
        </Section>
        <Section label={t('Who answers')}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <Segmented value={mode} onPick={id => update({ mode: id })}
              options={ROOM_MODES.map(([id, label]) => ({ id, label: t(label) }))} />
          </View>
        </Section>
        {/* Tick to add or remove a member; among members, the admin is marked and
            another member can take the role. */}
        <Section label={t('Members · {count}', { count: members.size })}>
          {bots.map(bot => {
            const inRoom = members.has(bot.id)
            const leads = room.admin === bot.id
            const toggleMember = () => update({ members: inRoom ? [...members].filter(id => id !== bot.id) : [...members, bot.id] })
            return (
              <View key={bot.id} style={styles.row}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: inRoom }} onPress={toggleMember}
                  style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' }}>
                  <Avatar bot={bot} dark={dark} size={32} ring={p.card} />
                  <Text style={[typeScale.settingsRow, { color: p.ink, flex: 1, minWidth: 0, marginLeft: 10 }]} numberOfLines={1}>{bot.name}</Text>
                </Pressable>
                {leads ? (
                  <Pressable accessibilityRole="button" onPress={() => update({ admin: null })} hitSlop={6}>
                    <Text style={[typeScale.caption, styles.adminTag, { color: p.accent, backgroundColor: p.hover }]}>{t('Admin')}</Text>
                  </Pressable>
                ) : inRoom ? (
                  <Pressable accessibilityRole="button" onPress={() => update({ admin: bot.id })} hitSlop={6}>
                    <Text style={[typeScale.caption, { color: p.ink3, paddingHorizontal: 6, paddingVertical: 6 }]}>{t('Make admin')}</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: inRoom }} onPress={toggleMember} hitSlop={8}
                  style={[styles.check, { marginLeft: 4, flexShrink: 0, borderColor: inRoom ? p.accent : p.line2, backgroundColor: inRoom ? p.accent : 'transparent' }]}>
                  {inRoom ? <CheckIcon size={14} color={p.accentInk} /> : null}
                </Pressable>
              </View>
            )
          })}
        </Section>
        <Section label={t('Danger')}>
          <DangerRow label={t('Delete group')} confirm={t('Delete {name}?', { name: room.name })} onConfirm={() => void run('delete-room', { id: room.id }, () => openChat(navigation))} />
        </Section>
      </ScrollView>
    </Screen>
  )
}

export function NewGroup({ navigation }: any) {
  const { p, dark } = useTheme()
  const { team } = useTeam()
  const { run, error } = useWrite(navigation)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [admin, setAdmin] = useState<string | null>(null)
  const bots = team?.bots ?? []
  const open = useOpenWhenListed(navigation)
  // As on the desktop: an admin and at least one more Bot, and the admin opens
  // by asking what the group is for. The first Bot picked leads until another is chosen.
  const lead = admin !== null && picked.has(admin) ? admin : [...picked][0] ?? null
  const ready = lead !== null && picked.size >= 2
  const create = () => {
    if (!ready) return
    const members = [lead, ...[...picked].filter(id => id !== lead)]
    void run('create-room', { members, admin: lead, greet: true }, value => open({ kind: 'room', id: (value as Room).id }))
  }
  return (
    <Sheet>
      <SheetHeader title={t('Create group chat')} left={{ label: t('Cancel'), onPress: () => navigation.goBack() }}
        right={{ label: t('Create'), onPress: create, disabled: !ready, strong: true }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={[typeScale.small, { color: p.ink3, marginHorizontal: 18, marginTop: 14 }]}>{t('Pick at least two Bots. The admin leads the group.')}</Text>
        {error ? <Text style={[typeScale.small, { color: p.danger, marginHorizontal: 18, marginTop: 10 }]}>{error}</Text> : null}
        {/* One list: tick the members; among them, the admin is marked and another
            member can take the role. */}
        <Section label={t('Members')}>
          {bots.map(bot => {
            const on = picked.has(bot.id)
            const leads = on && lead === bot.id
            const togglePick = () => setPicked(prev => { const next = new Set(prev); if (next.has(bot.id)) next.delete(bot.id); else next.add(bot.id); return next })
            return (
              <View key={bot.id} style={styles.row}>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={togglePick}
                  style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' }}>
                  <Avatar bot={bot} dark={dark} size={32} ring={p.card} />
                  <Text style={[typeScale.settingsRow, { color: p.ink, flex: 1, minWidth: 0, marginLeft: 10 }]} numberOfLines={1}>{bot.name}</Text>
                </Pressable>
                {leads ? <Text style={[typeScale.caption, styles.adminTag, { color: p.accent, backgroundColor: p.hover, flexShrink: 0 }]}>{t('Admin')}</Text>
                  : on && picked.size > 1 ? (
                    <Pressable accessibilityRole="button" onPress={() => setAdmin(bot.id)} hitSlop={6}>
                      <Text style={[typeScale.caption, { color: p.ink3, paddingHorizontal: 6, paddingVertical: 6 }]}>{t('Make admin')}</Text>
                    </Pressable>
                  ) : null}
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={togglePick} hitSlop={8}
                  style={[styles.check, { marginLeft: 4, flexShrink: 0, borderColor: on ? p.accent : p.line2, backgroundColor: on ? p.accent : 'transparent' }]}>
                  {on ? <CheckIcon size={14} color={p.accentInk} /> : null}
                </Pressable>
              </View>
            )
          })}
        </Section>
      </ScrollView>
    </Sheet>
  )
}


// ------------------------------------------------------------ Memory

export function Memory({ route, navigation }: any) {
  const { p } = useTheme()
  const { call } = useTeam()
  const id = String(route.params?.id ?? '')
  const name = String(route.params?.name ?? '')
  const isGroup = route.params?.group === true
  const [view, setView] = useState<{ summary?: { text?: string; at?: number } | string | null; entries?: { scope: string; topic: string | null; text: string; added?: string | null; by?: string | null; source?: string | null }[]; error?: string | null } | null>(null)
  const [asking, setAsking] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ index: number | null; scope: string; topic: string; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  // What the computer said when a read or write failed (an entry too long, memory off, …).
  const [error, setError] = useState<string | null>(null)
  const failed = (f: { code?: string; message?: string }) => { if (f?.code !== 'unlock/canceled') setError(f?.message ?? String(f)) }
  const owner = isGroup ? { roomId: id } : { botId: id }
  const load = useCallback(() => {
    void call('memory-view', isGroup ? { roomId: id } : { botId: id }).then(v => setView(v as typeof view), failed)
  }, [call, id, isGroup])
  useEffect(() => { load() }, [load])
  const openEditor = (next: NonNullable<typeof editor>) => { setError(null); setEditor(next) }
  const forget = (entry: { scope: string; topic: string | null; text: string }) =>
    confirmDanger(t('Remove from memory'), t('Remove'), () => {
      setError(null)
      void call('memory-forget', { ...owner, scope: entry.scope, topic: entry.topic, text: entry.text }).then(load, failed)
    }, entry.text)
  const saveEditor = () => {
    if (editor === null || !editor.text.trim() || saving) return
    const existing = editor.index !== null ? view?.entries?.[editor.index] : undefined
    const body = { ...owner, scope: editor.scope, topic: editor.topic.trim() || null, text: existing?.text ?? '', next: editor.text.trim() }
    const endpoint = existing === undefined ? 'memory-add' : 'memory-edit'
    const payload = existing === undefined ? { ...owner, scope: editor.scope, topic: editor.topic.trim() || null, text: editor.text.trim() } : body
    setError(null)
    setSaving(true)
    // The editor stays open when the computer refuses, so the text is not lost.
    void call(endpoint, payload)
      .then(() => { setEditor(null); load() }, failed)
      .finally(() => setSaving(false))
  }
  const ask = () => { if (!question.trim()) return; setAsking(true); setError(null); void call('memory-ask', { ...owner, text: question.trim() }).then(v => { const r = v as { reply?: string; view?: typeof view }; setAnswer(typeof r.reply === 'string' ? r.reply : null); if (r.view !== undefined) setView(r.view) }, failed).finally(() => setAsking(false)) }
  const summary = memorySummaryText(view?.summary)
  return (
    <Screen title={name}>
      <BackRow title={t('Memory')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {error !== null && editor === null ? <Text style={[typeScale.small, { color: p.danger, marginHorizontal: 18, marginTop: 14 }]}>{error}</Text> : null}
        {summary !== null ? <Text style={[typeScale.caption, { color: p.ink3, margin: 18 }]}>{summary}</Text> : null}
        <View style={[styles.card, { backgroundColor: p.card, borderColor: p.line, marginTop: 14 }]}>
          <View style={styles.row}>
            <TextInput style={[typeScale.settingsRow, { color: p.ink, flex: 1 }]} value={question} onChangeText={setQuestion}
              placeholder={t('Ask memory')} placeholderTextColor={p.ink3} onSubmitEditing={ask} />
            <Pressable accessibilityRole="button" onPress={ask}><Text style={[typeScale.settingsRow, { color: p.accent }]}>{asking ? '…' : t('Ask')}</Text></Pressable>
          </View>
          {answer !== null ? <Text style={[typeScale.settingsRow, { color: p.ink, paddingHorizontal: 16, paddingBottom: 12 }]}>{answer}</Text> : null}
        </View>
        <Section label={t('{count} entries', { count: view?.entries?.length ?? 0 })}>
          {(view?.entries ?? []).map((entry, i) => {
            const by = entry.source === 'memory panel' ? t('by you') : entry.by ? t('by {name}', { name: entry.by }) : null
            const meta = [entry.added, by].filter(Boolean).join(' · ')
            return (
              <Pressable key={i} accessibilityRole="button" onPress={() => openEditor({ index: i, scope: entry.scope, topic: entry.topic ?? '', text: entry.text })} style={styles.row}>
                <View style={{ flex: 1 }}>
                  {entry.topic ? <Text style={[typeScale.small, { color: p.ink3 }]}>{entry.topic}</Text> : null}
                  <Text style={[typeScale.settingsRow, { color: p.ink }]}>{entry.text}</Text>
                  {meta !== '' ? <Text style={[typeScale.small, { color: p.ink3, marginTop: 2 }]}>{meta}</Text> : null}
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={t('Remove from memory')} onPress={() => forget(entry)} hitSlop={8}
                  style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: p.ink3, fontSize: 17 }}>×</Text>
                </Pressable>
              </Pressable>
            )
          })}
          {view !== null && (view.entries ?? []).length === 0 ? <Row label={t('Nothing saved yet')} disabled /> : null}
          <Row label={t('Add')} onPress={() => openEditor({ index: null, scope: 'own', topic: '', text: '' })} />
        </Section>
      </ScrollView>
      <Modal visible={editor !== null} transparent animationType="fade" onRequestClose={() => setEditor(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalWrap}>
          <Pressable style={styles.scrim} onPress={() => setEditor(null)} />
          <View style={[styles.sheet, { backgroundColor: p.card, borderColor: p.line }]}>
            <View style={styles.row}><TextInput style={[typeScale.settingsRow, { color: p.ink, flex: 1 }]} value={editor?.topic ?? ''} onChangeText={topic => setEditor(prev => prev === null ? null : { ...prev, topic })} placeholder={t('Topic')} placeholderTextColor={p.ink3} /></View>
            <View style={[styles.divider, { backgroundColor: p.line }]} />
            <View style={styles.row}><TextInput style={[typeScale.settingsRow, { color: p.ink, flex: 1, minHeight: 80, maxHeight: 180, textAlignVertical: 'top' }]} value={editor?.text ?? ''} onChangeText={text => setEditor(prev => prev === null ? null : { ...prev, text })} placeholder={t('Text')} placeholderTextColor={p.ink3} multiline autoFocus /></View>
            {error !== null ? <Text style={[typeScale.small, { color: p.danger, paddingHorizontal: 16, paddingBottom: 8 }]}>{error}</Text> : null}
            <View style={[styles.divider, { backgroundColor: p.line }]} />
            <View style={styles.row}>
              <Pressable accessibilityRole="button" onPress={() => setEditor(null)} style={{ flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center' }}><Text style={[typeScale.settingsRow, { color: p.ink2 }]}>{t('Cancel')}</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={saving} onPress={saveEditor} style={{ flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', opacity: saving ? 0.5 : 1 }}><Text style={[typeScale.settingsRow, { color: p.accent, fontWeight: '600' }]}>{t('Save')}</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  )
}

// ------------------------------------------------------------ Schedules

const KINDS: [string, string][] = [['at', 'Once'], ['daily', 'Every day'], ['weekly', 'Every week'], ['every', 'Repeat']]
const UNITS: [string, number, string][] = [['minutes', 1, 'minutes'], ['hours', 60, 'hours'], ['days', 1440, 'days']]

const todayString = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

interface ScheduledTask {
  id: string
  sessionId: string
  botId?: string
  roomId?: string
  title: string
  kind: string
  status: string
  state?: string
  time?: string
  everySeconds?: number
  minutes?: number
  weekdays?: number[]
  expression?: string
  scheduledAt?: number | string
}

const whenText = (task: ScheduledTask) => {
  switch (task.kind) {
    case 'at': return t('Once, {time}', { time: timeLabel(typeof task.scheduledAt === 'number' ? task.scheduledAt : Date.parse(task.scheduledAt ?? '')) })
    case 'every': { const s = task.everySeconds ?? (task.minutes ?? 0) * 60; if (s % 86400 === 0) return s === 86400 ? t('Every day') : t('Every {count} days', { count: s / 86400 }); if (s % 3600 === 0) return s === 3600 ? t('Every hour') : t('Every {count} hours', { count: s / 3600 }); return t('Every {count} minutes', { count: Math.round(s / 60) }) }
    case 'daily': return t('Every day at {time}', { time: task.time ?? '' })
    case 'weekly': {
      const d = (task.weekdays ?? []).join()
      if (d === '1,2,3,4,5') return t('Every weekday at {time}', { time: task.time ?? '' })
      if (d === '6,7') return t('Every weekend at {time}', { time: task.time ?? '' })
      if (d === '1,2,3,4,5,6,7') return t('Every day at {time}', { time: task.time ?? '' })
      const labels = (task.weekdays ?? []).map(day => {
        const short = weekdayShort(day)
        return /^[\u4e00-\u9fff]$/.test(short) ? `周${short}` : short
      })
      return t('Every {days} at {time}', { days: labels.join(labels[0]?.startsWith('周') ? '、' : ', '), time: task.time ?? '' })
    }
    case 'cron': return t('On the schedule {expression}', { expression: task.expression ?? '' })
    default: return ''
  }
}

export function Schedules({ route, navigation }: any) {
  const { p } = useTheme()
  const insets = useSafeAreaInsets()
  const { call, team, online } = useTeam()
  const { run, error } = useWrite(navigation)
  const botId = String(route.params?.botId ?? '')
  const roomId = String(route.params?.roomId ?? '')
  const scoped = botId !== '' || roomId !== ''
  const [view, setView] = useState<{ available?: boolean; tasks?: ScheduledTask[] } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [target, setTarget] = useState('')
  const [choosing, setChoosing] = useState(false)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState('daily')
  const [time, setTime] = useState('09:00')
  const [atDate, setAtDate] = useState(todayString)
  const [atTime, setAtTime] = useState('09:00')
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [count, setCount] = useState('1')
  const [unit, setUnit] = useState('hours')
  const [adding, setAdding] = useState(false)
  const focused = useIsFocused()
  useEffect(() => {
    if (!focused || !online) return
    let live = true
    void call('schedules').then(value => {
      if (!live) return
      setView(value as typeof view)
      setReadError(null)
    }, failure => { if (live) setReadError((failure as Error)?.message ?? String(failure)) })
    return () => { live = false }
  }, [call, focused, online, botId, roomId])
  const targets = [...(team?.bots ?? []), ...(team?.rooms ?? [])]
  const selected = targets.find(entry => entry.id === (botId || roomId || target || team?.mainBotId)) ?? (scoped ? undefined : targets[0])
  const writable = online && !team?.readOnly && view?.available !== false
  const tasks = (view?.tasks ?? []).filter(task => !scoped || (botId ? task.botId === botId && !task.roomId : task.roomId === roomId && !task.botId))
  const applySchedules = (value: unknown) => {
    const next = value as typeof view
    if (Array.isArray(next?.tasks)) setView(next)
  }
  const when = () => {
    if (kind === 'at') { const at = new Date(`${atDate}T${atTime}`); return Number.isNaN(at.getTime()) ? null : { kind, at: at.toISOString() } }
    if (kind === 'every') { const minutes = Math.round(Number(count) * (UNITS.find(([id]) => id === unit)?.[1] ?? 60)); return minutes > 0 ? { kind, minutes } : null }
    return { kind, time, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(kind === 'weekly' ? { weekdays } : {}) }
  }
  const create = async () => {
    const timing = when()
    if (!writable || adding || !selected || !title.trim() || !prompt.trim() || timing === null) return
    setAdding(true)
    await run('schedule-create', { target: selected.id, title: title.trim(), prompt: prompt.trim(), when: timing }, value => {
      setTitle('')
      setPrompt('')
      applySchedules(value)
    })
    setAdding(false)
  }
  const canCreate = writable && selected !== undefined && title.trim() !== '' && prompt.trim() !== '' && !adding
  return (
    <Screen title={String(route.params?.name ?? '')}>
      <BackRow title={t(scoped ? 'Schedules' : 'Automation tasks')} onBack={() => navigation.goBack()} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {error ?? readError ? <Text accessibilityRole="alert" style={[typeScale.caption, { color: p.danger, marginHorizontal: 18 }]}>{error ?? readError}</Text> : null}
        <Section label={t('Schedules')}>
          {tasks.map(task => (
            <View key={task.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.settingsRow, { color: p.ink }]}>{task.title}</Text>
                <Text style={[typeScale.small, { color: p.ink3, marginTop: 2 }]}>
                  {[scoped ? undefined : targets.find(entry => entry.id === (task.roomId ?? task.botId))?.name, whenText(task)].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {writable && task.sessionId ? <Pressable accessibilityRole="button" accessibilityLabel={t('Delete task')}
                onPress={() => confirmDanger(t('Delete task'), t('Delete'), () => void run('schedule-delete', { sessionId: task.sessionId, id: task.id }, applySchedules))} hitSlop={8}>
                <Text style={{ color: p.ink3, fontSize: 17 }}>×</Text>
              </Pressable> : null}
            </View>
          ))}
          {tasks.length === 0 ? <Row label={t(view?.available === false ? 'Switch on Automation tasks on the Plugins page in Settings.' : view === null && readError === null ? 'Loading…' : 'Nothing saved yet')} /> : null}
        </Section>
        {writable ? <><Section label={t('New task')}>
          {scoped ? null : <Row label={t('Deliver to')} value={selected?.name} onPress={() => setChoosing(!choosing)} />}
          {choosing ? targets.map(entry => <Row key={entry.id} label={entry.name} onPress={() => { setTarget(entry.id); setChoosing(false) }} />) : null}
          <View style={styles.row}><TextInput style={[typeScale.settingsRow, { color: p.ink, flex: 1 }]} value={title} onChangeText={setTitle} placeholder={t('Morning briefing')} placeholderTextColor={p.ink3} /></View>
          <View style={styles.row}><TextInput style={[typeScale.settingsRow, { color: p.ink, flex: 1, minHeight: 70, textAlignVertical: 'top' }]} value={prompt} onChangeText={setPrompt} placeholder={t('Sum up what changed since yesterday and what needs me today.')} placeholderTextColor={p.ink3} multiline /></View>
          <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
            <Text style={[typeScale.small, { color: p.ink3, marginBottom: 6 }]}>{t('When')}</Text>
            <Segmented value={kind} onPick={id => setKind(id)} options={KINDS.map(([id, label]) => ({ id, label: t(label) }))} />
          </View>
          {kind === 'at' ? (
            <View style={styles.row}>
              <TextInput style={[typeScale.settingsRow, { color: p.ink, flex: 1 }]} value={atDate} onChangeText={setAtDate} placeholder="YYYY-MM-DD" placeholderTextColor={p.ink3} autoCapitalize="none" />
              <TextInput style={[typeScale.settingsRow, { color: p.ink, width: 70 }]} value={atTime} onChangeText={setAtTime} placeholder="09:00" placeholderTextColor={p.ink3} autoCapitalize="none" />
            </View>
          ) : null}
          {kind === 'weekly' ? (
            <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
              {[1, 2, 3, 4, 5, 6, 7].map(day => (
                <Pressable key={day} accessibilityRole="button" accessibilityState={{ selected: weekdays.includes(day) }} onPress={() => setWeekdays(days => days.includes(day) ? days.filter(d => d !== day) : [...days, day].sort())}
                  style={[styles.dayBtn, { borderColor: weekdays.includes(day) ? p.accent : p.line, backgroundColor: weekdays.includes(day) ? p.accent : 'transparent' }]}>
                  <Text style={[typeScale.caption, { color: weekdays.includes(day) ? p.accentInk : p.ink2 }]}>{weekdayShort(day)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {kind === 'daily' || kind === 'weekly' ? (
            <View style={styles.row}><Text style={[typeScale.settingsRow, { color: p.ink3, flex: 1 }]}>{t('Time')}</Text>
              <TextInput style={[typeScale.settingsRow, { color: p.ink, minWidth: 70, textAlign: 'right' }]} value={time} onChangeText={setTime} placeholder="09:00" placeholderTextColor={p.ink3} autoCapitalize="none" /></View>
          ) : null}
          {kind === 'every' ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[typeScale.settingsRow, { color: p.ink3 }]}>{t('Every')}</Text>
                <TextInput style={[typeScale.settingsRow, { color: p.ink, minWidth: 72, borderWidth: 1, borderColor: p.line, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, textAlign: 'center' }]} value={count} onChangeText={setCount} placeholder="1" placeholderTextColor={p.ink3} keyboardType="number-pad" />
              </View>
              <Segmented value={unit} onPick={setUnit} options={UNITS.map(([id, , label]) => ({ id, label: t(label) }))} />
            </View>
          ) : null}
        </Section>
        <View style={{ paddingHorizontal: 18, marginTop: 14 }}>
          <Pressable accessibilityRole="button" disabled={!canCreate} onPress={() => void create()} style={({ pressed }) => [styles.cta, { backgroundColor: p.accent, opacity: !canCreate ? 0.5 : pressed ? 0.85 : 1 }]}>
            <Text style={[typeScale.settingsRow, { color: p.accentInk, fontWeight: '600' }]}>{t('Create task')}</Text>
          </Pressable>
        </View></> : null}
      </ScrollView>
    </Screen>
  )
}

// ------------------------------------------------------------ Folder browser

export function Folder({ route, navigation }: any) {
  const { p } = useTheme()
  const { call } = useTeam()
  const { run, error } = useWrite(navigation)
  const [path, setPath] = useState(String(route.params?.current ?? ''))
  const [plan, setPlan] = useState<FolderPlan | null>(null)
  const [listing, setListing] = useState<{ path: string; parent: string | null; entries: { name: string; path: string }[]; truncated?: boolean } | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  // Godbot: only a computer whose picker is `browse` lists folders; a local macOS dsh web
  // (`native`) refuses folder-list, so the phone offers the team and known folders instead.
  const load = (next: string) => {
    setPath(next)
    setListError(null)
    void call('folder-list', { path: next }).then(v => setListing(v as typeof listing), (f: Error) => { setListing(null); setListError(f?.message ?? String(f)) })
  }
  useEffect(() => {
    void call('folders').then((v) => {
      const next = folderPlan(v as FoldersView)
      setPlan(next)
      if (next.browse) load(path)
    }, (f: Error) => { setPlan({ browse: false, choices: [] }); setListError(f?.message ?? String(f)) })
  }, [])
  const choose = (picked: string) => {
    const target = route.params?.onPick === 'room' ? ['update-room', { id: route.params?.roomId, workDir: picked }]
      : route.params?.onPick === 'team' ? ['team-workspace', { path: picked }]
      : ['update-bot', { id: route.params?.botId, workDir: picked }]
    void run(target[0] as string, target[1] as Record<string, unknown>, () => navigation.goBack())
  }
  const choices = plan?.choices ?? []
  return (
    <Screen title="">
      <BackRow title={t('Working folder')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {error ? <Text style={[typeScale.small, { color: p.danger, marginHorizontal: 18, marginTop: 10 }]}>{error}</Text> : null}
        {plan === null ? <Section label={t('Folders')}><Row label={t('Loading…')} disabled /></Section> : null}
        {plan !== null && choices.length > 0 ? (
          <Section label={t('Folders')}>
            {choices.map(choice => (
              <Row key={choice.path} label={choice.team ? t('Team workspace') : choice.title} hint={choice.path}
                onPress={() => (plan.browse ? load(choice.path) : setPath(choice.path))}
                end={!plan.browse && choice.path === path ? <CheckIcon size={16} color={p.accent} /> : undefined} />
            ))}
          </Section>
        ) : null}
        {plan !== null && !plan.browse ? (
          <Text style={[typeScale.small, { color: p.ink3, marginHorizontal: 18, marginTop: 10 }]}>{t('To use another folder, pick it in Godbot on the computer.')}</Text>
        ) : null}
        {plan?.browse ? (
          <Section label={path || '/'}>
            {listing?.parent ? <Row label={t('Up one level')} onPress={() => load(listing.parent ?? '')} /> : null}
            {(listing?.entries ?? []).map(entry => <Row key={entry.path} label={entry.name} onPress={() => load(entry.path)} />)}
            {listing !== null && listing.entries.length === 0 ? <Row label={t('No folders inside.')} disabled /> : null}
            {listing?.truncated ? <Row label={t('Some folders are not shown.')} disabled /> : null}
            {listError !== null ? <Row label={listError} disabled /> : null}
          </Section>
        ) : null}
        <View style={{ paddingHorizontal: 18, marginTop: 14 }}>
          <Pressable accessibilityRole="button" disabled={path === ''} onPress={() => choose(path)} style={({ pressed }) => [styles.cta, { backgroundColor: p.accent, opacity: path === '' ? 0.5 : pressed ? 0.85 : 1 }]}>
            <Text style={[typeScale.settingsRow, { color: p.accentInk, fontWeight: '600' }]}>{t('Use this folder')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  )
}

// ------------------------------------------------------------ Usage

export function Usage({ route, navigation }: any) {
  const { p } = useTheme()
  const { call } = useTeam()
  const botId = String(route.params?.botId ?? '')
  type Totals = { input: number; cacheRead?: number; cacheWrite?: number; output: number }
  const [summary, setSummary] = useState<{ day?: Totals; week?: Totals; month?: Totals; models?: ({ key?: string; name: string } & Totals)[] } | null>(null)
  // The Bot's chat Session projections (channel.js RUN_STATS).
  const [stats, setStats] = useState<{ sessionStats?: { turns?: number; steps?: number }; contextPressure?: { pressureTokens?: number; contextWindow?: number } } | null>(null)
  useEffect(() => {
    void call('usage-summary', { botId }).then(v => setSummary(v as typeof summary)).catch(() => {})
    void call('run-stats', { botId }).then(v => setStats(v as typeof stats)).catch(() => {})
  }, [botId])
  const sum = (t2: Totals) => t2.input + (t2.cacheRead ?? 0) + (t2.cacheWrite ?? 0) + t2.output
  const total = (t2?: Totals) => t2 === undefined ? '—' : sum(t2).toLocaleString()
  const pressure = stats?.contextPressure
  const context = pressure?.pressureTokens !== undefined && pressure.contextWindow ? `${Math.round(pressure.pressureTokens / pressure.contextWindow * 100)}%` : '—'
  return (
    <Screen title={String(route.params?.name ?? '')}>
      <BackRow title={t('Usage')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Section label={t('Usage')}>
          <Row label={t('Day')} value={total(summary?.day)} />
          <Row label={t('Week')} value={total(summary?.week)} />
          <Row label={t('Month')} value={total(summary?.month)} />
        </Section>
        <Section label={t('Model')}>
          {(summary?.models ?? []).map(m => <Row key={m.key ?? m.name} label={m.name} value={sum(m).toLocaleString()} />)}
        </Section>
        <Section label={t('Runs')}>
          <Row label={t('Turns')} value={String(stats?.sessionStats?.turns ?? '—')} />
          <Row label={t('Steps')} value={String(stats?.sessionStats?.steps ?? '—')} />
          <Row label={t('Context used')} value={context} />
        </Section>
      </ScrollView>
    </Screen>
  )
}

// ------------------------------------------------------------ Computers

const fingerprint = async (key: string): Promise<string> => {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key)
  return hex.slice(0, 16).toUpperCase().match(/.{4}/g)?.join(' ') ?? hex.slice(0, 16).toUpperCase()
}

export function Computers({ navigation }: any) {
  const { p } = useTheme()
  const { online, computer, team } = useTeam()
  const [list, setList] = useState<StoredComputer[]>([])
  const [prints, setPrints] = useState<Record<string, string>>({})
  useEffect(() => {
    void listComputers().then(({ computers }) => {
      setList(computers)
      computers.forEach(item => void fingerprint(item.hostKey).then(text => setPrints(prev => ({ ...prev, [item.hostDeviceId]: text }))).catch(() => {}))
    })
  }, [])
  const actions = useContext(ComputersCtx)
  const forget = (id: string, name: string) => confirmDanger(t('Forget {name}?', { name }), t('Forget'), () => { void removeComputer(id).then(next => { setList(next); if (computer?.hostDeviceId === id) actions.reload() }) })
  return (
    <Screen title="">
      <BackRow title={t('Computers')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {!DEMO && <Section label={t('Remote computers')}><Row label={t('Remote computers')} onPress={() => actions.machines(team?.prefs)} /></Section>}
        <Section label={t('Godbot teams')}>
          {list.map(item => {
            const active = item.hostDeviceId === computer?.hostDeviceId
            return (
              <View key={item.hostDeviceId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[typeScale.settingsRow, { color: p.ink }]}>{item.name || item.server}</Text>
                  <Text style={[typeScale.small, { color: p.ink3, marginTop: 2 }]}>{active ? (online ? t('Connected') : t('Connecting…')) : t('Not connected')} · {prints[item.hostDeviceId] ?? '…'}</Text>
                </View>
                {active ? null : (
                  <Pressable accessibilityRole="button" onPress={() => actions.switchTo(item.hostDeviceId)} hitSlop={8}>
                    <Text style={[typeScale.settingsRow, { color: p.accent }]}>{t('Switch')}</Text>
                  </Pressable>
                )}
                <Pressable accessibilityRole="button" onPress={() => forget(item.hostDeviceId, item.name || item.server)} hitSlop={8} style={{ minWidth: 44, alignItems: 'flex-end' }}>
                  <Text style={[typeScale.settingsRow, { color: p.ink3 }]}>{t('Forget')}</Text>
                </Pressable>
              </View>
            )
          })}
          <Row label={t('Add a computer')} onPress={actions.add} />
        </Section>
      </ScrollView>
    </Screen>
  )
}

// ------------------------------------------------------------ Secrets

export function Secrets({ navigation }: any) {
  const { p } = useTheme()
  const { team } = useTeam()
  const { run, error } = useWrite(navigation)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const secrets = (team as { secrets?: { name: string; description?: string; scope?: string | string[] }[] } | null)?.secrets ?? []
  const save = () => { if (!name.trim() || !value) return; const next = value; setValue(''); void run('secret-set', { name: name.trim(), value: next }, () => setName('')) }
  return (
    <Screen title="">
      <BackRow title={t('Secrets')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {error ? <Text style={[typeScale.small, { color: p.danger, marginHorizontal: 18, marginTop: 10 }]}>{error}</Text> : null}
        <Section label={t('Secrets')}>
          {secrets.map(secret => (
            <View key={secret.name} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.settingsRow, { color: p.ink }]}>{secret.name}</Text>
                {secret.scope !== undefined ? <Text style={[typeScale.small, { color: p.ink3, marginTop: 2 }]}>{secret.scope === 'all' ? t('All Bots') : (Array.isArray(secret.scope) ? secret.scope : [secret.scope]).map(id => botOf(team, id)?.name ?? id).join(', ')}</Text> : null}
              </View>
              <Pressable accessibilityRole="button" onPress={() => confirmDanger(t('Delete {name}?', { name: secret.name }), t('Delete'), () => void run('secret-delete', { name: secret.name }))} hitSlop={8} style={{ minWidth: 44, alignItems: 'flex-end' }}>
                <Text style={[typeScale.settingsRow, { color: p.ink3 }]}>{t('Delete')}</Text>
              </Pressable>
            </View>
          ))}
          {secrets.length === 0 ? <Row label={t('Nothing saved yet')} disabled /> : null}
        </Section>
        <Section label={t('Add')}>
          <View style={styles.row}><TextInput style={[typeScale.settingsRow, { color: p.ink, flex: 1 }]} value={name} onChangeText={setName} placeholder={t('Name')} placeholderTextColor={p.ink3} autoCapitalize="characters" /></View>
          <View style={styles.row}><TextInput style={[typeScale.settingsRow, { color: p.ink, flex: 1 }]} value={value} onChangeText={setValue} placeholder={t('Paste or type the key')} placeholderTextColor={p.ink3} autoCapitalize="none" autoCorrect={false} secureTextEntry /></View>
        </Section>
        <View style={{ paddingHorizontal: 18, marginTop: 14 }}>
          <Pressable accessibilityRole="button" disabled={!name.trim() || !value} onPress={save} style={({ pressed }) => [styles.cta, { backgroundColor: p.accent, opacity: !name.trim() || !value ? 0.5 : pressed ? 0.85 : 1 }]}>
            <Text style={[typeScale.settingsRow, { color: p.accentInk, fontWeight: '600' }]}>{t('Save')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  detailTop: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 4 },
  detailIdentity: { alignItems: 'center', paddingTop: 4, paddingBottom: 4 },
  identityName: { width: '100%', textAlign: 'center', marginTop: 4, fontSize: 19, fontWeight: '600', paddingVertical: 6 },
  identityRole: { width: '100%', textAlign: 'center', paddingVertical: 4 },
  aboutInput: { minHeight: 88, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.card, paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: 'top' },
  inlineAction: { minHeight: 44, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  detailRows: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  detailListRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 44 },
  tabs: { flexDirection: 'row', alignSelf: 'center', borderRadius: 10, padding: 2, marginTop: 14 },
  tab: { minWidth: 72, minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  segments: { flexDirection: 'row', borderRadius: 10, padding: 2 },
  segment: { flex: 1, minHeight: 36, paddingVertical: 6, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  dropdown: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14 },
  backRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  card: { marginHorizontal: 14, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', ...shadow(1) },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, minHeight: 50, gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  cell: { width: 52, height: 52, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  segRow: { flexDirection: 'row', borderRadius: 9, padding: 2 },
  seg: { flex: 1, minHeight: 34, paddingVertical: 5, borderRadius: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  switch: { width: 46, height: 28, borderRadius: 14, padding: 3, justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: 11 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  adminTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  pillBtn: { borderRadius: 20, paddingHorizontal: 18, minHeight: 40, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  cta: { minHeight: 48, borderRadius: radius.pill, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  modalWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { maxHeight: '72%', borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', ...shadow(2) },
  menuRow: { paddingHorizontal: 18, paddingVertical: 14 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayBtn: { minWidth: 36, height: 36, paddingHorizontal: 8, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tick: { position: 'absolute', top: 3, right: 3, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
})

interface BrowserFrame { mime: string; data: string; url?: string; title?: string }

export function BotBrowser({ bot, navigation }: { bot: Bot; navigation: { goBack: () => void } }) {
  const { p, dark } = useTheme()
  const { team, call } = useTeam()
  const focused = useIsFocused()
  const [frame, setFrame] = useState<BrowserFrame | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Godbot runs Bot browsers in its own environments on the computer; the phone link cannot
  // show them, and the computer answers bot/browser-off or bot/not-found. Then the page says
  // where to look and stops asking every two seconds.
  const [elsewhere, setElsewhere] = useState(false)
  const hold = (team as { browserHolds?: Record<string, { by?: string; reason?: string; note?: string; callId?: string }> } | null)?.browserHolds?.[bot.id]
  const refresh = useCallback(() => {
    void call('browser-frame', { botId: bot.id }).then(v => { setFrame(v as BrowserFrame); setError(null); setElsewhere(false) },
      (f: { code?: string; message?: string }) => {
        if (f?.code === 'bot/browser-off' || f?.code === 'bot/not-found') {
          setElsewhere(true)
          setError(t("This Bot's browser runs in Godbot on the computer. Open it there to watch or take over."))
        } else setError(f?.message ?? String(f))
      })
  }, [call, bot.id])
  useEffect(() => {
    if (!focused || elsewhere) return
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [focused, refresh, elsewhere])
  const act = (endpoint: string, payload: Record<string, unknown>) => void call(endpoint, payload).catch(() => {}).then(refresh)
  return (
    <Screen title={t('Browser')}>
      <BackRow title={t('Browser')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        {frame?.data ? (
          <Image source={{ uri: `data:${frame.mime};base64,${frame.data}` }} style={{ width: '100%', aspectRatio: 0.62, borderRadius: radius.card, backgroundColor: p.hover }} resizeMode="contain" />
        ) : null}
        {frame?.title ? <Text style={[typeScale.settingsRow, { color: p.ink, marginTop: 10 }]}>{frame.title}</Text> : null}
        {frame?.url ? <Text style={[typeScale.small, { color: p.ink3, marginTop: 2 }]} numberOfLines={1}>{frame.url}</Text> : null}
        {error ? <Text style={[typeScale.small, { color: p.danger, marginTop: 12 }]}>{error}</Text> : null}
        {hold?.note ? <Text style={[typeScale.small, { color: p.ink2, marginTop: 12 }]}>{hold.note}</Text> : null}
        {/* A host with Bot browsers off has nothing to take over or stop. */}
        {(team as { browser?: unknown } | null)?.browser === false || elsewhere ? null : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
          {hold?.callId !== undefined ? (
            <>
              <Pressable accessibilityRole="button" onPress={() => act('browser-give-back', { botId: bot.id, outcome: 'done', callId: hold.callId })} style={[styles.pillBtn, { backgroundColor: p.accent }]}><Text style={{ color: p.accentInk, fontWeight: '600' }}>{t('Done')}</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => act('browser-give-back', { botId: bot.id, outcome: 'skip', callId: hold.callId })} style={[styles.pillBtn, { backgroundColor: p.hover }]}><Text style={{ color: p.ink }}>{t('Skip')}</Text></Pressable>
            </>
          ) : hold?.by === 'user' ? (
            <Pressable accessibilityRole="button" onPress={() => act('browser-give-back', { botId: bot.id })} style={[styles.pillBtn, { backgroundColor: p.accent }]}><Text style={{ color: p.accentInk, fontWeight: '600' }}>{t('Give back')}</Text></Pressable>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => act('browser-takeover', { botId: bot.id })} style={[styles.pillBtn, { backgroundColor: p.hover }]}><Text style={{ color: p.ink }}>{t('Take over')}</Text></Pressable>
          )}
          <Pressable accessibilityRole="button" onPress={() => act('browser-stop', { botId: bot.id })} style={[styles.pillBtn, { backgroundColor: p.hover }]}><Text style={{ color: p.danger }}>{t('Stop')}</Text></Pressable>
        </View>}
      </ScrollView>
    </Screen>
  )
}
