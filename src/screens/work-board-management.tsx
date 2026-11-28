import { useRef, useState, type ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import * as Crypto from 'expo-crypto'
import type { Bot, Room } from '../connection.ts'
import { useTeam } from '../team/context.tsx'
import { makeBoardViewLink } from '../team/work-board-link.ts'
import { t } from '../ui/i18n.ts'
import { CheckIcon, CloseIcon } from '../ui/icons.tsx'
import { BotMark, RoomAvatar } from '../ui/marks.tsx'
import { radius, shadow, type as typeScale, useTheme } from '../ui/tokens.ts'
import { layoutShortLabels, phaseTone, statusText, tint } from '../team/work-board-theme.ts'
import { sourceNames, useBoardLookup } from '../../godbot/shared/work-board.js'
import { boardLayouts, boardPropertyTypes, boardSorts, manualStatuses, priorities } from '../../godbot/shared/work-board-planning.js'

export type Named = { id: string; name: string }
export type PlanValue = string | boolean | number | string[] | null
export type Property = Named & { kind: string; options?: string[]; archived?: boolean; revision: number }
export type Status = Named & { phase: string; archived?: boolean; revision: number }
export type Display = { layout: string; groupBy: string }
export type Filters = Record<string, string>
export type SavedView = Named & { visibility: 'private' | 'shared'; filters: Filters; display: Display; revision: number }
export type Catalog = { assignees: (Named & { kind: string })[]; properties: Property[]; statuses: Status[]; views: SavedView[] }
export type PlanFields = {
  description?: string; labels?: string[]; startDate?: string; dueDate?: string; statusId?: string
  assignee?: string; parent?: string; stage?: number; blockedBy?: string[]; duplicateOf?: string
  customValues?: Record<string, PlanValue>; reason?: string; addLabels?: string[]; removeLabels?: string[]
}
export type Choose = (title: string, options: [string, string][], setter: (value: string) => void, current?: string) => void
type Selection = { id: string; version: string }
type MutationError = { id: string; reason: string }
type Entry = {
  kind: 'view' | 'status' | 'property'; id?: string; revision?: number; name: string; phase?: string
  propertyType?: string; options?: string[]; optionText?: string; visibility?: string; archived?: boolean
  filters?: Filters; display?: Display; op?: string; useCurrent?: boolean
}
const words = (text: string) => text.split(/[,，\n]/).map(value => value.trim()).filter(Boolean)
const labels = (value: Record<string, string>): [string, string][] => Object.entries(value).map(([id, label]) => [id, t(label)])
const phases = { todo: 'To do', doing: 'In progress', attention: 'Needs attention', review: 'Awaiting review', done: 'Done', history: 'History' }
export { layoutShortLabels, phaseTone, statusText, tint }

export function OwnerAvatar({ target, bots, rooms, catalog, size = 20 }: {
  target: { owner?: string; assignee?: string; fields?: { assignee?: string } }
  bots: Bot[]; rooms: Room[]; catalog?: Catalog; size?: number
}) {
  const { p, dark } = useTheme()
  const raw = target.fields?.assignee || target.assignee || (target.owner ? 'bot/' + target.owner : '')
  if (!raw) {
    return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.2, borderStyle: 'dashed', borderColor: p.ink3 }} />
  }
  if (raw.startsWith('bot/') || !raw.includes('/')) {
    const id = raw.startsWith('bot/') ? raw.slice(4) : raw
    const bot = bots.find(b => b.id === id) ?? ({ id, name: id, shape: 'orb', color: 'gray' } as Bot)
    return <BotMark bot={bot} dark={dark} size={size} />
  }
  if (raw.startsWith('room/')) {
    const id = raw.slice(5)
    const room = rooms.find(r => r.id === id)
    if (room) return <RoomAvatar room={room} bots={bots} dark={dark} size={size} ring={p.card} />
  }
  const initial = Array.from(t(assigneeName(raw, catalog)))[0] ?? 'U'
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: tint(p.accent, 0.16), alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ fontSize: Math.max(9, Math.round(size * 0.52)), fontWeight: '600', color: p.accent }}>{initial}</Text>
    </View>
  )
}

export function StatusPill({ phase, label }: { phase: string; label: string }) {
  const { p } = useTheme()
  const tone = phaseTone(phase, p)
  return (
    <View style={[uiStyles.statusPill, { backgroundColor: tint(tone, 0.13) }]}>
      <View style={[uiStyles.dot, { backgroundColor: tone }]} />
      <Text numberOfLines={1} style={[typeScale.caption, { color: tone, fontWeight: '600', flexShrink: 1 }]}>{label}</Text>
    </View>
  )
}

