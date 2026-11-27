import { useRef, useState, type ReactNode } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as Crypto from 'expo-crypto'
import { useTeam } from '../team/context.tsx'
import { makeBoardViewLink } from '../team/work-board-link.ts'
import { t } from '../ui/i18n.ts'
import { useTheme, type as typeScale } from '../ui/tokens.ts'
import { useBoardLookup } from '../../godbot/shared/work-board.js'
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
export type Choose = (title: string, options: [string, string][], setter: (value: string) => void) => void
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

export function BoardButton({ title, onPress, disabled = false, selected = false }: {
  title: string; onPress: () => void; disabled?: boolean; selected?: boolean
}) {
  const { p } = useTheme()
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled, selected }}
    onPress={onPress} disabled={disabled} style={{
      minHeight: 46, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 7,
      backgroundColor: p.hover, opacity: disabled ? 0.55 : 1,
    }}>
    <Text style={[typeScale.small, { color: selected ? p.accent : p.ink }]}>{title}</Text>
  </Pressable>
}

export function BoardText({ children, faint = false }: { children: ReactNode; faint?: boolean }) {
  const { p } = useTheme()
  return <Text selectable style={[faint ? typeScale.small : typeScale.settingsRow, { color: faint ? p.ink2 : p.ink }]}>{children}</Text>
}

