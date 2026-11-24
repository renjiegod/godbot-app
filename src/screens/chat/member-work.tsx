import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native'
import { useReducedMotion } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Approval } from '../../connection.ts'
import { useTeam } from '../../team/context.tsx'
import {
  elapsedLabel, memberWorkTarget, otherWorkers, processSegments, shownStatus, workAt,
  type MemberWorkOpen, type ProcessRow, type RoomWork, type TurnProcess,
} from '../../team/member-work.ts'
import { ChevronRightIcon, CloseIcon } from '../../ui/icons.tsx'
import { t } from '../../ui/i18n.ts'
import { Avatar } from '../../ui/marks.tsx'
import { workPhrase } from '../../ui/phrases.ts'
import { radius, type Palette, type as typeScale, useTheme } from '../../ui/tokens.ts'
import type { ChatItem } from './items.tsx'
import { Markdown } from './markdown.tsx'
import { ToolCard, ToolGroupCard } from './tool-card.tsx'

// One member's work in a group, in a sheet over the group's chat: the turn its group
// Session runs now, or the turn a line of the group came from, call by call. The member's
// group Session is no chat the user opens, so this is where that work shows, as in the
// panel beside a group on the desktop (member-work.js). The capsule above the composer,
// a "started on it" line, a finished line and a reply's tool count open it.

// The process is read again while the turn runs; an unchanged turn answers in a few bytes.
const POLL_MS = 1000
const RETRY_MS = 2500
// The time a turn has run moves every second; with reduced motion, every 5 s, so the
// screen is not redrawn every second (UI automation also waits for a quiet screen).
const TICK_MS = 1000
const TICK_REDUCED_MS = 5000
// A view this close to its end follows the newest call.
const STICK_PX = 48

type Call = (endpoint: string, payload?: unknown) => Promise<unknown>
interface Reading { key: string; data?: TurnProcess; failed?: boolean }

// The shown turn's process: read once, and again while it runs; one more read when it
// ends settles its calls' final states.
function useTurnProcess(call: Call, botId: string | undefined, target: { sessionId: string; turn: number; running: boolean } | null) {
  const key = botId === undefined || target === null ? '' : JSON.stringify([botId, target.sessionId, target.turn])
  const running = target?.running === true
  const [reading, setReading] = useState<Reading>({ key: '' })
  const [retry, setRetry] = useState(0)
  const rev = useRef<{ key: string; rev?: string }>({ key: '' })
  useEffect(() => {
    if (key === '' || target === null) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      const known = rev.current.key === key ? rev.current.rev : undefined
      try {
        const answer = await call('turn-process', { botId, sessionId: target.sessionId, turn: target.turn, ...(known !== undefined ? { knownRev: known } : {}) }) as TurnProcess
        if (disposed) return
        // An unchanged turn leaves the view as it is.
        if (answer.unchanged === true) setReading(prev => (prev.key === key && prev.data !== undefined && (prev.data.running !== answer.running || prev.failed === true)
          ? { key, data: { ...prev.data, running: answer.running } } : prev))
        else {
          rev.current = { key, rev: answer.rev }
          setReading({ key, data: answer })
        }
        if (running && answer.running !== false) timer = setTimeout(() => void load(), POLL_MS)
      } catch {
        if (disposed) return
        setReading(prev => ({ key, data: prev.key === key ? prev.data : undefined, failed: true }))
        if (running) timer = setTimeout(() => void load(), RETRY_MS)
      }
    }
    void load()
    return () => { disposed = true; clearTimeout(timer) }
  }, [call, key, running, retry])
  const current = reading.key === key ? reading : { key }
  return { data: current.data, failed: current.failed === true, reload: () => setRetry(count => count + 1) }
}

// The clock while a turn runs.
function useNow(on: boolean) {
  const reduced = useReducedMotion()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!on) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), reduced ? TICK_REDUCED_MS : TICK_MS)
    return () => clearInterval(timer)
  }, [on, reduced])
  return now
}