export function PriorityBadge({ priority, showNormal = false }: { priority?: number; showNormal?: boolean }) {
  const { p } = useTheme()
  if (priority == null || (!showNormal && (priority === 0 || priority === 4))) return null
  const tone = priority === 2 ? p.danger : priority === 1 ? p.star : p.ink2
  const bg = priority === 2 ? tint(p.danger, 0.13) : priority === 1 ? tint(p.star, 0.15) : p.tagBg
  const text = t((priorities as Record<number, string>)[priority] ?? 'Normal')
  return (
    <View style={[uiStyles.prioPill, { backgroundColor: bg }]}>
      <View style={[uiStyles.dot, { backgroundColor: tone }]} />
      <Text style={[typeScale.caption, { color: tone, fontWeight: '600' }]}>{text}</Text>
    </View>
  )
}

export function DateChip({ value, phase, prefix }: { value?: string; phase: string; prefix?: 'start' | 'due' }) {
  const { p } = useTheme()
  if (!value) return null
  const today = new Date().toISOString().slice(0, 10)
  const overdue = prefix !== 'start' && !['done', 'history'].includes(phase) && value < today
  const bg = overdue ? tint(p.danger, 0.13) : p.tagBg
  const fg = overdue ? p.danger : p.tagInk
  return (
    <View style={[uiStyles.tagChip, { backgroundColor: bg }]}>
      <Text style={[typeScale.caption, { color: fg, fontWeight: overdue ? '600' : '400' }]}>{value}</Text>
    </View>
  )
}

