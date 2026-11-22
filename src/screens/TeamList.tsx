import { useSyncExternalStore } from 'react'
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native'
import type { Bot, Room } from '../connection.ts'
import { useTeam } from '../team/context.tsx'
import { pendingItemsOf } from '../nav/pending.ts'
import { rosterOf, type ChatTarget, type RosterEntry, type RosterSection } from '../nav/sidebar-roster.ts'
import { isUnread, seenVersion, subscribeSeen } from '../team/seen.ts'
import { hostText, t } from '../ui/i18n.ts'
import { inkColor, radius, type as typeScale, useTheme } from '../ui/tokens.ts'
import { Avatar, RoomAvatar } from '../ui/marks.tsx'
import { ChevronRightIcon, DotsIcon, PinMarkIcon } from '../ui/icons.tsx'
import { workPhrase } from '../ui/phrases.ts'
import { cleanPreview } from './chat/settled.ts'

export type { ChatTarget } from '../nav/sidebar-roster.ts'

type Status = 'attention' | 'working' | 'unread'
type Section = { key: string; data: RosterEntry[]; group?: ReturnType<typeof rosterOf>['sections'][number] }

export function TeamList({ onOpen, onOptions, onSection, onToggleSection, query, current }: {
  onOpen: (target: ChatTarget) => void
  onOptions: (entry: RosterEntry) => void
  onSection: (section: RosterSection) => void
  onToggleSection: (section: RosterSection) => void
  query: string
  current?: ChatTarget
}) {
  const { team, computer, online } = useTeam()
  const { p, dark } = useTheme()
  useSyncExternalStore(subscribeSeen, seenVersion)

  const hostId = computer?.hostDeviceId ?? ''
  const bots = team?.bots ?? []
  const rooms = team?.rooms ?? []
  const { lead, mains, ungrouped, sections } = rosterOf(team, current, query)
  const workBots = team?.work?.bots ?? {}
  const workRooms = team?.work?.rooms ?? {}
  const pending = pendingItemsOf(team)
  const selected = ({ kind, item }: RosterEntry) => current?.kind === kind && current.id === item.id

  const activityOf = (bot: Bot) => workBots[bot.id] ?? team?.activity?.[bot.id]
  const waitsFor = (id: string) => {
    const waiting = team?.work?.waiting?.[id]
    const names = [
      ...(waiting?.bots ?? []).map(botId => bots.find(bot => bot.id === botId)?.name),
      ...(waiting?.rooms ?? []).map(roomId => rooms.find(room => room.id === roomId)?.name),
    ].filter(Boolean)
    return names.length > 0 ? t('Waiting for {names}', { names: names.join(t(' and ')) }) : undefined
  }
  const botStatus = (bot: Bot) => {
    const needs = pending.filter(item => item.botId === bot.id)
    const attention = needs.length > 0
    const action = needs.some(item => item.kind === 'approval') ? t('Waiting for your approval') : t('Waiting for your answer')
    const doing = activityOf(bot)
    const group = Object.entries(workRooms).flatMap(([roomId, entries]) => entries.filter(item => item.botId === bot.id).map(item => ({ roomId, item })))
    const away = group[0]
    const running = doing !== undefined || away !== undefined
    const work = doing !== undefined ? `${workPhrase(doing)}…` : away === undefined
      ? undefined
      : `${rooms.find(room => room.id === away.roomId)?.name ?? t('a group chat')} · ${workPhrase(away.item)}…${group.length > 1 ? ` +${group.length - 1}` : ''}`
    return { attention, running, preview: attention ? action : waitsFor(bot.id) ?? work ?? cleanPreview(bot.preview) }
  }
  const roomStatus = (room: Room) => {
    const attention = pending.some(item => item.kind === 'approval' && item.roomId === room.id)
    const groupWork = workRooms[room.id] ?? []
    const first = groupWork[0]
    const title = bots.find(bot => bot.id === first?.botId)?.name
    const work = first && title ? `${title} · ${workPhrase(first)}…${groupWork.length > 1 ? ` +${groupWork.length - 1}` : ''}` : undefined
    return { attention, running: first !== undefined, preview: attention ? t('Waiting for your approval') : work ?? cleanPreview(room.preview) }
  }
  const status = (entry: RosterEntry): Status | undefined => {
    const { attention, running } = entry.kind === 'bot' ? botStatus(entry.item) : roomStatus(entry.item)
    if (attention) return 'attention'
    if (running) return 'working'
    if (isUnread(hostId, entry.item.id, entry.item.lastAt, selected(entry))) return 'unread'
  }
  const data: Section[] = [
    { key: 'ungrouped', data: ungrouped },
    ...sections.map(group => ({ key: group.section.id, group, data: group.collapsed ? [] : group.entries })),
  ]
  const open = (entry: RosterEntry) => onOpen({ kind: entry.kind, id: entry.item.id })

  return (
    <SectionList<RosterEntry, Section>
      style={styles.root}
      keyboardShouldPersistTaps="handled"
      stickySectionHeadersEnabled={false}
      sections={data}
      keyExtractor={entry => `${entry.kind}-${entry.item.id}`}
      ListHeaderComponent={(
        <>
          {team?.readOnly ? <Text style={[styles.hint, { color: p.ink2 }]} accessibilityRole="alert">{hostText(team.readOnly)}</Text> : null}
          {lead ? (
            <View style={styles.tileWrap}>
              <Pressable
                accessibilityRole="button" accessibilityLabel={`${lead.name}, ${t('Main Bot')}`}
                accessibilityState={{ selected: current?.kind === 'bot' && current.id === lead.id }}
                onPress={() => onOpen({ kind: 'bot', id: lead.id })}
                onLongPress={() => onOptions({ kind: 'bot', item: lead })}
                accessibilityActions={[{ name: 'longpress', label: t('More options') }]}
                onAccessibilityAction={() => onOptions({ kind: 'bot', item: lead })}
                style={({ pressed }) => [styles.tile, { backgroundColor: pressed || (current?.kind === 'bot' && current.id === lead.id) ? p.active : p.hover }]}
              >
                <Avatar bot={lead} dark={dark} size={36} ring={p.sidebar} main
                  working={botStatus(lead).running} waiting={botStatus(lead).attention} />
                <Text style={[typeScale.small, { color: p.ink, fontWeight: '600' }]} numberOfLines={1}>{lead.name}</Text>
                {lead.role ? <Text style={[styles.tileTag, { color: p.tagInk, backgroundColor: p.tagBg }]} numberOfLines={1}>{lead.role}</Text> : null}
              </Pressable>
            </View>
          ) : null}
          {team && query.trim() !== '' && !lead && ungrouped.length === 0 && sections.length === 0
            ? <Text style={[styles.hint, { color: p.ink3 }]}>{t('No results')}</Text> : null}
        </>
      )}
      renderSectionHeader={({ section: { group } }) => {
        if (!group) return null
        const { section, entries, collapsed } = group
        const statuses = new Set(collapsed ? entries.map(status) : [])
        const aggregate = (['attention', 'working', 'unread'] as const).find(value => statuses.has(value))
        const color = section.color ? inkColor(section.color, dark) : p.line2
        const toggleDisabled = query.trim() !== '' || !online || Boolean(team?.readOnly)
        const active = collapsed && entries.some(selected)
        return (
          <View style={[styles.sectionHeader, { backgroundColor: p.sidebar }]}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: !collapsed, disabled: toggleDisabled, selected: active }}
              disabled={toggleDisabled} onPress={() => onToggleSection(section)}
              style={({ pressed }) => [styles.sectionToggle, (pressed || active) && { backgroundColor: p.hover }]}>
              <View style={{ transform: [{ rotate: collapsed ? '0deg' : '90deg' }] }}><ChevronRightIcon size={16} /></View>
              <View style={[styles.sectionMark, { backgroundColor: color }]} />
              <Text style={[typeScale.small, { color: p.ink, fontWeight: '600', flex: 1 }]} numberOfLines={1}>{section.name}</Text>
              {collapsed ? <Text style={[typeScale.caption, { color: p.ink3 }]}>{entries.length}</Text> : null}
              <StatusDot status={aggregate} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t('{name} actions', { name: section.name })}
              onPress={() => onSection(section)} style={({ pressed }) => [styles.sectionOptions, pressed && { backgroundColor: p.hover }]}>
              <DotsIcon size={18} />
            </Pressable>
          </View>
        )
      }}
      renderItem={({ item: entry, section }) => {
        const on = selected(entry)
        const access = () => onOptions(entry)
        const { item } = entry
        const { preview, attention, running } = entry.kind === 'bot' ? botStatus(entry.item) : roomStatus(entry.item)
        const engineModel = entry.kind === 'bot' ? entry.item.engine : undefined
        const engine = engineModel ? team?.models?.find(model => model.provider === engineModel || model.ref.startsWith(`${engineModel}/`))?.providerName
          ?? engineModel.replace(/^local-/, '').replaceAll('-', ' ') : undefined
        const unread = isUnread(hostId, item.id, item.lastAt, on)
        const rowStatus = attention ? 'attention' : running ? 'working' : unread ? 'unread' : undefined
        const hidden = item.hidden === true && query.trim() !== ''
        const summary = [preview, hidden ? t('Hidden') : undefined].filter(Boolean).join(' · ')
        const description = [engine, item.pinned ? t('Pinned') : undefined, summary, unread ? t('Unread activity') : undefined].filter(Boolean).join(', ')
        return (
          <Pressable accessibilityRole="button" accessibilityLabel={item.name} accessibilityHint={description || undefined}
            accessibilityState={{ selected: on }}
            onPress={() => open(entry)} onLongPress={access}
            accessibilityActions={[{ name: 'longpress', label: t('More options') }]} onAccessibilityAction={access}
            style={({ pressed }) => [styles.row, section.group ? styles.groupRow : null, (pressed || on) && { backgroundColor: p.hover }]}>
            {entry.kind === 'bot'
              ? <Avatar bot={entry.item} dark={dark} size={36} ring={p.sidebar} main={mains.has(item.id)} />
              : <RoomAvatar room={entry.item} bots={bots} dark={dark} size={36} ring={p.sidebar} />}
            <View style={styles.rowBody}>
              <View style={styles.nameRow}>
                <Text style={[typeScale.rowName, { color: p.ink, flexShrink: 1 }]} numberOfLines={1}>{item.name}</Text>
                {engine ? <Text style={[styles.engine, { color: p.tagInk, backgroundColor: p.tagBg }]} numberOfLines={1}>{engine}</Text> : null}
                {item.pinned ? <PinMarkIcon size={12} /> : null}
              </View>
              {summary ? <Text style={[typeScale.rowPreview, { color: attention ? p.accent : p.ink2 }]} numberOfLines={1}>{summary}</Text> : null}
            </View>
            <StatusDot status={rowStatus} />
          </Pressable>
        )
      }}
    />
  )
}