export function MemberWorkSheet({ open, onClose, onSwitch }: { open: MemberWorkOpen | null; onClose: () => void; onSwitch: (next: MemberWorkOpen) => void }) {
  const { p } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={open !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('Close')} />
      <View style={[styles.sheet, { backgroundColor: p.main, paddingBottom: insets.bottom }]}>
        <View style={[styles.grab, { backgroundColor: p.line2 }]} />
        <View style={styles.titleRow}>
          <Text style={[typeScale.settingsRow, { color: p.ink, fontWeight: '600', flex: 1 }]} accessibilityRole="header">{t('Work process')}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={onClose} hitSlop={10} style={styles.close}>
            <CloseIcon color={p.ink2} />
          </Pressable>
        </View>
        {open !== null ? <MemberWork key={`${open.roomId}:${open.botId}`} open={open} onSwitch={onSwitch} onClose={onClose} p={p} /> : null}
      </View>
    </Modal>
  )
}

function MemberWork({ open, onSwitch, onClose, p }: { open: MemberWorkOpen; onSwitch: (next: MemberWorkOpen) => void; onClose: () => void; p: Palette }) {
  const { dark } = useTheme()
  const { team, call, refresh } = useTeam()
  const { roomId, botId, at } = open
  const room = team?.rooms?.find(item => item.id === roomId)
  const bot = team?.bots?.find(item => item.id === botId)
  const entries = (team?.work?.rooms?.[roomId] ?? []) as RoomWork[]
  const entry = entries.find(item => item.botId === botId)
  const asking = (team?.work?.approvals ?? []).some((item: Approval) => item.botId === botId && item.roomId === roomId)
  const target = memberWorkTarget(at, entry)
  const others = otherWorkers(entries, botId)
  const running = target?.running === true
  const process = useTurnProcess(call, bot === undefined ? undefined : botId, target)
  const now = useNow(running && typeof entry?.since === 'number')
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)

  // A running turn follows its newest call while the view stays at its end; scrolling up
  // to read an earlier call holds it there.
  const body = useRef<ScrollViewInstance>(null)
  const stick = useRef(true)
  useEffect(() => { stick.current = running }, [target?.sessionId, target?.turn, running])

  if (room === undefined || bot === undefined) {
    return <Text style={[typeScale.small, styles.note, { color: p.ink3 }]}>{t('This member is no longer in the group.')}</Text>
  }

  const stop = () => {
    setStopping(true)
    setStopError(null)
    void call('stop-member-work', { roomId, botId })
      .then(() => refresh?.(), (failure: Error) => setStopError(failure?.message ?? String(failure)))
      .finally(() => setStopping(false))
  }
  const count = running ? entry?.count : at.tools
  const counted = typeof count === 'number' && count > 0 ? ` · ${t('{count} tool calls', { count })}` : ''
  const elapsed = running && typeof entry?.since === 'number' ? ` · ${elapsedLabel(Math.max(1000, now - entry.since))}` : ''
  const status = asking && running ? t('Waiting for your approval')
    : running ? `${workPhrase(entry)}…${counted}${elapsed}`
      : target !== null ? `${t('This turn has ended')}${counted}`
        : t('{name} is not working in this group now', { name: bot.name })

  return (
    <>
      <View style={styles.who}>
        <Avatar bot={bot} dark={dark} size={32} ring={p.main} working={running && !asking} waiting={running && asking} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[typeScale.settingsRow, { color: p.ink, fontWeight: '600' }]} numberOfLines={1}>
            {bot.name}<Text style={[typeScale.caption, { color: p.ink3, fontWeight: '400' }]}>{`  ${t('in {name}', { name: room.name })}`}</Text>
          </Text>
          <Text testID="member-work-status" style={[typeScale.caption, { color: asking && running ? p.star : p.ink2 }]} numberOfLines={1}>{status}</Text>
        </View>
        {running && asking ? (
          // The approval waits in the chat, above the composer.
          <Pressable accessibilityRole="button" onPress={onClose}
            style={({ pressed }) => [styles.stop, { backgroundColor: pressed ? p.active : p.hover }]}>
            <Text style={[typeScale.small, { color: p.accent, fontWeight: '500' }]}>{t('Answer it')}</Text>
          </Pressable>
        ) : null}
        {running && !asking ? (
          <Pressable testID="member-work-stop" accessibilityRole="button" accessibilityLabel={`${t('Stop')} · ${bot.name}`} disabled={stopping} onPress={stop}
            style={({ pressed }) => [styles.stop, { backgroundColor: pressed ? p.active : p.hover, opacity: stopping ? 0.5 : 1 }]}>
            <Text style={[typeScale.small, { color: p.danger, fontWeight: '500' }]}>{t('Stop')}</Text>
          </Pressable>
        ) : null}
      </View>
      {stopError !== null ? <Text accessibilityRole="alert" style={[typeScale.caption, styles.strip, { color: p.danger }]}>{stopError}</Text> : null}
      {target?.newer !== undefined || others.length > 0 ? (
        <View style={styles.strip}>
          {target?.newer !== undefined ? (
            <Pressable accessibilityRole="button" onPress={() => onSwitch({ roomId, botId, at: target.newer! })} hitSlop={6}>
              <Text style={[typeScale.caption, { color: p.accent }]}>{t('Show the turn it runs now')}</Text>
            </Pressable>
          ) : null}
          {others.length > 0 ? <Text style={[typeScale.caption, { color: p.ink3 }]}>{t('Also at work')}</Text> : null}
          {others.map(other => {
            const peer = team?.bots?.find(item => item.id === other.botId)
            return peer === undefined ? null : (
              <Pressable key={other.botId} accessibilityRole="button" accessibilityLabel={`${t('Work process')} · ${peer.name}`}
                onPress={() => onSwitch({ roomId, botId: peer.id, at: workAt(other) ?? {} })}
                style={({ pressed }) => [styles.peer, { backgroundColor: pressed ? p.active : p.hover }]}>
                <Avatar bot={peer} dark={dark} size={18} ring={p.main} />
                <Text style={[typeScale.caption, { color: p.ink2 }]} numberOfLines={1}>{peer.name}</Text>
              </Pressable>
            )
          })}
        </View>
      ) : null}
      <ScrollView ref={body} style={[styles.body, { borderTopColor: p.line }]} contentContainerStyle={styles.bodyContent}
        scrollEventThrottle={100}
        onScroll={event => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
          stick.current = contentSize.height - contentOffset.y - layoutMeasurement.height < STICK_PX
        }}
        onContentSizeChange={() => { if (stick.current && running) body.current?.scrollToEnd({ animated: false }) }}>
        {target === null ? null : (
          <Process key={`${target.sessionId}:${target.turn}`} botId={botId} target={target} reading={process} p={p} />
        )}
      </ScrollView>
    </>
  )
}

