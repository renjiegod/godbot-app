import { useCallback, useEffect, useMemo, useRef, useState, type ElementRef } from 'react'
import {
  BackHandler,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { WorkBoardDiscussion } from './work-board-discussion.tsx'
import { useTeam } from '../team/context.tsx'
import { SheetHeader } from '../nav/sheet.tsx'
import { t } from '../ui/i18n.ts'
import { GearIcon, SearchIcon } from '../ui/icons.tsx'
import { radius, shadow, useTheme, type as typeScale } from '../ui/tokens.ts'
import {
  actionNames,
  activityByAttempt,
  boardInput,
  currentReview,
  defaultFilters,
  markNames,
  phaseIcons,
  phaseNames,
  sourceNames,
  useWorkBoard,
} from '../../godbot/shared/work-board.js'
import { cardGroups, priorities, timelineBars, viewDisplay } from '../../godbot/shared/work-board-planning.js'
import {
  BoardButton,
  BoardManagementSheet,
  BoardPlanEditor,
  DateChip,
  ModalOptionPicker,
  OwnerAvatar,
  PriorityBadge,
  SectionCard,
  StatusPill,
  assigneeName,
  boardName,
  phaseTone,
  statusText,
  tint,
  type Catalog,
  type Display,
  type Filters,
  type PlanFields,
  type SavedView,
} from './work-board-management.tsx'
import { BoardArtifacts, BoardExecutions, BoardPlanningDetail, type Plan } from './work-board-detail.tsx'

type Pair = { id: string; name: string }
type Ref = { botId?: string; roomId?: string; sessionId?: string; messageId?: string; turnId?: number }
type Child = { id: string; target: string; status: string; evidenceRevision: number; evidence: string }
type Card = {
  id: string
  title: string
  owner?: string
  hint: string
  mark: string
  phase: string
  source: string
  priority: number
  version: string
  updated: number
  assignee?: string
  statusId?: string
  startDate?: string
  dueDate?: string
  labels?: string[]
}
type Item = Card & {
  criteria: string
  fields?: PlanFields
  planning?: Plan
  reviewBlocked?: boolean
  evidence?: string
  evidenceRefs?: string[]
  evidenceRevision?: number
  lifecycleState?: string
  nextActor?: string
  origin?: Ref
  execution?: Ref
  children: Child[]
  actions: string[]
  eventNext?: number
  pending: (Ref & { id: string; type: string })[]
  dependencies: { id: string; title: string }[]
  events: {
    kind: string
    at: string | number
    text: string
    attempt?: number
    version?: number
    execution?: Ref
  }[]
}
type Column = { phase: string; items: Card[]; total: number; next: (number | string)[] | null }
type Board = { columns: Column[]; counts: Record<string, number>; bots: Pair[]; rooms: Pair[]; readOnly: boolean; catalog?: Catalog }
type Form = {
  op: string
  base?: Item
  child?: Child
  title: string
  criteria: string
  owner: string
  priority: number
  text: string
  origin?: Ref
  room?: string
  fields?: PlanFields
  commentId?: string
}
type Options = { name: string; options: [string, string][]; select: (v: string) => void; current?: string }
const name = (dict: Record<string, string>, key: string) => t(dict[key] ?? key)
const tabNames = { all: 'All work', mine: 'Needs my action', history: 'History' }
const listNames = (dict: Record<string, string>): [string, string][] =>
  Object.entries(dict).map(([k, v]) => [k, t(v)])
const pairs = (rows: Pair[]): [string, string][] => rows.map((r) => [r.id, r.name])
const SECONDARY_OPS = new Set(['edit-fields', 'archive', 'reopen', 'withdraw', 'transfer'])
const DANGER_OPS = new Set(['reject', 'cancel'])

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 14, paddingBottom: 24, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  segTabs: { flexDirection: 'row', borderRadius: radius.pill, padding: 3, gap: 3 },
  segTab: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 5,
  },
  tabBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 42,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    gap: 7,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 6 },
  toolsTrigger: {
    minHeight: 42,
    minWidth: 42,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  chipsRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 2 },
  card: {
    flexDirection: 'row',
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 9,
    overflow: 'hidden',
  },
  cardStripe: { width: 4 },
  cardBody: { flex: 1, padding: 12, gap: 7 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  idChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.tag },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
  propGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  propCell: { width: '46%', minWidth: 130, gap: 3 },
  footer: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  overlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  field: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
})

