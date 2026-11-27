import { useCallback, useEffect, useMemo, useRef, useState, type ElementRef } from 'react'
import {
  BackHandler,
  Modal,
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
import { useTheme, type as typeScale } from '../ui/tokens.ts'
import {
  actionNames,
  activityByAttempt,
  currentReview,
  defaultFilters,
  markNames,
  phaseIcons,
  phaseNames,
  sourceNames,
  useWorkBoard,
} from '../../godbot/shared/work-board.js'

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
}
type Item = Card & {
  criteria: string
  evidence?: string
  evidenceRevision?: number
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
type Column = { phase: string; items: Card[]; total: number; next: number[] | null }
type Board = { columns: Column[]; counts: Record<string, number>; bots: Pair[]; rooms: Pair[]; readOnly: boolean }
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
}
type Options = { name: string; options: [string, string][]; select: (v: string) => void }
const name = (dict: Record<string, string>, key: string) => t(dict[key] ?? key)
const tabNames = { all: 'All work', mine: 'Needs my action', history: 'History' }
const listNames = (dict: Record<string, string>): [string, string][] =>
  Object.entries(dict).map(([k, v]) => [k, t(v)])
const pairs = (rows: Pair[]): [string, string][] => rows.map((r) => [r.id, r.name])
const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { paddingHorizontal: 14, paddingBottom: 20, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  card: { padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, marginBottom: 6, gap: 5 },
  control: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 7 },
  field: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  footer: { padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
  overlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  sheet: { maxHeight: '78%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 14 },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0005' },
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
  const { p } = useTheme(),
    insets = useSafeAreaInsets()
  const { computer, call, onFeed, online, team, hello } = useTeam()
  const discussionsSupported = useRef(false)
  if (hello) discussionsSupported.current = hello.capabilities.includes('work-board-discussion-v1')
  const params = route.params ?? {},
    device = computer?.hostDeviceId ?? ''
  const [filters, setFilters] = useState({ ...defaultFilters, ...params.filters } as typeof defaultFilters)
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
        if (live && v) setFilters({ ...defaultFilters, ...JSON.parse(v), ...params.filters })
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
      void SecureStore.setItemAsync(prefKey, JSON.stringify({ ...filters, search: '' })).catch(() => {})
  }, [filters, prefKey, prefsReady])
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
  const close = useCallback(() => {
    if (opts) {
      setOpts(null)
      return true
    }
    if (form) {
      setForm(null)
      return true
    }
    if (selected) {
      setSelected(null)
      setDiscussion(false)
      setCommentFocus(undefined)
      setTrail(false)
      return true
    }
    return false
  }, [opts, form, selected])
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => navigation.isFocused() && close())
    return () => sub.remove()
  }, [close, navigation])
  const update = (key: keyof typeof defaultFilters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }))
  const edit = (key: keyof Form, value: string | number) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : null))
  const pick = (id: string) => {
    setForm(null)
    setSelected(id)
    setDiscussion(false)
    setCommentFocus(undefined)
    setTrail(false)
    setExpandedAttempt(null)
  }
  const select = (title: string, options: [string, string][], setter: (v: string) => void) =>
    setOpts({
      name: title,
      options,
      select: (value) => {
        setter(value)
        setOpts(null)
      },
    })
  function control(title: string, press: () => void, off = false, primary = false, key = title) {
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={title}
        disabled={off}
        accessibilityState={{ disabled: off }}
        onPress={press}
        style={[styles.control, { opacity: off ? 0.5 : 1, backgroundColor: primary ? p.accent : p.hover }]}
      >
        <Text style={[typeScale.small, { color: primary ? p.accentInk : p.ink }]}>{title}</Text>
      </Pressable>
    )
  }
  const line = (s: string, small = false) => (
    <Text selectable style={[small ? typeScale.small : typeScale.settingsRow, { color: small ? p.ink2 : p.ink }]}>
      {s}
    </Text>
  )
  const owner = (id?: string) => board?.bots.find((b) => b.id === id)?.name ?? t('Unassigned')
  function start(op: string, base?: Item, child?: Child) {
    setForm({
      op,
      base,
      child,
      title: base?.title ?? '',
      criteria: base?.criteria ?? '',
      owner: op === 'transfer' ? '' : (base?.owner ?? (filters.owner === 'unassigned' ? '' : filters.owner)),
      priority: base?.priority ?? 0,
      text: '',
      origin: base?.origin,
      room: filters.room,
    })
  }
  async function submit() {
    if (!form) return
    const { op, base, child, title, criteria, owner, priority, text, origin, room } = form
    const next = (await state.act(
      {
        op,
        id: base?.id,
        version: base?.version,
        evidenceRevision: child?.evidenceRevision ?? base?.evidenceRevision,
        childId: child?.id,
        title,
        criteria,
        owner,
        priority,
        text,
        origin,
        room,
      },
      Crypto.randomUUID,
    )) as Item | null
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
  const sections = useMemo(
    () =>
      board?.columns
        .filter((c) => (!phase || c.phase === phase) && c.total > 0)
        .map((c) => ({ ...c, data: c.items })) ?? [],
    [board, phase],
  )
  const filterButton = (field: keyof typeof defaultFilters, title: string, options: [string, string][]) =>
    control(
      options.find((o) => o[0] === filters[field])?.[1] ?? t(title),
      () => select(t(title), [['', t(title)], ...options], (v) => update(field, v)),
      false,
      !!filters[field],
      field,
    )
  const report = state.error || (!online ? t('Reconnecting…') : '')
  const field = (title: string, k: 'title' | 'criteria' | 'text', multi = false) => (
    <View key={k}>
      {line(t(title), true)}
      <TextInput
        accessibilityLabel={t(title)}
        style={[styles.field, { color: p.ink, borderColor: p.line, minHeight: multi ? 80 : 46 }]}
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
    (['create', 'edit', 'dispatch'].includes(form.op) && !form.title.trim()) ||
    (form.op === 'dispatch' && (!form.owner || !form.criteria.trim())) ||
    (form.op === 'transfer' && !form.owner) ||
    ((['reject', 'note'].includes(form.op) || !!form.child) && !form.text.trim())
  return (
    <View style={[styles.screen, { backgroundColor: p.main, paddingBottom: insets.bottom }]}>
      <View style={[styles.screen, selected || form ? { display: 'none' } : null]}>
        <SheetHeader
          title={t('Work board')}
          left={{ label: t('Back'), onPress: () => navigation.goBack() }}
          right={{
            label: t('New work item'),
            disabled,
            onPress: () => start('create'),
          }}
        />
        <SectionList
          sections={sections}
          contentContainerStyle={styles.body}
          keyExtractor={(c) => c.id}
          stickySectionHeadersEnabled={false}
          ListHeaderComponent={
            <View style={{ gap: 7 }}>
              <View style={styles.row}>
                {Object.entries(tabNames).map(([id, n]) =>
                  control(
                    t(n) + ' ' + (board?.counts[id] ?? '…'),
                    () => {
                      update('tab', id)
                      setPhase('')
                    },
                    false,
                    filters.tab === id,
                    id,
                  ),
                )}
              </View>
              <TextInput
                accessibilityLabel={t('Search ID or title')}
                placeholder={t('Search ID or title')}
                placeholderTextColor={p.ink3}
                value={filters.search}
                onChangeText={(v) => update('search', v)}
                style={[styles.field, { borderColor: p.line, color: p.ink }]}
              />
              <ScrollView
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.row}
              >
                {filterButton('owner', 'All owners', [
                  ['unassigned', t('Unassigned')],
                  ...pairs(board?.bots ?? []),
                ])}
                {filterButton('room', 'All groups', pairs(board?.rooms ?? []))}
                {filterButton('source', 'All sources', listNames(sourceNames))}
                {filterButton('section', 'All sections', pairs(team?.sections ?? []))}
                {control(phase ? name(phaseNames, phase) : t('All statuses'), () =>
                  select(t('All statuses'), [['', t('All statuses')], ...listNames(phaseNames)], setPhase),
                )}
              </ScrollView>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <Text accessibilityRole="header" style={[typeScale.headerTitle, { color: p.ink, marginVertical: 8 }]}>
              {name(phaseIcons, section.phase)} {name(phaseNames, section.phase)} · {section.total}
            </Text>
          )}
          renderSectionFooter={({ section }) =>
            section.next ? control(t('Load more'), () => void state.more(section)) : null
          }
          renderItem={({ item: c }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={c.id + ' ' + c.title + ' ' + owner(c.owner) + ' ' + name(markNames, c.mark)}
              onPress={() => pick(c.id)}
              style={[styles.card, { backgroundColor: p.card, borderColor: p.line }]}
            >
              {line(c.id + (c.priority ? ' · ↑ ' + t('High') : ''), true)}
              <Text numberOfLines={2} style={[typeScale.settingsRow, { color: p.ink, fontWeight: '600' }]}>
                {c.title}
              </Text>
              <Text numberOfLines={2} style={[typeScale.small, { color: p.ink2 }]}>
                {c.hint}
              </Text>
              {line(owner(c.owner) + ' · ' + name(markNames, c.mark), true)}
            </Pressable>
          )}
          ListEmptyComponent={
            <View>
              {line(t(board ? (freshBoard ? 'No work items yet' : 'No matching work items') : 'Loading…'))}
              {board && !freshBoard
                ? control(t('Clear filters'), () => {
                    setFilters({ ...defaultFilters })
                    setPhase('')
                  })
                : null}
            </View>
          }
        />
      </View>
      {selected || form ? (
        <View style={[styles.overlay, { backgroundColor: p.main, paddingBottom: insets.bottom }]}>
          <SheetHeader
            title={form ? name(actionNames, form.op) : (item?.id ?? t('Work item'))}
            left={{ label: t('Back'), onPress: close }}
          />
          <ScrollView ref={detailScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {form ? (
              <>
                {['create', 'edit', 'dispatch'].includes(form.op) ? (
                  <>
                    {field('Title', 'title')}
                    {field('Acceptance criteria', 'criteria', true)}
                    {control(t('Priority') + ' · ' + t(form.priority ? 'High' : 'Normal'), () =>
                      edit('priority', form.priority ? 0 : 1),
                    )}
                  </>
                ) : null}
                {['create', 'edit', 'dispatch', 'transfer'].includes(form.op)
                  ? control(t('Owner') + ' · ' + owner(form.owner), () =>
                      select(
                        t('Owner'),
                        [
                          ['', t('Unassigned')],
                          ...pairs(
                            board?.bots.filter((b) => form.op !== 'transfer' || b.id !== form.base?.owner) ?? [],
                          ),
                        ],
                        (v) => edit('owner', v),
                      ),
                    )
                  : null}
                {form.op === 'dispatch'
                  ? line(
                      t(
                        form.origin?.botId === form.owner
                          ? 'Dispatch to the source conversation'
                          : 'Dispatch to a dedicated task conversation',
                      ),
                      true,
                    )
                  : null}
                {['approve', 'reject'].includes(form.op)
                  ? line(
                      t('Evidence') +
                        ' · v' +
                        (form.child?.evidenceRevision ?? form.base?.evidenceRevision) +
                        '\n' +
                        (form.child?.evidence ?? form.base?.evidence ?? ''),
                    )
                  : null}
                {form.op === 'note'
                  ? line(t('This posts a message to the source group and mentions the owner.'))
                  : null}
                {['approve', 'reject', 'note'].includes(form.op)
                  ? field(form.op === 'note' ? 'Message to the group' : 'Review feedback', 'text', true)
                  : null}
                {stale && updated ? (
                  <>
                    {line(
                      t('Evidence changed from v{old} to v{current}.', {
                        old: form.child?.evidenceRevision ?? form.base?.evidenceRevision ?? '',
                        current: updated.child?.evidenceRevision ?? updated.base?.evidenceRevision ?? '',
                      }),
                    )}
                    {control(t('Review current evidence'), () => setForm(updated), disabled)}
                  </>
                ) : stale ? (
                  line(t('This work item changed. Reopen the action to review the current evidence.'))
                ) : null}
              </>
            ) : item ? (
              <>
                <Text accessibilityRole="header" style={[typeScale.headerTitle, { color: p.ink }]}>
                  {item.title}
                </Text>
                {line(
                  name(markNames, item.mark) + ' · ' + owner(item.owner) + ' · ' + name(sourceNames, item.source),
                  true,
                )}
                <View style={styles.row} accessibilityRole="tablist">
                  {[false, true].map(show => (
                    <Pressable key={String(show)} accessibilityRole="tab" accessibilityState={{ selected: discussion === show }}
                      onPress={() => { setDiscussion(show); if (!show) setCommentFocus(undefined) }}
                      style={[styles.control, { backgroundColor: discussion === show ? p.hover : p.main }]}>
                      <Text style={[typeScale.settingsRow, { color: discussion === show ? p.accent : p.ink2 }]}>
                        {t(show ? 'Discussion' : 'Details')}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View onLayout={event => { discussionOffset.current = event.nativeEvent.layout.y }}
                  style={discussion ? undefined : { display: 'none' }}>
                  {discussionsSupported.current ? (
                    <WorkBoardDiscussion key={item.id} id={item.id} active={discussion} disabled={disabled} focus={commentFocus}
                      openExecution={original} onScroll={offset => requestAnimationFrame(() =>
                        detailScroll.current?.scrollTo({ y: discussionOffset.current + offset, animated: false }))}
                      onCompose={() => setTimeout(() => detailScroll.current?.scrollToEnd({ animated: true }), 150)} />
                  ) : line(t('Upgrade the paired host to use work item discussions.'), true)}
                </View>
                <View style={discussion ? { display: 'none' } : { gap: 8 }}>
                {line(t('Acceptance criteria') + '\n' + (item.criteria || '—'))}
                {item.evidence
                  ? line(t('Evidence') + ' · v' + item.evidenceRevision + '\n' + item.evidence)
                  : null}
                {item.hint &&
                ![item.criteria, item.evidence].some((value) => value?.replace(/\s+/g, ' ').startsWith(item.hint))
                  ? line(item.hint, true)
                  : null}
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
                    false,
                    p.id,
                  ),
                )}
                {item.dependencies.map((d) => control(d.id + ' · ' + d.title, () => pick(d.id)))}
                {item.origin ? control(t('Open source conversation'), () => original(item.origin)) : null}
                {item.execution ? control(t('Open execution conversation'), () => original(item.execution)) : null}
                {item.events.length
                  ? control(t('Activity') + ' · ' + item.events.length, () => setTrail(!trail))
                  : null}
                {trail
                  ? activityByAttempt(item.events).map((group: { attempt: number; events: Item['events'] }) => (
                      <View key={group.attempt}>
                        {group.attempt
                          ? control(t('Attempt {number}', { number: group.attempt }), () =>
                              setExpandedAttempt(expandedAttempt === group.attempt ? null : group.attempt),
                            )
                          : null}
                        {(!group.attempt || expandedAttempt === group.attempt) &&
                          group.events.map((e, i) => (
                            <View key={i}>
                              {line(
                                e.kind +
                                  ' · ' +
                                  new Date(e.at).toLocaleString() +
                                  (e.version ? ' · v' + e.version : ''),
                                true,
                              )}
                              {line(e.text)}
                              {e.execution
                                ? control(t('Open execution conversation'), () => original(e.execution))
                                : null}
                            </View>
                          ))}
                      </View>
                    ))
                  : null}
                {trail && item.eventNext ? control(t('Earlier activity'), () => void state.earlier()) : null}
                {item.children.map((c) => (
                  <View key={c.id}>
                    {line(c.target + ' · ' + c.status)}
                    {c.evidence ? line(c.evidence) : null}
                    {c.status === 'reported'
                      ? item.actions.map((op) =>
                          control(name(actionNames, op), () => start(op, item, c), disabled),
                        )
                      : null}
                  </View>
                ))}
                </View>
              </>
            ) : (
              line(t('Loading…'))
            )}
          </ScrollView>
          <View style={[styles.row, styles.footer, { borderColor: p.line }, discussion && !form && { display: 'none' }]}>
            {form
              ? control(t('Confirm'), () => void submit(), invalid, true)
              : item?.source !== 'run'
                ? item?.actions.map((op) =>
                    control(
                      name(actionNames, op),
                      () => start(op, item),
                      disabled,
                      ['dispatch', 'approve'].includes(op),
                    ),
                  )
                : null}
          </View>
        </View>
      ) : null}
      {report ? (
        <View accessibilityRole="alert" style={{ padding: 7, backgroundColor: p.card }}>
          {line(
            report +
              (state.refreshAt
                ? ' · ' + t('Last read') + ' ' + new Date(state.refreshAt).toLocaleTimeString()
                : ''),
          )}
          {control(t('Refresh'), () => void state.refresh(), !online)}
        </View>
      ) : null}
      <Modal transparent animationType="fade" visible={!!opts} onRequestClose={() => setOpts(null)}>
        <Pressable style={styles.scrim} onPress={() => setOpts(null)}>
          <View style={[styles.sheet, { backgroundColor: p.card, paddingBottom: Math.max(16, insets.bottom) }]}>
            {line(opts?.name ?? '')}
            <ScrollView>
              {opts?.options.map(([v, n]) => control(n, () => opts.select(v), false, false, v))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}