function Process({ botId, target, reading, p }: {
  botId: string; target: { sessionId: string; turn: number; running: boolean }
  reading: { data?: TurnProcess; failed: boolean; reload: () => void }; p: Palette
}) {
  const [openRuns, setOpenRuns] = useState<Record<string, boolean>>({})
  const [openCalls, setOpenCalls] = useState<Record<string, boolean>>({})
  const data = reading.data
  if (data === undefined) {
    return reading.failed
      ? <View style={styles.center}>
          <Text accessibilityRole="alert" style={[typeScale.small, { color: p.ink3 }]}>{t('Could not read the work process.')}</Text>
          <Text accessibilityRole="button" onPress={reading.reload} style={[typeScale.small, { color: p.accent, marginTop: 8 }]}>{t('Retry')}</Text>
        </View>
      : <View style={styles.center}>
          <ActivityIndicator color={p.ink3} />
          <Text style={[typeScale.caption, { color: p.ink3, marginTop: 8 }]}>{t('Reading the work process…')}</Text>
        </View>
  }
  const live = target.running && data.running !== false
  const segments = processSegments(data.events)
  if (segments.length === 0) {
    return <Text style={[typeScale.small, styles.note, { color: p.ink3 }]}>{live ? t('No tools called yet.') : t('No work process was recorded for this turn.')}</Text>
  }
  const newest = segments.findLastIndex(segment => segment.type === 'tools')
  const item = (row: ProcessRow): ChatItem => ({
    kind: 'tool', botId, sessionId: target.sessionId, turn: target.turn, toolId: row.toolId,
    status: shownStatus(row.status, live), name: row.name || t('Tool call'), text: row.text,
  })
  return (
    <View style={{ gap: 6 }}>
      {data.omitted !== undefined && data.omitted > 0
        ? <Text style={[typeScale.caption, { color: p.ink3 }]}>{t('{count} earlier rows are not shown', { count: data.omitted })}</Text>
        : null}
      {segments.map((segment, index) => {
        if (segment.type !== 'tools') {
          if (segment.type === 'input') return <TaskInput key={segment.key} text={segment.row.text ?? ''} p={p} />
          if (segment.type === 'error') return <Text key={segment.key} accessibilityRole="alert" style={[typeScale.small, { color: p.danger }]}>{segment.row.text}</Text>
          return (
            <View key={segment.key} style={styles.text}>
              <Markdown text={segment.row.text ?? ''} p={p} textColor={p.ink} bg={p.main} fontSize={14} lineHeight={21} sessionId={target.sessionId} botId={botId} />
            </View>
          )
        }
        // A run of calls folds to its count, except the newest run of a turn still running,
        // which stays open so its newest call shows.
        const shown = openRuns[segment.key] ?? (index === newest && live)
        const rows = segment.rows.map((row, at) => ({ item: item(row), key: `${segment.key}:${row.toolId ?? at}`, child: row.parentId !== undefined }))
        return (
          <View key={segment.key}>
            <ToolGroupCard tools={rows} p={p} conversation open={shown} onToggle={() => setOpenRuns(prev => ({ ...prev, [segment.key]: !shown }))} />
            {shown ? rows.map(row => (
              <View key={row.key} style={row.child ? styles.child : undefined}>
                <ToolCard item={row.item} p={p} conversation open={openCalls[row.key] === true} onToggle={() => setOpenCalls(prev => ({ ...prev, [row.key]: !prev[row.key] }))} />
              </View>
            )) : null}
          </View>
        )
      })}
    </View>
  )
}