export function BoardField({ title, value, change, multiline = false, numeric = false, limit }: {
  title: string; value?: string; change: (value: string) => void; multiline?: boolean; numeric?: boolean; limit?: number
}) {
  const { p } = useTheme()
  return <View style={{ gap: 4 }}>
    <BoardText faint>{title}</BoardText>
    <TextInput accessibilityLabel={title} value={value ?? ''} onChangeText={change} multiline={multiline}
      keyboardType={numeric ? 'numbers-and-punctuation' : 'default'} maxLength={limit}
      style={{ borderWidth: 1, borderColor: p.line, borderRadius: 7, color: p.ink,
        paddingHorizontal: 10, paddingVertical: 8, minHeight: multiline ? 72 : 46 }} />
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
  return <View style={{ gap: 5 }}>
    <BoardField title={title} value={search} change={setSearch} limit={160} />
    <View style={rowStyle}>
      {current.map(id => <BoardButton key={id} title={id + ' ×'} onPress={() => change(current.filter(value => value !== id))} />)}
    </View>
    {items.filter(item => item.id !== exclude && !current.includes(item.id)).map(item =>
      <BoardButton key={item.id} title={item.id + ' · ' + item.title} onPress={() => {
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
      onPress={() => choose(property.name, [['', t('Not set')], ...choices], v => change(v || null))} />
  if (property.kind === 'multiSelect' || property.kind === 'people') {
    const picked = Array.isArray(value) ? value : []
    return <View style={{ gap: 5 }}><BoardText faint>{property.name}</BoardText><View style={rowStyle}>
      {choices.map(([id, name]) => <BoardButton key={id} title={name} selected={picked.includes(id)}
        onPress={() => change(picked.includes(id) ? picked.filter(v => v !== id) : [...picked, id])} />)}
    </View></View>
  }
  if (property.kind === 'checkbox') return <BoardButton title={property.name + ' · ' + t(value == null ? 'Not set' : value ? 'Yes' : 'No')}
    onPress={() => choose(property.name, [['', t('Not set')], ['true', t('Yes')], ['false', t('No')]],
      v => change(v === '' ? null : v === 'true'))} />
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
  return <View style={{ gap: 8 }}>
    {!bulk && <BoardField title={t('Task description')} value={fields.description} multiline limit={16000}
      change={description => change({ description })} />}
    <BoardButton title={t('Task status') + ' · ' + (statusOptions.find(([id]) => id === fields.statusId)?.[1] ?? t('Default status'))}
      onPress={() => choose(t('Task status'), statusOptions, statusId => change({ statusId }))} />
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

export function BoardManagement({ catalog, filters, changeFilters, display, setDisplay, choose, selectedView, applyView,
  readOnly, selecting, toggleSelecting, selected, onBulk, refresh }: {
  catalog: Catalog; filters: Filters; changeFilters: (patch: Filters) => void; display: Display
  setDisplay: (next: Display) => void; choose: Choose; selectedView: string; applyView: (view?: SavedView) => void
  readOnly: boolean; selecting: boolean; toggleSelecting: () => void; selected: Selection[]
  onBulk: (result: MutationError[]) => void; refresh: () => Promise<void>
}) {
  const { call, computer } = useTeam()
  const [expanded, setExpanded] = useState('')
  const [entry, setEntry] = useState<Entry | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [bulk, setBulk] = useState<(PlanFields & { priority?: number }) | null>(null)
  const [result, setResult] = useState<{ applied: string[]; rejected: MutationError[] } | null>(null)
  const pending = useRef<{ key: string; id: string } | null>(null)
  const properties = catalog.properties.filter(property => !property.archived)
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
  const buttonPick = (label: string, value: string, choices: [string, string][], onPick: (value: string) => void) => (
    <BoardButton title={t(label) + ' · ' + (choices.find(([id]) => id === value)?.[1] ?? t('Not set'))}
      onPress={() => choose(t(label), choices, onPick)} />
  )
  const change = (key: string) => (value: string) => changeFilters({ [key]: value })
  return <View style={{ gap: 8 }}>
    <View style={rowStyle}>
      {buttonPick('Layout', display.layout, labels(boardLayouts), layout => setDisplay({ ...display, layout, groupBy: layout === 'swimlane' && display.groupBy === 'phase' ? 'parent' : display.groupBy }))}
      {buttonPick('Group by', display.groupBy, [
        ...labels({ phase: 'Status category', status: 'Task status', assignee: 'Owner', parent: 'Parent work item', label: 'Label', priority: 'Priority', source: 'Source' }),
        ...properties.filter(p => p.kind === 'select').map((p): [string, string] => ['property/' + p.id, p.name]),
      ], groupBy => setDisplay({ ...display, groupBy }))}
      {buttonPick('Sort by', filters.sort || 'priority', [...labels(boardSorts), ...properties.filter(p => ['number', 'date'].includes(p.kind))
        .map((p): [string, string] => ['property/' + p.id, p.name])], change('sort'))}
      {buttonPick('Saved views', selectedView, [['', t('All work')], ...catalog.views.map((view): [string, string] => [view.id, view.name])],
        id => applyView(catalog.views.find(view => view.id === id)))}
    </View>
    <View style={rowStyle}>
      <BoardButton title={t('Save view')} disabled={guard} onPress={() => setEntry({ kind: 'view', name: '', visibility: 'private' })} />
      <BoardButton title={t('More filters')} selected={expanded === 'filters'} onPress={() => setExpanded(expanded === 'filters' ? '' : 'filters')} />
      <BoardButton title={t('Manage board')} selected={expanded === 'settings'} onPress={() => setExpanded(expanded === 'settings' ? '' : 'settings')} />
      <BoardButton title={t(selecting ? 'Finish selecting' : 'Select work items')} onPress={() => { toggleSelecting(); setBulk(null) }} />
      {selecting && selected.length ? <BoardButton title={t('Edit selected ({count})', { count: selected.length })}
        disabled={guard} onPress={() => { setResult(null); setBulk({}) }} /> : null}
    </View>
    {expanded === 'filters' ? <View style={{ gap: 6 }}>
      {buttonPick('Owner', filters.assignee || '', [['', t('All owners')], ...catalog.assignees.map((a): [string, string] => [a.id, t(a.name)])], change('assignee'))}
      {buttonPick('Task status', filters.statusId || '', [['', t('All statuses')],
        ...Object.entries(manualStatuses).map(([id, status]): [string, string] => [id, t(status.name)]),
        ...catalog.statuses.filter(s => !s.archived).map((s): [string, string] => [s.id, s.name])], change('statusId'))}
      {buttonPick('Priority', filters.priority || '', [['', t('All priorities')], ...labels(priorities)], change('priority'))}
      <BoardField title={t('Label')} value={filters.label} change={change('label')} />
      <BoardField title={t('Start on or before') + ' · YYYY-MM-DD'} value={filters.startBefore} change={change('startBefore')} limit={10} />
      <BoardField title={t('Due on or before') + ' · YYYY-MM-DD'} value={filters.dueBefore} change={change('dueBefore')} limit={10} />
      {buttonPick('Custom property', filters.property || '', [['', t('All properties')], ...properties.map((p): [string, string] => [p.id, p.name])],
        value => changeFilters({ property: value, propertyValue: '' }))}
      {filters.property ? <BoardField title={t('Property value')} value={filters.propertyValue} change={change('propertyValue')} /> : null}
    </View> : null}
    {expanded === 'settings' ? <View style={{ gap: 6 }}>
      <View style={rowStyle}>
        <BoardButton title={t('New status')} disabled={guard} onPress={() => setEntry({ kind: 'status', name: '', phase: 'todo' })} />
        <BoardButton title={t('New property')} disabled={guard} onPress={() => setEntry({ kind: 'property', name: '', propertyType: 'text' })} />
      </View>
      {[
        ...catalog.statuses.map(row => ({ ...row, kind: 'status' as const })),
        ...catalog.properties.map(row => ({ ...row, propertyType: row.kind, kind: 'property' as const })),
        ...catalog.views.map(row => ({ ...row, kind: 'view' as const, archived: false })),
      ].map(row => <View key={row.id} style={rowStyle}>
        <BoardButton title={row.name + (row.archived ? ' · ' + t('Archived') : '')} disabled={guard} onPress={() => setEntry(row)} />
        {'visibility' in row && row.visibility === 'shared' && computer
          ? <BoardButton title={t('Copy view link')} onPress={() => void Clipboard.setStringAsync(makeBoardViewLink(row.id, computer.hostDeviceId))} /> : null}
      </View>)}
    </View> : null}
    {entry ? <View style={{ gap: 6 }}>
      <BoardField title={t('Name')} value={entry.name} limit={70} change={name => patch({ name })} />
      {entry.kind === 'status' && !entry.id ? buttonPick('Lifecycle group', entry.phase ?? 'todo', labels(phases), phase => patch({ phase })) : null}
      {entry.kind === 'property' && !entry.id ? buttonPick('Property type', entry.propertyType ?? 'text',
        labels(boardPropertyTypes), propertyType => patch({ propertyType })) : null}
      {entry.kind === 'property' && ['select', 'multiSelect'].includes(entry.propertyType ?? '') ? <BoardField
        title={t('Options (one per line)')} value={entry.optionText ?? entry.options?.join('\n')} multiline
        change={optionText => patch({ optionText })} /> : null}
      {entry.kind === 'view' ? buttonPick('Visibility', entry.visibility ?? 'private', [['private', t('Private')], ['shared', t('Share by link')]],
        visibility => patch({ visibility })) : null}
      {entry.kind === 'view' && entry.id ? <BoardButton title={t('Use current filters and layout')} selected={entry.useCurrent}
        onPress={() => patch({ useCurrent: !entry.useCurrent })} /> : null}
      <View style={rowStyle}>
        <BoardButton title={t('Cancel')} onPress={() => setEntry(null)} />
        {entry.id && !entry.archived ? <BoardButton title={t('Archive')} disabled={guard} onPress={() => void save({ ...entry, op: 'remove' })} /> : null}
        <BoardButton title={t(entry.archived ? 'Restore' : 'Save changes')} disabled={guard || !entry.name.trim()} onPress={() => void save(entry)} />
      </View>
    </View> : null}
    {bulk ? <View style={{ gap: 7 }}>
      {buttonPick('Owner', bulk.assignee ?? '', [['', t('Choose an owner')], ...catalog.assignees.map((a): [string, string] => [a.id, t(a.name)])],
        assignee => setBulk(old => ({ ...old, assignee })))}
      {buttonPick('Priority', bulk.priority == null ? '' : String(bulk.priority), [['', t('Choose priority')], ...labels(priorities)],
        priority => setBulk(old => ({ ...old, priority: priority === '' ? undefined : Number(priority) })))}
      <BoardPlanEditor fields={bulk} change={data => setBulk(old => ({ ...old, ...data }))} catalog={catalog} choose={choose} bulk />
      <View style={rowStyle}><BoardButton title={t('Cancel')} onPress={() => setBulk(null)} />
        <BoardButton title={t('Apply changes')} disabled={guard || !Object.keys(bulk).length} onPress={() => void (async () => {
          const response = await act('bulk', { items: selected, patch: bulk }) as typeof result
          if (response) {
            setResult(response); setBulk(null); onBulk(response.rejected)
          }
        })()} /></View>
    </View> : null}
    {result ? <View accessibilityLiveRegion="polite">
      <BoardText>{t('{count} work items updated', { count: result.applied.length })}</BoardText>
      {result.rejected.map(item => <BoardText key={item.id} faint>{item.id + ' · ' + item.reason}</BoardText>)}
    </View> : null}
    {error ? <BoardText>{error}</BoardText> : null}
  </View>
}