function StatusDot({ status }: { status?: Status }) {
  const { p } = useTheme()
  if (!status) return null
  return <View style={[styles.statusDot, { backgroundColor: status === 'working' ? p.green : p.accent }, status === 'attention' && { width: 9, height: 9, borderColor: p.sidebar, borderWidth: 1 }]} />
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hint: { marginHorizontal: 16, paddingVertical: 8, fontSize: 13 },
  tileWrap: { alignItems: 'center', paddingTop: 2, paddingBottom: 8 },
  tile: { minWidth: 96, maxWidth: '76%', gap: 3, alignItems: 'center', borderRadius: radius.card, paddingVertical: 7, paddingHorizontal: 10 },
  tileTag: { borderRadius: 5, paddingHorizontal: 6, fontSize: 11, lineHeight: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingVertical: 5, paddingHorizontal: 8, marginHorizontal: 8, borderRadius: radius.row },
  groupRow: { marginLeft: 16 },
  rowBody: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  engine: { flexShrink: 0, maxWidth: '40%', borderRadius: 4, paddingHorizontal: 4, fontSize: 10, lineHeight: 15 },
  statusDot: { width: 7, height: 7, borderRadius: 5 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 44, marginTop: 3, paddingHorizontal: 8 },
  sectionToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: 6, paddingRight: 4, gap: 5, borderRadius: radius.row },
  sectionMark: { width: 3, height: 13, borderRadius: 2 },
  sectionOptions: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.row },
})