// The task a turn was given, folded: a phone shows the work first.
function TaskInput({ text, p }: { text: string; p: Palette }) {
  const [open, setOpen] = useState(false)
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(on => !on)} style={styles.inputHead}>
        <View style={open ? styles.chevronOpen : undefined}><ChevronRightIcon size={14} color={p.ink2} /></View>
        <Text style={[typeScale.small, { color: p.ink2 }]}>{t('Task input')}</Text>
      </Pressable>
      {open ? <Text selectable style={[typeScale.small, styles.inputBody, { color: p.ink, backgroundColor: p.card, borderColor: p.line }]}>{text}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: { height: '86%', borderTopLeftRadius: radius.dialog, borderTopRightRadius: radius.dialog, paddingTop: 8 },
  grab: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: 16, paddingRight: 8 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  stop: { minHeight: 36, paddingHorizontal: 14, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  strip: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  peer: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingLeft: 4, paddingRight: 10, borderRadius: radius.pill, maxWidth: 160 },
  body: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth },
  bodyContent: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 24 },
  center: { alignItems: 'center', paddingVertical: 32 },
  note: { paddingHorizontal: 16, paddingVertical: 16 },
  text: { paddingHorizontal: 6 },
  child: { marginLeft: 16 },
  inputHead: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 6 },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  inputBody: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.input, padding: 10, fontFamily: 'monospace' },
})