export function WorkBoardScreen({ route, navigation }: any) {
  const { computer, hello } = useTeam(),
    { p } = useTheme()
  const supported = useRef<{ id?: string; supported: boolean } | null>(null)
  if (hello)
    supported.current = { id: computer?.hostDeviceId, supported: hello.capabilities.includes('work-board-v1') }
  const available = supported.current?.id === computer?.hostDeviceId && supported.current?.supported
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: p.main }]}>
      {available ? (
        <BoardContent key={computer?.hostDeviceId} route={route} navigation={navigation} />
      ) : (
        <>
          <SheetHeader title={t('Work board')} left={{ label: t('Back'), onPress: () => navigation.goBack() }} />
          <Text style={{ padding: 18, color: p.ink }}>
            {t(hello ? 'Upgrade the paired host to use the work board.' : 'Connecting…')}
          </Text>
        </>
      )}
    </SafeAreaView>
  )
}
function BoardContent({ route, navigation }: any) {
  const { p, dark } = useTheme(),
    insets = useSafeAreaInsets()
  const { computer, call, onFeed, online, team, hello } = useTeam()
  const discussionsSupported = useRef(false)
  const managementSupported = useRef(false)
  if (hello) managementSupported.current = hello.capabilities.includes('work-board-management-v1')
  if (hello) discussionsSupported.current = hello.capabilities.includes('work-board-discussion-v1')
  const params = route.params ?? {},
    device = computer?.hostDeviceId ?? ''
  const [filters, setFilters] = useState<Filters>({ ...defaultFilters, ...params.filters })
  const [display, setDisplay] = useState<Display>({ layout: 'list', groupBy: 'phase' })
  const [viewId, setViewId] = useState<string>(params.viewId ?? '')
  const [extra, setExtra] = useState('')
  const [initialRun, setInitialRun] = useState<string | undefined>(undefined)
  const [quote, setQuote] = useState<string | undefined>(undefined)
  const [selecting, setSelecting] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [checked, setChecked] = useState(() => new Map<string, string>())
  const [viewError, setViewError] = useState('')
  const loadedView = useRef('')
  const [phase, setPhase] = useState(''),
    [selected, setSelected] = useState<string | null>(params.id ?? null)
  const [discussion, setDiscussion] = useState(!!params.comment)
  const [commentFocus, setCommentFocus] = useState<string | undefined>(params.comment)
  const detailScroll = useRef<ElementRef<typeof ScrollView>>(null)
  const discussionOffset = useRef(0)
  const [opts, setOpts] = useState<Options | null>(null),
    [trail, setTrail] = useState(false)
  const [expandedAttempt, setExpandedAttempt] = useState<number | null>(null)
  const [form, setForm] = useState<Form | null>(
    params.seed
      ? {
          op: 'create',
          title: params.seed.title,
          criteria: '',
          priority: 0,
          owner: '',
          text: '',
          origin: params.seed.origin,
        }
      : null,
  )
  const [prefsReady, ready] = useState(false)
  const prefKey = 'workboard.filters.' + device.replace(/[^a-zA-Z0-9._-]/g, '_')
  useEffect(() => {
    let live = true
    void SecureStore.getItemAsync(prefKey)
      .then((v) => {
        if (live && v) {
          const saved = JSON.parse(v)
          setFilters({ ...defaultFilters, ...(saved.filters ?? saved), ...params.filters })
          if (saved.display) setDisplay(viewDisplay(saved.display))
        }
      })
      .catch(() => {})
      .finally(() => {
        if (live) ready(true)
      })
    return () => {
      live = false
    }
  }, [prefKey])
  useEffect(() => {
    if (prefsReady)
      void SecureStore.setItemAsync(prefKey, JSON.stringify({ filters: { ...filters, search: '' }, display })).catch(() => {})
  }, [filters, display, prefKey, prefsReady])
  const state = useWorkBoard({ call, subscribe: onFeed, online, identity: device, filters, selected })
  useEffect(() => {
    if (state.accessGone) {
      setForm(null)
      setTrail(false)
    }
  }, [state.accessGone])
  const board = state.view as Board | null,
    item = state.item as Item | null,
    disabled = !online || !state.reachable || !!team?.readOnly || !!board?.readOnly || state.busy || !board
  const applyView = (saved?: SavedView) => {
    setViewId(saved?.id ?? '')
    setFilters({ ...defaultFilters, ...saved?.filters })
    setDisplay(saved?.display ?? { layout: 'list', groupBy: 'phase' })
    setPhase('')
  }
  useEffect(() => {
    if (!board?.catalog || !params.viewId || !prefsReady || loadedView.current === params.viewId) return
    loadedView.current = params.viewId
    const saved = board.catalog.views.find(view => view.id === params.viewId && view.visibility === 'shared')
    if (saved) applyView(saved)
    else setViewError(t('The saved view is unavailable.'))
  }, [board?.catalog, params.viewId, prefsReady])
  const close = useCallback(() => {
    if (opts) {
      setOpts(null)
      return true
    }
    if (toolsOpen) {
      setToolsOpen(false)
      return true
    }
    if (form) {
      setForm(null)
      return true
    }
    if (selected) {
      setSelected(null)
      setDiscussion(false)
      setExtra('')
      setQuote(undefined)
      setCommentFocus(undefined)
      setTrail(false)
      return true
    }
    return false
  }, [opts, toolsOpen, form, selected])
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => navigation.isFocused() && close())
    return () => sub.remove()
  }, [close, navigation])
  const update = (key: string, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }))
  const edit = (key: keyof Form, value: string | number) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : null))
  const pick = (id: string) => {
    setForm(null)
    setSelected(id)
    setDiscussion(false)
    setExtra('')
    setInitialRun(undefined)
    setQuote(undefined)
    setCommentFocus(undefined)
    setTrail(false)
    setExpandedAttempt(null)
  }
  const select = (title: string, options: [string, string][], setter: (v: string) => void, current?: string) =>
    setOpts({
      name: title,
      options,
      current,
      select: (value) => {
        setter(value)
        setOpts(null)
      },
    })
  function control(title: string, press: () => void, off = false, primary = false, key = title, danger = false) {
    return (
      <BoardButton
        key={key}
        title={title}
        onPress={press}
        disabled={off}
        variant={primary ? 'primary' : danger ? 'danger' : 'secondary'}
      />
    )
  }
  const line = (s: string, small = false) => (
    <Text selectable style={[small ? typeScale.small : typeScale.settingsRow, { color: small ? p.ink2 : p.ink }]}>
      {s}
    </Text>
  )
  const owner = (id?: string) => board?.bots.find((b) => b.id === id)?.name ?? t('Unassigned')
  const cardOwner = (card: Card) => card.assignee ? t(assigneeName(card.assignee, board?.catalog)) : owner(card.owner)
  function start(op: string, base?: Item, child?: Child, seed?: { parent?: string; commentId?: string; title?: string }) {
    const assignee = base?.fields?.assignee
    const customValues = Object.fromEntries(Object.entries(base?.fields?.customValues ?? {})
      .filter(([id]) => board?.catalog?.properties.some(p => p.id === id && !p.archived)))

    setForm({
      op,
      base,
      child,
      title: base?.title ?? seed?.title ?? '',
      criteria: base?.criteria ?? '',
      owner: op === 'transfer' ? '' : assignee?.startsWith('bot/') ? assignee.slice(4)
        : (assignee || base?.owner || (filters.owner === 'unassigned' ? '' : filters.owner)),
      fields: op === 'edit-fields' ? { ...base?.fields, assignee: undefined, customValues, statusId: base?.statusId ?? '' }
        : seed?.parent ? { parent: seed.parent } : {},
      commentId: seed?.commentId,
      priority: base?.priority ?? 0,
      text: '',
      origin: base?.origin,
      room: filters.room,
    })
  }
  async function submit() {
    if (!form) return
    const request = boardInput(form) as Record<string, unknown>
    if (managementSupported.current && ['create', 'edit-fields', 'dispatch', 'transfer'].includes(form.op)) {
      if (/^(room|person)\//.test(form.owner)) {
        request.assignee = form.owner
        delete request.owner
      } else if (form.op === 'edit-fields' && form.base?.source === 'draft') {
        request.assignee = form.owner ? 'bot/' + form.owner : ''
      }
      if (form.op === 'edit-fields' && form.base?.source !== 'draft') delete request.assignee
    }
    const next = await state.act(request, Crypto.randomUUID) as Item | null
    if (next) pick(next.id)
  }
  function original(ref?: Ref) {
    if (!ref) return
    navigation.push('Chat', {
      kind: ref.roomId ? 'room' : 'bot',
      id: ref.roomId || ref.botId,
      boardPart: ref.sessionId,
      boardMessage: ref.messageId,
      boardTurn: ref.turnId,
      boardReference: true,
    })
  }
  function openComment(id: string, commentId: string) {
    if (id !== item?.id) pick(id)
    setExtra('')
    setDiscussion(true)
    setCommentFocus(commentId)
  }
  const runPanel = (runId?: string) => {
    setInitialRun(runId)
    setDiscussion(false)
    setExtra('runs')
  }
  const toggle = (card: Card) => setChecked(previous => {
    const next = new Map(previous)
    if (next.has(card.id)) next.delete(card.id)
    else if (next.size < 100) next.set(card.id, card.version)
    return next
  })
  const baseColumns = useMemo(() => (board?.columns ?? []).filter(c => !phase || c.phase === phase), [board?.columns, phase])
  const sections = useMemo(
    () => {
      if (display.groupBy === 'phase' && display.layout !== 'swimlane') {
        return baseColumns.filter(c => c.total > 0).map(c => ({ ...c, title: '', data: c.items }))
      }
      const groups = cardGroups(baseColumns, display.groupBy) as { key: string; items: Card[] }[]
      return groups.map(group => ({
        phase: group.key, title: boardName(group.key, display.groupBy, board?.catalog),
        items: group.items, data: display.layout === 'swimlane' ? [...group.items].sort((a, b) => a.phase.localeCompare(b.phase)) : group.items,
        total: group.items.length, next: null,
      }))
    },
    [baseColumns, display.groupBy, display.layout, board?.catalog],
  )
  const plot = useMemo(() => display.layout === 'gantt' ? timelineBars(baseColumns.flatMap(column => column.items)) : null,
    [baseColumns, display.layout])
  const highlights = useMemo(() => new Map((plot?.bars ?? []).map(bar => [bar.card.id, bar])), [plot])
  const filterChip = (field: string, title: string, options: [string, string][]) => {
    const active = !!filters[field]
    const current = options.find((o) => o[0] === filters[field])?.[1] ?? t(title)
    return (
      <BoardButton
        key={field}
        compact
        selected={active}
        title={current}
        onPress={() => select(t(title), [['', t(title)], ...options], (v) => update(field, v), filters[field] ?? '')}
      />
    )
  }
  const resetAll = () => {
    setViewId('')
    setFilters({ ...defaultFilters })
    setPhase('')
  }
  const secondaryActive = [
    filters.assignee, filters.statusId, filters.priority, filters.label, filters.startBefore, filters.dueBefore,
    filters.property, filters.sort && filters.sort !== 'priority' ? filters.sort : '',
    display.groupBy !== 'phase' ? display.groupBy : '', viewId,
  ].filter(Boolean).length
  const anyFilter = !!phase || Object.entries(filters).some(([k, v]) => k !== 'tab' && k !== 'sort' && Boolean(v))
  const report = viewError || state.error || (!online ? t('Reconnecting…') : '')
  const field = (title: string, k: 'title' | 'criteria' | 'text', multi = false) => (
    <View key={k} style={{ gap: 5 }}>
      <Text style={[typeScale.caption, { color: p.ink2, fontWeight: '500' }]}>{t(title)}</Text>
      <TextInput
        accessibilityLabel={t(title)}
        placeholderTextColor={p.ink3}
        style={[
          styles.field,
          { color: p.ink, borderColor: p.line2, backgroundColor: p.card, minHeight: multi ? 88 : 46, textAlignVertical: multi ? 'top' : 'center' },
        ]}
        value={form?.[k] ?? ''}
        onChangeText={(v) => edit(k, v)}
        multiline={multi}
        maxLength={k === 'title' ? 160 : 8000}
      />
    </View>
  )
  const stale = !!form?.base && !!item && form.base.version !== item.version
  const updated = currentReview(form, item) as Form | null
  const freshBoard =
    !phase &&
    (Object.keys(defaultFilters) as (keyof typeof defaultFilters)[]).every(
      (k) => filters[k] === defaultFilters[k],
    ) &&
    !board?.counts.history
  const invalid =
    !form ||
    disabled ||
    stale ||
    (['create', 'edit', 'edit-fields', 'dispatch'].includes(form.op) && !form.title.trim()) ||
    (form.op === 'dispatch' && (!form.owner || !form.criteria.trim())) ||
    (form.op === 'transfer' && !form.owner) ||
    ((['reject', 'note'].includes(form.op) || !!form.child) && !form.text.trim())

  const renderFormFooter = () => (
    <View style={[styles.footer, { backgroundColor: p.card, borderTopColor: p.line }, shadow(2)]}>
      <View style={{ flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
        <BoardButton title={t('Cancel')} onPress={close} />
        <BoardButton variant="primary" title={t('Confirm')} disabled={invalid} onPress={() => void submit()} />
      </View>
    </View>
  )

  const renderDetailFooter = (d: Item) => {
    const secondary = d.source !== 'run' ? d.actions.filter(op => SECONDARY_OPS.has(op)) : []
    const primary = d.source !== 'run' ? d.actions.filter(op => !SECONDARY_OPS.has(op)) : []
    return (
      <View style={[styles.footer, { backgroundColor: p.card, borderTopColor: p.line }, shadow(2)]}>
        <View style={[styles.row, { flex: 1 }]}>
          {managementSupported.current ? <BoardButton variant="soft" title={t('Edit work item')} disabled={disabled} onPress={() => start('edit-fields', d)} /> : null}
          {secondary.map(op => control(name(actionNames, op), () => start(op, d), disabled, false, op))}
        </View>
        {primary.length ? (
          <View style={styles.row}>
            {primary.map(op => control(
              name(actionNames, op),
              () => start(op, d),
              disabled,
              ['dispatch', 'approve', 'complete'].includes(op),
              op,
              DANGER_OPS.has(op),
            ))}
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <View style={[styles.screen, { backgroundColor: p.main, paddingBottom: insets.bottom }]}>
      <View style={[styles.screen, selected || form ? { display: 'none' } : null]}>
        <SheetHeader
          title={t('Work board')}
          left={{ label: t('Back'), onPress: () => navigation.goBack() }}
          right={{
            label: t('New work item'),
            disabled,
            strong: true,
            onPress: () => start('create'),
          }}
        />
        <SectionList
          sections={sections}
          contentContainerStyle={styles.body}
          keyExtractor={(c) => c.id}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View style={{ gap: 9, paddingTop: 10 }}>
              <View style={[styles.segTabs, { backgroundColor: p.bubble }]}>
                {Object.entries(tabNames).map(([id, n]) => {
                  const active = filters.tab === id
                  const count = board?.counts[id] ?? '…'
                  return (
                    <Pressable
                      key={id}
                      accessibilityRole="tab"
                      accessibilityLabel={`${t(n)} ${count}`}
                      accessibilityState={{ selected: active }}
                      onPress={() => {
                        update('tab', id)
                        setPhase('')
                      }}
                      style={[
                        styles.segTab,
                        active && [
                          { backgroundColor: p.card },
                          shadow(1),
                          dark && { borderWidth: StyleSheet.hairlineWidth, borderColor: p.line2 },
                        ],
                      ]}
                    >
                      <Text numberOfLines={1} style={[typeScale.small, { color: active ? p.ink : p.ink2, fontWeight: active ? '600' : '500', flexShrink: 1 }]}>
                        {t(n)}
                      </Text>
                      <View style={[styles.tabBadge, { backgroundColor: active ? tint(p.accent, 0.14) : p.tagBg }]}>
                        <Text style={[typeScale.caption, { color: active ? p.accent : p.ink2, fontWeight: '600' }]}>
                          {count}
                        </Text>
                      </View>
                    </Pressable>
                  )
                })}
              </View>
              <View style={styles.searchRow}>
                <View style={[styles.searchWrap, { backgroundColor: p.card, borderColor: p.line2 }]}>
                  <SearchIcon size={16} color={p.ink3} />
                  <TextInput
                    accessibilityLabel={t('Search work and comments')}
                    placeholder={t('Search work and comments')}
                    placeholderTextColor={p.ink3}
                    value={filters.search}
                    onChangeText={(v) => update('search', v)}
                    style={[styles.searchInput, { color: p.ink }]}
                  />
                  {filters.search ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={t('Clear')} onPress={() => update('search', '')} hitSlop={8}>
                      <Text style={{ color: p.ink2, fontSize: 15, paddingHorizontal: 4 }}>×</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('View options')}
                  onPress={() => setToolsOpen(true)}
                  style={[
                    styles.toolsTrigger,
                    {
                      backgroundColor: secondaryActive > 0 ? tint(p.accent, 0.12) : p.card,
                      borderColor: secondaryActive > 0 ? p.accent : p.line2,
                    },
                  ]}
                >
                  <GearIcon size={17} color={secondaryActive > 0 ? p.accent : p.ink2} />
                  {secondaryActive > 0 ? (
                    <Text style={[typeScale.caption, { color: p.accent, fontWeight: '600' }]}>{secondaryActive}</Text>
                  ) : null}
                </Pressable>
              </View>
              <ScrollView
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
              >
                <BoardButton
                  compact
                  selected={!!phase}
                  title={phase ? name(phaseNames, phase) : t('All statuses')}
                  onPress={() => select(t('All statuses'), [['', t('All statuses')], ...listNames(phaseNames)], setPhase, phase)}
                />
                {filterChip('owner', 'All owners', [
                  ['unassigned', t('Unassigned')],
                  ...pairs(board?.bots ?? []),
                ])}
                {filterChip('room', 'All groups', pairs(board?.rooms ?? []))}
                {filterChip('source', 'All sources', listNames(sourceNames))}
                {filterChip('section', 'All sections', pairs(team?.sections ?? []))}
                {anyFilter ? <BoardButton compact variant="soft" title={t('Clear filters')} onPress={resetAll} /> : null}
              </ScrollView>
              {selecting ? (
                <View style={[styles.row, { padding: 10, borderRadius: radius.row, backgroundColor: tint(p.accent, 0.1) }]}>
                  <Text style={[typeScale.small, { color: p.ink, fontWeight: '600', flex: 1 }]}>
                    {t('Selected') + ': ' + checked.size}
                  </Text>
                  {checked.size ? <BoardButton compact variant="primary" title={t('Edit selected ({count})', { count: checked.size })}
                    disabled={disabled} onPress={() => setBulkOpen(true)} /> : null}
                  <BoardButton compact title={t('Finish selecting')} onPress={() => { setSelecting(false); setChecked(new Map()) }} />
                </View>
              ) : null}
              {plot?.first ? line(plot.first + ' → ' + plot.last, true) : null}
            </View>
          }
          renderSectionHeader={({ section }) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 6 }}>
              <Text style={[typeScale.small, { color: phaseTone(section.phase, p), fontWeight: '700' }]}>
                {name(phaseIcons, section.phase)}
              </Text>
              <Text accessibilityRole="header" style={[typeScale.headerTitle, { color: p.ink, flex: 1 }]}>
                {section.title || name(phaseNames, section.phase)}
              </Text>
              <View style={[styles.tabBadge, { backgroundColor: p.tagBg }]}>
                <Text style={[typeScale.caption, { color: p.ink2, fontWeight: '600' }]}>{section.total}</Text>
              </View>
            </View>
          )}
          renderSectionFooter={({ section }) =>
            section.next ? <BoardButton variant="soft" title={t('Load more')} onPress={() => void state.more(section)} /> : null
          }
          ListFooterComponent={display.groupBy !== 'phase' || display.layout === 'swimlane' ? <View style={styles.row}>
            {baseColumns.filter(column => column.next).map(column => control(t('Load more') + ' · ' + name(phaseNames, column.phase),
              () => void state.more(column), false, false, column.phase))}
          </View> : undefined}
          renderItem={({ item: c }) => {
            const isPicked = checked.has(c.id)
            const tone = phaseTone(c.phase, p)
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={c.id + ' ' + c.title + ' ' + cardOwner(c) + ' ' + name(markNames, c.mark)}
                accessibilityState={{ selected: isPicked }}
                onPress={() => selecting ? toggle(c) : pick(c.id)}
                style={({ pressed }) => [
                  styles.card,
                  shadow(1),
                  {
                    backgroundColor: pressed ? p.hover : p.card,
                    borderColor: isPicked ? p.accent : p.line,
                    borderWidth: isPicked ? 1.5 : StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={[styles.cardStripe, { backgroundColor: tone }]} />
                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={[styles.idChip, { backgroundColor: p.bubble }]}>
                        <Text style={[typeScale.caption, { color: p.ink2, fontWeight: '600' }]}>{c.id}</Text>
                      </View>
                      <Text style={[typeScale.caption, { color: p.ink3 }]}>{name(sourceNames, c.source)}</Text>
                    </View>
                    <PriorityBadge priority={c.priority} />
                  </View>
                  <Text numberOfLines={2} style={[typeScale.rowName, { color: p.ink, fontWeight: '600' }]}>
                    {c.title}
                  </Text>
                  {c.hint ? (
                    <Text numberOfLines={2} style={[typeScale.small, { color: p.ink2 }]}>
                      {c.hint}
                    </Text>
                  ) : null}
                  {c.labels?.length || c.dueDate || c.startDate ? (
                    <View style={styles.row}>
                      {c.dueDate ? <DateChip value={c.dueDate} phase={c.phase} /> : c.startDate ? <DateChip value={c.startDate} phase={c.phase} prefix="start" /> : null}
                      {(c.labels ?? []).slice(0, 3).map((tag, i) => (
                        <View key={i} style={[styles.idChip, { backgroundColor: p.tagBg }]}>
                          <Text style={[typeScale.caption, { color: p.tagInk }]}>{tag}</Text>
                        </View>
                      ))}
                      {(c.labels?.length ?? 0) > 3 ? (
                        <View style={[styles.idChip, { backgroundColor: p.tagBg }]}>
                          <Text style={[typeScale.caption, { color: p.tagInk }]}>+{(c.labels?.length ?? 0) - 3}</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  <View style={[styles.cardFoot, { borderTopColor: p.line }]}>
                    <View style={styles.ownerRow}>
                      <OwnerAvatar target={c} bots={team?.bots ?? []} rooms={team?.rooms ?? []} catalog={board?.catalog} size={20} />
                      <Text numberOfLines={1} style={[typeScale.caption, { color: p.ink2, flexShrink: 1 }]}>
                        {cardOwner(c)}
                      </Text>
                    </View>
                    <StatusPill phase={c.phase} label={statusText(c, board?.catalog)} />
                  </View>
                  {display.layout === 'table' ? line([c.startDate, c.dueDate, name(phaseNames, c.phase)].filter(Boolean).join(' · '), true) : null}
                  {display.layout === 'swimlane' ? line(name(phaseNames, c.phase), true) : null}
                  {display.layout === 'gantt' && highlights.has(c.id) ? <>
                    {line([c.startDate, c.dueDate].filter(Boolean).join(' – '), true)}
                    <View style={{ height: 8, backgroundColor: p.bubble, borderRadius: 4, overflow: 'hidden' }}>
                      <View style={{
                        height: 8, backgroundColor: tone, borderRadius: 4,
                        marginLeft: (100 * (highlights.get(c.id)?.left ?? 0)) + '%',
                        width: (100 * (highlights.get(c.id)?.width ?? 0)) + '%',
                      } as never} />
                    </View>
                  </> : null}
                </View>
              </Pressable>
            )
          }}
          ListEmptyComponent={
            <SectionCard>
              <View style={{ alignItems: 'center', gap: 10, paddingVertical: 14 }}>
                {line(t(board ? (freshBoard ? 'No work items yet' : 'No matching work items') : 'Loading…'))}
                {board && !freshBoard
                  ? <BoardButton title={t('Clear filters')} onPress={resetAll} />
                  : null}
              </View>
            </SectionCard>
          }
        />
      </View>
      {selected || form ? (
        <View style={[styles.overlay, { backgroundColor: p.main, paddingBottom: insets.bottom }]}>
          <SheetHeader
            title={form ? name(actionNames, form.op) : (item?.id ?? t('Work item'))}
            left={{ label: t('Back'), onPress: close }}
          />
          <ScrollView ref={detailScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.body, { paddingTop: 12 }]}>
            {form ? (
              <>
                {['create', 'edit', 'edit-fields', 'dispatch'].includes(form.op) ? (
                  <SectionCard>
                    {field('Title', 'title')}
                    {field('Acceptance criteria', 'criteria', true)}
                    <BoardButton title={t('Priority') + ' · ' + t((priorities as Record<string, string>)[form.priority])}
                      onPress={() => select(t('Priority'), listNames(priorities), v => edit('priority', Number(v)), String(form.priority))} />
                  </SectionCard>
                ) : null}
                {(['create', 'edit', 'dispatch', 'transfer'].includes(form.op) || form.op === 'edit-fields' && form.base?.source === 'draft')
                  ? <SectionCard>
                      <BoardButton title={t('Owner') + ' · ' + (form.owner.includes('/') ? assigneeName(form.owner, board?.catalog) : owner(form.owner))}
                        onPress={() => select(t('Owner'), [['', t('Unassigned')], ...(managementSupported.current && board?.catalog
                          ? board.catalog.assignees.filter(a => !['dispatch', 'transfer'].includes(form.op) || a.kind !== 'person')
                            .map((a): [string, string] => [a.kind === 'bot' ? a.id.slice(4) : a.id, t(a.name)])
                          : pairs(board?.bots ?? []))], v => edit('owner', v), form.owner)} />
                    </SectionCard>
                  : null}
                {managementSupported.current && ['create', 'edit-fields'].includes(form.op)
                  ? <SectionCard>
                      <BoardPlanEditor key={form.base?.id ?? 'create'} fields={form.fields ?? {}} catalog={board?.catalog}
                        choose={select} item={form.base} change={data => setForm(old => old ? { ...old, fields: { ...old.fields, ...data } } : null)} />
                    </SectionCard>
                  : null}

                {form.op === 'dispatch'
                  ? <View style={{ padding: 11, borderRadius: radius.row, borderLeftWidth: 3, borderLeftColor: p.accent, backgroundColor: tint(p.accent, 0.1) }}>
                      <Text style={[typeScale.small, { color: p.ink }]}>
                        {t(form.origin?.botId === form.owner ? 'Dispatch to the source conversation' : 'Dispatch to a dedicated task conversation')}
                      </Text>
                    </View>
                  : null}
                {['approve', 'reject'].includes(form.op)
                  ? <SectionCard title={t('Evidence')} badge={'v' + (form.child?.evidenceRevision ?? form.base?.evidenceRevision)}>
                      {line(form.child?.evidence ?? form.base?.evidence ?? '')}
                    </SectionCard>
                  : null}
                {form.op === 'note'
                  ? line(t('This posts a message to the source group and mentions the owner.'), true)
                  : null}
                {['approve', 'reject', 'note'].includes(form.op)
                  ? <SectionCard>{field(form.op === 'note' ? 'Message to the group' : 'Review feedback', 'text', true)}</SectionCard>
                  : null}
                {stale && updated ? (
                  <SectionCard>
                    <Text style={[typeScale.small, { color: p.danger }]}>
                      {t('Evidence changed from v{old} to v{current}.', {
                        old: form.child?.evidenceRevision ?? form.base?.evidenceRevision ?? '',
                        current: updated.child?.evidenceRevision ?? updated.base?.evidenceRevision ?? '',
                      })}
                    </Text>
                    <BoardButton variant="primary" title={t('Review current evidence')} disabled={disabled} onPress={() => setForm(updated)} />
                  </SectionCard>
                ) : stale ? (
                  <SectionCard>
                    <Text style={[typeScale.small, { color: p.danger }]}>
                      {t('This work item changed. Reopen the action to review the current evidence.')}
                    </Text>
                  </SectionCard>
                ) : null}
              </>
            ) : item ? (
              <>
                <SectionCard>
                  <View style={styles.row}>
                    <StatusPill phase={item.phase} label={statusText(item, board?.catalog)} />
                    <PriorityBadge priority={item.priority} showNormal />
                    <View style={[styles.idChip, { backgroundColor: p.tagBg }]}>
                      <Text style={[typeScale.caption, { color: p.tagInk }]}>{name(sourceNames, item.source)}</Text>
                    </View>
                  </View>
                  <Text accessibilityRole="header" style={[typeScale.headerTitle, { color: p.ink, fontSize: 19, lineHeight: 26 }]}>
                    {item.title}
                  </Text>
                  <View style={styles.row}>
                    <OwnerAvatar target={item} bots={team?.bots ?? []} rooms={team?.rooms ?? []} catalog={board?.catalog} size={22} />
                    <Text style={[typeScale.small, { color: p.ink2, fontWeight: '500' }]}>{cardOwner(item)}</Text>
                    <Text style={[typeScale.caption, { color: p.ink3, marginLeft: 'auto' }]}>
                      {new Date(item.updated).toLocaleString()}
                    </Text>
                  </View>
                </SectionCard>
                <View style={[styles.segTabs, { backgroundColor: p.bubble }]} accessibilityRole="tablist">
                  {(managementSupported.current ? ['Details', 'Discussion', 'Runs', 'Artifacts'] : ['Details', 'Discussion']).map(tab => {
                    const active = tab === (discussion ? 'Discussion' : extra === 'runs' ? 'Runs' : extra === 'artifacts' ? 'Artifacts' : 'Details')
                    return (
                      <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: active }}
                        onPress={() => {
                          setDiscussion(tab === 'Discussion')
                          setExtra(tab === 'Runs' ? 'runs' : tab === 'Artifacts' ? 'artifacts' : '')
                          setInitialRun(undefined)
                          if (tab !== 'Discussion') { setCommentFocus(undefined); setQuote(undefined) }
                        }}
                        style={[
                          styles.segTab,
                          active && [{ backgroundColor: p.card }, shadow(1), dark && { borderWidth: StyleSheet.hairlineWidth, borderColor: p.line2 }],
                        ]}>
                        <Text style={[typeScale.small, { color: active ? p.ink : p.ink2, fontWeight: active ? '600' : '500' }]}>{t(tab)}</Text>
                      </Pressable>
                    )
                  })}
                </View>
                <View onLayout={event => { discussionOffset.current = event.nativeEvent.layout.y }}
                  style={discussion ? undefined : { display: 'none' }}>
                  {discussionsSupported.current ? (
                    <WorkBoardDiscussion key={item.id} id={item.id} active={discussion} disabled={disabled} focus={commentFocus}
                      openExecution={original} openRun={managementSupported.current ? runPanel : undefined} quote={quote}
                      openComment={commentId => openComment(item.id, commentId)}
                      createSubtask={managementSupported.current ? entry => start('create', undefined, undefined, {
                        parent: item.id, commentId: entry.id, title: entry.body.split('\n')[0].slice(0, 110),
                      }) : undefined}
                      onScroll={offset => requestAnimationFrame(() =>
                        detailScroll.current?.scrollTo({ y: discussionOffset.current + offset, animated: false }))}
                      onCompose={() => setTimeout(() => detailScroll.current?.scrollToEnd({ animated: true }), 150)} />
                  ) : line(t('Upgrade the paired host to use work item discussions.'), true)}
                </View>
                {extra === 'runs' ? <BoardExecutions key={item.id + '/' + initialRun} id={item.id}
                  initialRun={initialRun} readOnly={disabled} open={original} openComment={openComment}
                  modify={async change => Boolean(await state.act({ ...change, id: item.id, version: item.version }, Crypto.randomUUID))} /> : null}
                {extra === 'artifacts' ? <BoardArtifacts key={item.id} id={item.id} choose={select} openComment={openComment} /> : null}
                <View style={discussion || extra ? { display: 'none' } : { gap: 10 }}>
                  <SectionCard title={t('Properties')}>
                    <View style={styles.propGrid}>
                      <View style={styles.propCell}>
                        <Text style={[typeScale.caption, { color: p.ink3 }]}>{t('Owner')}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <OwnerAvatar target={item} bots={team?.bots ?? []} rooms={team?.rooms ?? []} catalog={board?.catalog} size={18} />
                          <Text numberOfLines={1} style={[typeScale.small, { color: p.ink, flexShrink: 1 }]}>{cardOwner(item)}</Text>
                        </View>
                      </View>
                      <View style={styles.propCell}>
                        <Text style={[typeScale.caption, { color: p.ink3 }]}>{t('Task status')}</Text>
                        <View style={{ alignItems: 'flex-start' }}>
                          <StatusPill phase={item.phase} label={statusText(item, board?.catalog)} />
                        </View>
                      </View>
                      <View style={styles.propCell}>
                        <Text style={[typeScale.caption, { color: p.ink3 }]}>{t('Priority')}</Text>
                        <View style={{ alignItems: 'flex-start' }}>
                          <PriorityBadge priority={item.priority} showNormal />
                        </View>
                      </View>
                      <View style={styles.propCell}>
                        <Text style={[typeScale.caption, { color: p.ink3 }]}>{t('Source')}</Text>
                        <Text style={[typeScale.small, { color: p.ink }]}>{name(sourceNames, item.source)}</Text>
                      </View>
                      {item.fields?.startDate ? (
                        <View style={styles.propCell}>
                          <Text style={[typeScale.caption, { color: p.ink3 }]}>{t('Start date')}</Text>
                          <View style={{ alignItems: 'flex-start' }}><DateChip value={item.fields.startDate} phase={item.phase} prefix="start" /></View>
                        </View>
                      ) : null}
                      {item.fields?.dueDate ? (
                        <View style={styles.propCell}>
                          <Text style={[typeScale.caption, { color: p.ink3 }]}>{t('Due date')}</Text>
                          <View style={{ alignItems: 'flex-start' }}><DateChip value={item.fields.dueDate} phase={item.phase} /></View>
                        </View>
                      ) : null}
                      {(board?.catalog?.properties ?? [])
                        .filter(prop => !prop.archived && item.fields?.customValues && prop.id in item.fields.customValues)
                        .map(prop => {
                          const val = item.fields?.customValues?.[prop.id]
                          const fmt = (v: unknown) => ['person', 'people'].includes(prop.kind) ? assigneeName(String(v), board?.catalog) : String(v)
                          return (
                            <View key={prop.id} style={styles.propCell}>
                              <Text style={[typeScale.caption, { color: p.ink3 }]}>{prop.name}</Text>
                              <Text style={[typeScale.small, { color: p.ink }]}>{Array.isArray(val) ? val.map(fmt).join(', ') : fmt(val)}</Text>
                            </View>
                          )
                        })}
                    </View>
                    {item.fields?.labels?.length ? (
                      <View style={[styles.row, { paddingTop: 4 }]}>
                        {item.fields.labels.map((tag, i) => (
                          <View key={i} style={[styles.idChip, { backgroundColor: p.tagBg }]}>
                            <Text style={[typeScale.caption, { color: p.tagInk }]}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </SectionCard>
                  {managementSupported.current ? <BoardPlanningDetail key={item.id} item={item} readOnly={disabled} catalog={board?.catalog}
                    open={pick} openComment={openComment} annotate={text => { setQuote(text); setDiscussion(true); setExtra('') }}
                    add={() => start('create', undefined, undefined, { parent: item.id })} /> : null}
                  <SectionCard title={t('Acceptance criteria')}>
                    {line(item.criteria || '—')}
                  </SectionCard>
                  {item.evidence ? (
                    <SectionCard title={t('Evidence')} badge={'v' + item.evidenceRevision}>
                      {line(item.evidence)}
                      {item.evidenceRefs?.map(ref => <View key={ref}>{line(ref, true)}</View>)}
                    </SectionCard>
                  ) : null}
                  {item.lifecycleState && item.nextActor && !['done', 'cancelled'].includes(item.lifecycleState)
                    ? line(t('Next action by {name}', { name: item.nextActor === 'user' ? t('You')
                      : item.nextActor === 'host' ? 'Godbot' : owner(item.nextActor) }), true)
                    : null}
                  {item.hint &&
                  ![item.criteria, item.evidence].some((value) => value?.replace(/\s+/g, ' ').startsWith(item.hint)) ? (
                    <View style={{ padding: 11, borderRadius: radius.row, borderLeftWidth: 3, borderLeftColor: p.accent, backgroundColor: tint(p.accent, 0.1) }}>
                      {line(item.hint, true)}
                    </View>
                  ) : null}
                  {(item.pending.length || item.dependencies.length || item.origin || item.execution) ? (
                    <SectionCard title={t('Links & conversations')}>
                      <View style={styles.row}>
                        {item.pending.map((p) =>
                          control(
                            t(p.type === 'question' ? 'Answer question' : 'Review approval'),
                            async () => {
                              if (p.botId && p.sessionId)
                                await call('bot-open-part', { botId: p.botId, sessionId: p.sessionId })
                                  .then(() => navigation.push('Chat', { kind: 'bot', id: p.botId }))
                                  .catch(() => void state.refresh())
                              else if (p.roomId) navigation.push('Chat', { kind: 'room', id: p.roomId })
                            },
                            disabled,
                            true,
                            p.id,
                          ),
                        )}
                        {item.dependencies.map((d) => <BoardButton key={d.id} variant="soft" title={d.id + ' · ' + d.title} onPress={() => pick(d.id)} />)}
                        {item.origin ? <BoardButton variant="soft" title={t('Open source conversation')} onPress={() => original(item.origin)} /> : null}
                        {item.execution ? <BoardButton variant="soft" title={t('Open execution conversation')} onPress={() => original(item.execution)} /> : null}
                      </View>
                    </SectionCard>
                  ) : null}
                  {item.children.length ? (
                    <SectionCard title={t('Team run')} badge={String(item.children.length)}>
                      {item.children.map((c) => (
                        <View key={c.id} style={{ gap: 6, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={[typeScale.small, { color: p.ink, fontWeight: '600' }]}>{c.target}</Text>
                            <StatusPill phase={c.status === 'reported' ? 'review' : c.status === 'completed' ? 'done' : 'doing'} label={c.status} />
                          </View>
                          {c.evidence ? line(c.evidence) : null}
                          {c.status === 'reported' ? (
                            <View style={styles.row}>
                              {item.actions.map((op) => control(
                                name(actionNames, op),
                                () => start(op, item, c),
                                disabled,
                                ['approve', 'dispatch'].includes(op),
                                op,
                                DANGER_OPS.has(op),
                              ))}
                            </View>
                          ) : null}
                        </View>
                      ))}
                    </SectionCard>
                  ) : null}
                  {item.events.length ? (
                    <SectionCard
                      title={t('Activity')}
                      badge={String(item.events.length)}
                      right={<BoardButton compact variant="soft" selected={trail} title={t(trail ? 'Collapse' : 'View')} onPress={() => setTrail(!trail)} />}
                    >
                      {trail
                        ? activityByAttempt(item.events).map((group: { attempt: number; events: Item['events'] }) => (
                            <View key={group.attempt} style={{ gap: 6 }}>
                              {group.attempt
                                ? <BoardButton variant="soft" selected={expandedAttempt === group.attempt}
                                    title={t('Attempt {number}', { number: group.attempt })}
                                    onPress={() => setExpandedAttempt(expandedAttempt === group.attempt ? null : group.attempt)} />
                                : null}
                              {(!group.attempt || expandedAttempt === group.attempt) &&
                                group.events.map((e, i) => (
                                  <View key={i} style={{ gap: 4, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: p.line2 }}>
                                    {line(
                                      e.kind +
                                        ' · ' +
                                        new Date(e.at).toLocaleString() +
                                        (e.version ? ' · v' + e.version : ''),
                                      true,
                                    )}
                                    {line(e.text)}
                                    {e.execution
                                      ? <BoardButton compact variant="soft" title={t('Open execution conversation')} onPress={() => original(e.execution)} />
                                      : null}
                                  </View>
                                ))}
                            </View>
                          ))
                        : null}
                      {trail && item.eventNext ? <BoardButton variant="soft" title={t('Earlier activity')} onPress={() => void state.earlier()} /> : null}
                    </SectionCard>
                  ) : null}
                </View>
              </>
            ) : (
              line(t('Loading…'))
            )}
          </ScrollView>
          {form ? renderFormFooter() : item && !(discussion || extra) ? renderDetailFooter(item) : null}
        </View>
      ) : null}
      {report ? (
        <View accessibilityRole="alert" style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: p.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={[typeScale.small, { color: p.danger, flex: 1 }]}>
            {report +
              (state.refreshAt
                ? ' · ' + t('Last read') + ' ' + new Date(state.refreshAt).toLocaleTimeString()
                : '')}
          </Text>
          <BoardButton compact title={t('Refresh')} disabled={!online} onPress={() => void state.refresh()} />
        </View>
      ) : null}
      <BoardManagementSheet
        visible={toolsOpen}
        onClose={() => setToolsOpen(false)}
        catalog={board?.catalog}
        filters={filters}
        changeFilters={patch => setFilters(old => ({ ...old, ...patch }))}
        display={display}
        setDisplay={setDisplay}
        selectedView={viewId}
        applyView={applyView}
        readOnly={disabled}
        selecting={selecting}
        toggleSelecting={() => { setSelecting(!selecting); setChecked(new Map()) }}
        selected={Array.from(checked, ([id, version]) => ({ id, version }))}
        refresh={state.refresh}
        resetAll={resetAll}
        bulkOpen={bulkOpen}
        setBulkOpen={setBulkOpen}
        onBulk={rejected => setChecked(old => {
          const retained = new Map<string, string>()
          for (const { id } of rejected) {
            const version = old.get(id)
            if (version) retained.set(id, version)
          }
          return retained
        })}
      />
      <ModalOptionPicker opts={opts} onClose={() => setOpts(null)} />
    </View>
  )
}