export function SectionCard({ title, badge, right, children }: {
  title?: string; badge?: string; right?: ReactNode; children: ReactNode
}) {
  const { p } = useTheme()
  return (
    <View style={[uiStyles.sectionCard, { backgroundColor: p.card, borderColor: p.line }, shadow(1)]}>
      {(title || right) ? (
        <View style={uiStyles.sectionHead}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
            {title ? <Text style={[typeScale.small, { color: p.ink2, fontWeight: '600' }]}>{title}</Text> : null}
            {badge ? (
              <View style={[uiStyles.tagChip, { backgroundColor: p.bubble }]}>
                <Text style={[typeScale.caption, { color: p.ink2, fontWeight: '600' }]}>{badge}</Text>
              </View>
            ) : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  )
}

export function BoardButton({ title, onPress, disabled = false, selected = false, variant = 'secondary', compact = false }: {
  title: string; onPress: () => void; disabled?: boolean; selected?: boolean
  variant?: 'secondary' | 'primary' | 'soft' | 'danger'; compact?: boolean
}) {
  const { p } = useTheme()
  const bg = variant === 'primary'
    ? p.accent
    : variant === 'danger'
      ? tint(p.danger, 0.1)
      : selected
        ? tint(p.accent, 0.12)
        : variant === 'soft'
          ? p.bubble
          : p.card
  const borderColor = variant === 'primary'
    ? p.accent
    : variant === 'danger'
      ? tint(p.danger, 0.35)
      : selected
        ? p.accent
        : variant === 'soft'
          ? p.line
          : p.line2
  const textColor = variant === 'primary'
    ? p.accentInk
    : variant === 'danger'
      ? p.danger
      : selected
        ? p.accent
        : p.ink
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, selected }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={compact ? { top: 6, bottom: 6 } : undefined}
      style={({ pressed }) => ({
        minHeight: compact ? 36 : 44,
        justifyContent: 'center',
        paddingHorizontal: compact ? 11 : 13,
        paddingVertical: compact ? 6 : 8,
        borderRadius: compact ? radius.pill : radius.row,
        borderWidth: variant === 'primary' ? 0 : StyleSheet.hairlineWidth,
        borderColor,
        backgroundColor: pressed && variant !== 'primary' ? p.hover : bg,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text style={[typeScale.small, { color: textColor, fontWeight: variant === 'primary' || selected ? '600' : '500', textAlign: 'center' }]}>
        {title}
      </Text>
    </Pressable>
  )
}

export function BoardText({ children, faint = false }: { children: ReactNode; faint?: boolean }) {
  const { p } = useTheme()
  return <Text selectable style={[faint ? typeScale.small : typeScale.settingsRow, { color: faint ? p.ink2 : p.ink }]}>{children}</Text>
}

export function BoardField({ title, value, change, multiline = false, numeric = false, limit }: {
  title: string; value?: string; change: (value: string) => void; multiline?: boolean; numeric?: boolean; limit?: number
}) {
  const { p } = useTheme()
  return <View style={{ gap: 5 }}>
    <Text style={[typeScale.caption, { color: p.ink2, fontWeight: '500' }]}>{title}</Text>
    <TextInput accessibilityLabel={title} value={value ?? ''} onChangeText={change} multiline={multiline}
      keyboardType={numeric ? 'numbers-and-punctuation' : 'default'} maxLength={limit}
      placeholderTextColor={p.ink3}
      style={{
        borderWidth: 1, borderColor: p.line2, borderRadius: radius.input, backgroundColor: p.card, color: p.ink,
        paddingHorizontal: 12, paddingVertical: 9, minHeight: multiline ? 82 : 46,
        textAlignVertical: multiline ? 'top' : 'center',
      }} />
  </View>
}

export const assigneeName = (id: string | undefined, catalog?: Catalog) =>
  catalog?.assignees.find(person => person.id === id)?.name ?? t('Unassigned')
export const boardName = (key: string, group: string, catalog?: Catalog) => {
  if (group === 'assignee') return assigneeName(key, catalog)
  if (group === 'status' || group === 'phase') return t((phases as Record<string, string>)[key]
    ?? (manualStatuses as Record<string, { name: string }>)[key]?.name ?? catalog?.statuses.find(s => s.id === key)?.name ?? key)
  if (group === 'priority') return t((priorities as Record<string, string>)[key] ?? 'No priority')
  return key || t('Unassigned')
}
const rowStyle = { flexDirection: 'row', flexWrap: 'wrap', gap: 7 } as const

function RelationInput({ title, current, multiple, exclude, change }: {
  title: string; current: string[]; multiple?: boolean; exclude?: string; change: (values: string[]) => void
}) {
  const { call, online } = useTeam()
  const [search, setSearch] = useState('')
  const items = useBoardLookup(call, search, online) as { id: string; title: string }[]
  return <View style={{ gap: 6 }}>
    <BoardField title={title} value={search} change={setSearch} limit={160} />
    {current.length ? <View style={rowStyle}>
      {current.map(id => <BoardButton key={id} compact variant="soft" title={id + ' ×'} onPress={() => change(current.filter(value => value !== id))} />)}
    </View> : null}
    {items.filter(item => item.id !== exclude && !current.includes(item.id)).map(item =>
      <BoardButton key={item.id} variant="soft" title={item.id + ' · ' + item.title} onPress={() => {
        change(multiple ? [...current, item.id] : [item.id])
        setSearch('')
      }} />)}
  </View>
}

function PropertyEditor({ property, value, catalog, choose, change }: {
  property: Property; value?: PlanValue; catalog?: Catalog; choose: Choose; change: (value: PlanValue) => void
}) {
  const [draft, setDraft] = useState(() => Array.isArray(value) ? value.join('\n') : value == null ? '' : String(value))
  const people: [string, string][] = catalog?.assignees.filter(a => a.kind === 'person').map(a => [a.id, t(a.name)]) ?? []
  const choices: [string, string][] = property.kind === 'person' || property.kind === 'people'
    ? people : (property.options ?? []).map(item => [item, item])
  if (property.kind === 'select' || property.kind === 'person')
    return <BoardButton title={property.name + ' · ' + (choices.find(([id]) => id === value)?.[1] ?? t('Not set'))}
      onPress={() => choose(property.name, [['', t('Not set')], ...choices], v => change(v || null), String(value ?? ''))} />
  if (property.kind === 'multiSelect' || property.kind === 'people') {
    const picked = Array.isArray(value) ? value : []
    return <View style={{ gap: 5 }}><BoardText faint>{property.name}</BoardText><View style={rowStyle}>
      {choices.map(([id, name]) => <BoardButton key={id} compact title={name} selected={picked.includes(id)}
        onPress={() => change(picked.includes(id) ? picked.filter(v => v !== id) : [...picked, id])} />)}
    </View></View>
  }
  if (property.kind === 'checkbox') return <BoardButton title={property.name + ' · ' + t(value == null ? 'Not set' : value ? 'Yes' : 'No')}
    onPress={() => choose(property.name, [['', t('Not set')], ['true', t('Yes')], ['false', t('No')]],
      v => change(v === '' ? null : v === 'true'), value == null ? '' : String(value))} />
  return <BoardField title={property.name + (property.kind === 'date' ? ' · YYYY-MM-DD' : '')}
    value={draft} numeric={property.kind === 'number'} multiline={property.kind.endsWith('List')}
    change={text => {
      setDraft(text)
      if (property.kind === 'number') change(text.trim() === '' ? null : Number(text))
      else if (property.kind.endsWith('List')) change(words(text))
      else change(text)
    }} />
}

export function BoardPlanEditor({ fields, change, catalog, choose, item, bulk = false }: {
  fields: PlanFields; change: (patch: Partial<PlanFields>) => void; catalog?: Catalog; choose: Choose
  item?: { id: string; phase: string; source: string }; bulk?: boolean
}) {
  const [labelDraft, setLabelDraft] = useState((fields.labels ?? []).join(', '))
  const [relations, setRelations] = useState(Boolean(fields.parent) || Boolean(item))
  const [add, setAdd] = useState('')
  const [remove, setRemove] = useState('')
  const statusOptions: [string, string][] = [
    ['', t('Default status')],
    ...Object.entries(manualStatuses)
      .filter(([, status]) => !item || item.source === 'draft' || status.phase === item.phase)
      .map(([id, status]): [string, string] => [id, t(status.name)]),
    ...(catalog?.statuses ?? []).filter(status => !status.archived && (!item || item.source === 'draft' || status.phase === item.phase))
      .map((status): [string, string] => [status.id, status.name]),
  ]
  return <View style={{ gap: 10 }}>
    {!bulk && <BoardField title={t('Task description')} value={fields.description} multiline limit={16000}
      change={description => change({ description })} />}
    <BoardButton title={t('Task status') + ' · ' + (statusOptions.find(([id]) => id === fields.statusId)?.[1] ?? t('Default status'))}
      onPress={() => choose(t('Task status'), statusOptions, statusId => change({ statusId }), fields.statusId ?? '')} />
    {bulk ? <>
      <BoardField title={t('Add labels')} value={add} change={value => { setAdd(value); change({ addLabels: words(value) }) }} />
      <BoardField title={t('Remove labels')} value={remove} change={value => { setRemove(value); change({ removeLabels: words(value) }) }} />
    </> : <BoardField title={t('Labels')} value={labelDraft} change={value => { setLabelDraft(value); change({ labels: words(value) }) }} />}
    <BoardField title={t('Start date') + ' · YYYY-MM-DD'} value={fields.startDate} limit={10} change={startDate => change({ startDate })} />
    <BoardField title={t('Due date') + ' · YYYY-MM-DD'} value={fields.dueDate} limit={10} change={dueDate => change({ dueDate })} />
    {(catalog?.properties ?? []).filter(property => !property.archived).map(property =>
      <PropertyEditor key={property.id} property={property} catalog={catalog} choose={choose} value={fields.customValues?.[property.id]}
        change={value => change({ customValues: { ...fields.customValues, [property.id]: value } })} />)}
    <BoardButton title={t('Task relationships')} selected={relations} onPress={() => setRelations(!relations)} />
    {relations ? <>
      <RelationInput title={t('Parent work item')} current={fields.parent ? [fields.parent] : []} exclude={item?.id}
        change={ids => change({ parent: ids[0] ?? '', ...(!ids.length ? { stage: 0 } : {}) })} />
      {fields.parent ? <BoardField title={t('Stage')} value={String(fields.stage ?? 0)} limit={2} numeric
        change={value => change({ stage: Number(value) })} /> : null}
      {!bulk ? <RelationInput title={t('Waits for')} current={fields.blockedBy ?? []} multiple exclude={item?.id}
        change={blockedBy => change({ blockedBy })} /> : null}
      {!bulk ? <RelationInput title={t('Duplicate of')} current={fields.duplicateOf ? [fields.duplicateOf] : []} exclude={item?.id}
        change={ids => change({ duplicateOf: ids[0] ?? '' })} /> : null}
    </> : null}
    {item && !bulk ? <BoardField title={t('Change note')} value={fields.reason} limit={1000} change={reason => change({ reason })} /> : null}
  </View>
}

/** Bottom-sheet container for layout, sort, saved views, secondary filters, bulk edit, and catalog management. */
export function BoardManagementSheet({ visible, onClose, catalog, filters, changeFilters, display, setDisplay, selectedView, applyView,
  readOnly, selecting, toggleSelecting, selected, onBulk, refresh, resetAll, bulkOpen, setBulkOpen }: {
  visible: boolean; onClose: () => void
  catalog?: Catalog; filters: Filters; changeFilters: (patch: Filters) => void; display: Display
  setDisplay: (next: Display) => void; choose?: Choose; selectedView: string; applyView: (view?: SavedView) => void
  readOnly: boolean; selecting: boolean; toggleSelecting: () => void; selected: Selection[]
  onBulk: (result: MutationError[]) => void; refresh: () => Promise<void>; resetAll: () => void
  bulkOpen: boolean; setBulkOpen: (open: boolean) => void
}) {
  const { p } = useTheme()
  const insets = useSafeAreaInsets()
  const { call, computer } = useTeam()
  const [section, setSection] = useState<'main' | 'filters' | 'settings'>('main')
  const [entry, setEntry] = useState<Entry | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [bulk, setBulk] = useState<(PlanFields & { priority?: number })>({})
  const [result, setResult] = useState<{ applied: string[]; rejected: MutationError[] } | null>(null)
  const [subOpts, setSubOpts] = useState<{ name: string; options: [string, string][]; select: (v: string) => void; current?: string } | null>(null)
  const [bulkOpts, setBulkOpts] = useState<{ name: string; options: [string, string][]; select: (v: string) => void; current?: string } | null>(null)
  const pending = useRef<{ key: string; id: string } | null>(null)
  const properties = catalog?.properties.filter(property => !property.archived) ?? []
  const sheetChoose: Choose = (title, choices, setter, current) =>
    setSubOpts({ name: title, options: choices, current, select: v => { setter(v); setSubOpts(null) } })
  const bulkChoose: Choose = (title, choices, setter, current) =>
    setBulkOpts({ name: title, options: choices, current, select: v => { setter(v); setBulkOpts(null) } })

  async function act(op: string, payload: object) {
    setBusy(true)
    setError('')
    try {
      const key = JSON.stringify({ op, ...payload })
      if (pending.current?.key !== key) pending.current = { key, id: Crypto.randomUUID() }
      const response = await call('board-action', { op, requestId: pending.current.id, ...payload })
      pending.current = null
      await refresh()
      return response
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return null
    } finally { setBusy(false) }
  }
  const save = async (model: Entry) => {
    const { optionText, useCurrent, ...data } = model
    if (await act('configure', { entry: {
      ...data, options: optionText === undefined ? data.options : words(optionText),
      filters: model.id && !useCurrent ? model.filters : filters,
      display: model.id && !useCurrent ? model.display : display,
    } })) setEntry(null)
  }
  const patch = (data: Partial<Entry>) => setEntry(prev => prev ? { ...prev, ...data } : null)
  const guard = readOnly || busy
  const change = (key: string) => (value: string) => changeFilters({ [key]: value })

  const optionRow = (title: string, value: string, choices: [string, string][], onPick: (v: string) => void, current = '') => (
    <Pressable
      accessibilityRole="button"
      onPress={() => sheetChoose(t(title), choices, onPick, current)}
      style={({ pressed }) => [uiStyles.sheetRow, { borderColor: p.line, backgroundColor: pressed ? p.hover : 'transparent' }]}
    >
      <Text style={[typeScale.settingsRow, { color: p.ink }]}>{t(title)}</Text>
      <Text style={[typeScale.small, { color: p.ink2 }]} numberOfLines={1}>{value}</Text>
    </Pressable>
  )

  return (
    <>
      <Modal transparent animationType="fade" visible={visible} onRequestClose={() => subOpts ? setSubOpts(null) : onClose()}>
        <View style={uiStyles.scrim}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('Close')} onPress={() => { setSubOpts(null); onClose() }} />
          <View accessibilityViewIsModal style={[uiStyles.sheet, { backgroundColor: p.card, paddingBottom: Math.max(18, insets.bottom) }, shadow(3)]}>
            <View style={[uiStyles.grab, { backgroundColor: p.line2 }]} />
            {subOpts ? (
              <>
                <View style={[uiStyles.sheetHead, { borderBottomColor: p.line, gap: 8 }]}>
                  <BoardButton compact variant="soft" title={t('Back')} onPress={() => setSubOpts(null)} />
                  <Text style={[typeScale.headerTitle, { color: p.ink, flex: 1 }]} numberOfLines={1}>{subOpts.name}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={() => { setSubOpts(null); onClose() }} style={uiStyles.closeBtn}>
                    <CloseIcon size={18} color={p.ink2} />
                  </Pressable>
                </View>
                <OptionList opts={subOpts} />
              </>
            ) : (
              <>
                <View style={[uiStyles.sheetHead, { borderBottomColor: p.line }]}>
                  <Text style={[typeScale.headerTitle, { color: p.ink, flex: 1 }]}>{t('View options')}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={onClose} style={uiStyles.closeBtn}>
                    <CloseIcon size={18} color={p.ink2} />
                  </Pressable>
                </View>
                <View style={[uiStyles.segWrap, { backgroundColor: p.bubble, marginHorizontal: 14, marginTop: 10 }]}>
                  {([['main', t('Layout')], ['filters', t('More filters')], ['settings', t('Manage board')]] as const).map(([k, label]) => {
                    const active = section === k
                    return (
                      <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: active }}
                        onPress={() => setSection(k)}
                        style={[uiStyles.segTab, active && [{ backgroundColor: p.card }, shadow(1)]]}>
                        <Text numberOfLines={1} style={[typeScale.small, { color: active ? p.ink : p.ink2, fontWeight: active ? '600' : '500' }]}>{label}</Text>
                      </Pressable>
                    )
                  })}
                </View>
                <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 14, gap: 12 }}>
                  {section === 'main' ? <>
                    <View style={{ gap: 6 }}>
                      <Text style={[typeScale.caption, { color: p.ink3, fontWeight: '600' }]}>{t('Layout')}</Text>
                      <View style={rowStyle}>
                        {Object.entries(boardLayouts).map(([k, label]) => (
                          <BoardButton key={k} compact selected={display.layout === k}
                            title={t(layoutShortLabels[k] ?? label)}
                            onPress={() => setDisplay({
                              ...display, layout: k,
                              groupBy: k === 'swimlane' && display.groupBy === 'phase' ? 'parent' : display.groupBy,
                            })} />
                        ))}
                      </View>
                    </View>
                    {catalog ? (
                      <SectionCard>
                        {optionRow('Group by', boardName(display.groupBy, 'group', catalog), [
                          ...labels({ phase: 'Status category', status: 'Task status', assignee: 'Owner', parent: 'Parent work item', label: 'Label', priority: 'Priority', source: 'Source' }),
                          ...properties.filter(pr => pr.kind === 'select').map((pr): [string, string] => ['property/' + pr.id, pr.name]),
                        ], groupBy => setDisplay({ ...display, groupBy }), display.groupBy)}
                        {optionRow('Sort by', t((boardSorts as Record<string, string>)[filters.sort || 'priority'] ?? (properties.find(pr => 'property/' + pr.id === filters.sort)?.name ?? 'Priority')), [
                          ...labels(boardSorts), ...properties.filter(pr => ['number', 'date'].includes(pr.kind)).map((pr): [string, string] => ['property/' + pr.id, pr.name]),
                        ], change('sort'), filters.sort || 'priority')}
                        {optionRow('Saved views', catalog.views.find(v => v.id === selectedView)?.name ?? t('All work'), [
                          ['', t('All work')], ...catalog.views.map((v): [string, string] => [v.id, v.name]),
                        ], id => { applyView(catalog.views.find(v => v.id === id)); onClose() }, selectedView)}
                      </SectionCard>
                    ) : null}
                    <View style={rowStyle}>
                      <BoardButton title={t(selecting ? 'Finish selecting' : 'Select work items')} selected={selecting}
                        onPress={() => { toggleSelecting(); onClose() }} />
                      {catalog ? <BoardButton title={t('Save view')} disabled={guard}
                        onPress={() => { setSection('settings'); setEntry({ kind: 'view', name: '', visibility: 'private' }) }} /> : null}
                      <BoardButton variant="soft" title={t('Clear filters')} onPress={() => { resetAll(); onClose() }} />
                    </View>
                  </> : null}

                  {section === 'filters' && catalog ? <View style={{ gap: 10 }}>
                    <View style={rowStyle}>
                      <BoardButton title={t('Owner') + ' · ' + (filters.assignee ? assigneeName(filters.assignee, catalog) : t('All owners'))}
                        selected={!!filters.assignee}
                        onPress={() => sheetChoose(t('Owner'), [['', t('All owners')], ...catalog.assignees.map((a): [string, string] => [a.id, t(a.name)])], change('assignee'), filters.assignee ?? '')} />
                      <BoardButton title={t('Task status') + ' · ' + (filters.statusId ? boardName(filters.statusId, 'status', catalog) : t('All statuses'))}
                        selected={!!filters.statusId}
                        onPress={() => sheetChoose(t('Task status'), [['', t('All statuses')],
                          ...Object.entries(manualStatuses).map(([id, status]): [string, string] => [id, t(status.name)]),
                          ...catalog.statuses.filter(s => !s.archived).map((s): [string, string] => [s.id, s.name])], change('statusId'), filters.statusId ?? '')} />
                      <BoardButton title={t('Priority') + ' · ' + (filters.priority ? t((priorities as Record<string, string>)[filters.priority]) : t('All priorities'))}
                        selected={!!filters.priority}
                        onPress={() => sheetChoose(t('Priority'), [['', t('All priorities')], ...labels(priorities)], change('priority'), filters.priority ?? '')} />
                      <BoardButton title={t('Source') + ' · ' + (filters.source ? t((sourceNames as Record<string, string>)[filters.source] ?? filters.source) : t('All sources'))}
                        selected={!!filters.source}
                        onPress={() => sheetChoose(t('Source'), [['', t('All sources')], ...labels(sourceNames)], change('source'), filters.source ?? '')} />
                    </View>
                    <BoardField title={t('Label')} value={filters.label} change={change('label')} />
                    <BoardField title={t('Start on or before') + ' · YYYY-MM-DD'} value={filters.startBefore} change={change('startBefore')} limit={10} />
                    <BoardField title={t('Due on or before') + ' · YYYY-MM-DD'} value={filters.dueBefore} change={change('dueBefore')} limit={10} />
                    <BoardButton title={t('Custom property') + ' · ' + (properties.find(pr => pr.id === filters.property)?.name ?? t('All properties'))}
                      selected={!!filters.property}
                      onPress={() => sheetChoose(t('Custom property'), [['', t('All properties')], ...properties.map((pr): [string, string] => [pr.id, pr.name])],
                        value => changeFilters({ property: value, propertyValue: '' }), filters.property ?? '')} />
                    {filters.property ? <BoardField title={t('Property value')} value={filters.propertyValue} change={change('propertyValue')} /> : null}
                    <BoardButton variant="soft" title={t('Clear filters')} onPress={() => { resetAll(); onClose() }} />
                  </View> : null}

                  {section === 'settings' && catalog ? <View style={{ gap: 10 }}>
                    <View style={rowStyle}>
                      <BoardButton variant="primary" title={t('New status')} disabled={guard} onPress={() => setEntry({ kind: 'status', name: '', phase: 'todo' })} />
                      <BoardButton variant="primary" title={t('New property')} disabled={guard} onPress={() => setEntry({ kind: 'property', name: '', propertyType: 'text' })} />
                      <BoardButton title={t('Save view')} disabled={guard} onPress={() => setEntry({ kind: 'view', name: '', visibility: 'private' })} />
                    </View>
                    {[
                      ...catalog.statuses.map(row => ({ ...row, kind: 'status' as const })),
                      ...catalog.properties.map(row => ({ ...row, propertyType: row.kind, kind: 'property' as const })),
                      ...catalog.views.map(row => ({ ...row, kind: 'view' as const, archived: false })),
                    ].map(row => <View key={row.id} style={rowStyle}>
                      <BoardButton variant="soft" title={row.name + (row.archived ? ' · ' + t('Archived') : '')} disabled={guard} onPress={() => setEntry(row)} />
                      {'visibility' in row && row.visibility === 'shared' && computer
                        ? <BoardButton title={t('Copy view link')} onPress={() => void Clipboard.setStringAsync(makeBoardViewLink(row.id, computer.hostDeviceId))} /> : null}
                    </View>)}
                    {entry ? <SectionCard>
                      <BoardField title={t('Name')} value={entry.name} limit={70} change={name => patch({ name })} />
                      {entry.kind === 'status' && !entry.id ? <BoardButton title={t('Lifecycle group') + ' · ' + t((phases as Record<string, string>)[entry.phase ?? 'todo'])}
                        onPress={() => sheetChoose(t('Lifecycle group'), labels(phases), phase => patch({ phase }), entry.phase ?? 'todo')} /> : null}
                      {entry.kind === 'property' && !entry.id ? <BoardButton title={t('Property type') + ' · ' + t((boardPropertyTypes as Record<string, string>)[entry.propertyType ?? 'text'])}
                        onPress={() => sheetChoose(t('Property type'), labels(boardPropertyTypes), propertyType => patch({ propertyType }), entry.propertyType ?? 'text')} /> : null}
                      {entry.kind === 'property' && ['select', 'multiSelect'].includes(entry.propertyType ?? '') ? <BoardField
                        title={t('Options (one per line)')} value={entry.optionText ?? entry.options?.join('\n')} multiline
                        change={optionText => patch({ optionText })} /> : null}
                      {entry.kind === 'view' ? <BoardButton title={t('Visibility') + ' · ' + t(entry.visibility === 'shared' ? 'Share by link' : 'Private')}
                        onPress={() => sheetChoose(t('Visibility'), [['private', t('Private')], ['shared', t('Share by link')]], visibility => patch({ visibility }), entry.visibility ?? 'private')} /> : null}
                      {entry.kind === 'view' && entry.id ? <BoardButton title={t('Use current filters and layout')} selected={entry.useCurrent}
                        onPress={() => patch({ useCurrent: !entry.useCurrent })} /> : null}
                      <View style={rowStyle}>
                        <BoardButton title={t('Cancel')} onPress={() => setEntry(null)} />
                        {entry.id && !entry.archived ? <BoardButton variant="danger" title={t('Archive')} disabled={guard} onPress={() => void save({ ...entry, op: 'remove' })} /> : null}
                        <BoardButton variant="primary" title={t(entry.archived ? 'Restore' : 'Save changes')} disabled={guard || !entry.name.trim()} onPress={() => void save(entry)} />
                      </View>
                    </SectionCard> : null}
                  </View> : null}
                  {error ? <Text style={[typeScale.small, { color: p.danger }]}>{error}</Text> : null}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {catalog ? <Modal transparent animationType="fade" visible={bulkOpen} onRequestClose={() => bulkOpts ? setBulkOpts(null) : setBulkOpen(false)}>
        <View style={uiStyles.scrim}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('Close')} onPress={() => { setBulkOpts(null); setBulkOpen(false) }} />
          <View accessibilityViewIsModal style={[uiStyles.sheet, { backgroundColor: p.card, paddingBottom: Math.max(18, insets.bottom) }, shadow(3)]}>
            <View style={[uiStyles.grab, { backgroundColor: p.line2 }]} />
            {bulkOpts ? (
              <>
                <View style={[uiStyles.sheetHead, { borderBottomColor: p.line, gap: 8 }]}>
                  <BoardButton compact variant="soft" title={t('Back')} onPress={() => setBulkOpts(null)} />
                  <Text style={[typeScale.headerTitle, { color: p.ink, flex: 1 }]} numberOfLines={1}>{bulkOpts.name}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={() => { setBulkOpts(null); setBulkOpen(false) }} style={uiStyles.closeBtn}>
                    <CloseIcon size={18} color={p.ink2} />
                  </Pressable>
                </View>
                <OptionList opts={bulkOpts} />
              </>
            ) : (
              <>
                <View style={[uiStyles.sheetHead, { borderBottomColor: p.line }]}>
                  <Text style={[typeScale.headerTitle, { color: p.ink, flex: 1 }]}>{t('Edit selected ({count})', { count: selected.length })}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={() => setBulkOpen(false)} style={uiStyles.closeBtn}>
                    <CloseIcon size={18} color={p.ink2} />
                  </Pressable>
                </View>
                <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 14, gap: 10 }}>
                  <BoardButton title={t('Owner') + ' · ' + (bulk.assignee ? assigneeName(bulk.assignee, catalog) : t('Choose an owner'))}
                    onPress={() => bulkChoose(t('Owner'), [['', t('Choose an owner')], ...catalog.assignees.map((a): [string, string] => [a.id, t(a.name)])],
                      assignee => setBulk(old => ({ ...old, assignee })), bulk.assignee ?? '')} />
                  <BoardButton title={t('Priority') + ' · ' + (bulk.priority == null ? t('Choose priority') : t((priorities as Record<string, string>)[bulk.priority]))}
                    onPress={() => bulkChoose(t('Priority'), [['', t('Choose priority')], ...labels(priorities)],
                      priority => setBulk(old => ({ ...old, priority: priority === '' ? undefined : Number(priority) })), bulk.priority == null ? '' : String(bulk.priority))} />
                  <BoardPlanEditor fields={bulk} change={data => setBulk(old => ({ ...old, ...data }))} catalog={catalog} choose={bulkChoose} bulk />
                  {result ? <View accessibilityLiveRegion="polite">
                    <BoardText>{t('{count} work items updated', { count: result.applied.length })}</BoardText>
                    {result.rejected.map(item => <BoardText key={item.id} faint>{item.id + ' · ' + item.reason}</BoardText>)}
                  </View> : null}
                  {error ? <Text style={[typeScale.small, { color: p.danger }]}>{error}</Text> : null}
                  <View style={rowStyle}>
                    <BoardButton title={t('Cancel')} onPress={() => setBulkOpen(false)} />
                    <BoardButton variant="primary" title={t('Apply changes')} disabled={guard || !Object.keys(bulk).length} onPress={() => void (async () => {
                      const response = await act('bulk', { items: selected, patch: bulk }) as typeof result
                      if (response) {
                        setResult(response); setBulk({}); setBulkOpen(false); onBulk(response.rejected)
                      }
                    })()} />
                  </View>
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal> : null}
    </>
  )
}

function OptionList({ opts }: { opts: { options: [string, string][]; select: (v: string) => void; current?: string } }) {
  const { p } = useTheme()
  return (
    <ScrollView contentContainerStyle={{ padding: 10, gap: 4 }}>
      {opts.options.map(([v, n]) => {
        const chosen = opts.current !== undefined && opts.current === v
        return (
          <Pressable
            key={v}
            accessibilityRole="button"
            accessibilityLabel={n}
            accessibilityState={{ selected: chosen }}
            onPress={() => opts.select(v)}
            style={({ pressed }) => [
              uiStyles.optRow,
              chosen && { backgroundColor: tint(p.accent, 0.11) },
              pressed && !chosen && { backgroundColor: p.hover },
            ]}
          >
            <Text style={[typeScale.settingsRow, { flex: 1, color: chosen ? p.accent : p.ink, fontWeight: chosen ? '600' : '400' }]}>
              {n}
            </Text>
            {chosen ? <CheckIcon size={16} color={p.accent} /> : null}
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

export function ModalOptionPicker({ opts, onClose }: {
  opts: { name: string; options: [string, string][]; select: (v: string) => void; current?: string } | null
  onClose: () => void
}) {
  const { p } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal transparent animationType="fade" visible={!!opts} onRequestClose={onClose}>
      <View style={uiStyles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('Close')} onPress={onClose} />
        <View accessibilityViewIsModal style={[uiStyles.sheet, { backgroundColor: p.card, paddingBottom: Math.max(16, insets.bottom) }, shadow(3)]}>
          <View style={[uiStyles.grab, { backgroundColor: p.line2 }]} />
          <View style={[uiStyles.sheetHead, { borderBottomColor: p.line }]}>
            <Text style={[typeScale.headerTitle, { color: p.ink, flex: 1 }]} numberOfLines={1}>{opts?.name ?? ''}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={onClose} style={uiStyles.closeBtn}>
              <CloseIcon size={18} color={p.ink2} />
            </Pressable>
          </View>
          {opts ? <OptionList opts={opts} /> : null}
        </View>
      </View>
    </Modal>
  )
}

const uiStyles = StyleSheet.create({
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, maxWidth: 160 },
  prioPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill },
  tagChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.tag },
  dot: { width: 6, height: 6, borderRadius: 3 },
  sectionCard: { borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, padding: 13, gap: 9 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.34)' },
  sheet: { maxHeight: '82%', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  grab: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginTop: 8, marginBottom: 4 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  segWrap: { flexDirection: 'row', padding: 3, borderRadius: radius.pill, gap: 2 },
  segTab: { flex: 1, minHeight: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  optRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 14, borderRadius: radius.row, gap: 10 },
})
