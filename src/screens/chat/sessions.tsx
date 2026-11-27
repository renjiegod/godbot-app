// A Bot's chat sessions, opened from the chat itself: the Sessions button in the chat's
// top bar shows this sheet, the phone's take on the desktop's session lists
// (sidebar.js BotSessionList, details-drawer.js BotSessions). Each session goes by the
// first thing the user asked in it. One tap opens it, even while another one works:
// the session the chat leaves goes on in the background.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Bot } from '../../connection.ts'
import { useTeam } from '../../team/context.tsx'
import { botSessions, currentPart, elsewhere, parallelSessions, sessionLabel, sessionMeta, switchable, unknownEndpoint, type BotSession } from '../../team/bot-sessions.ts'
import { hostText, t } from '../../ui/i18n.ts'
import { ChatsIcon, NewSessionIcon } from '../../ui/icons.tsx'
import { CopyIdButton } from '../../ui/copy-id.tsx'
import { shadow, type as typeScale, useTheme, type Palette } from '../../ui/tokens.ts'

// Computers that turned bot-open-part or bot-new-part away as unknown, by link boot: the
// phone stops offering the session list there until that computer starts again.
const unknownAt = new Set<string>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function markUnknown(key: string) {
  if (unknownAt.has(key)) return
  unknownAt.add(key)
  for (const listener of listeners) listener()
}
function useHostKey() {
  const { computer, hello } = useTeam()
  return `${computer?.hostDeviceId ?? ''}:${hello?.boot ?? ''}`
}

/** Whether the phone can list and switch this Bot's sessions on the computer it is linked to. */
export function useSessionsAvailable(bot: Bot | undefined): boolean {
  const key = useHostKey()
  const unknown = useSyncExternalStore(subscribe, () => unknownAt.has(key))
  return switchable(bot, unknown)
}

// Opening a session (`bot-open-part`) and starting a fresh one (`bot-new-part`). One ask
// at a time; a failed one says the computer's reason and reads the team again, so the
// list shows where the sessions stand now. `onOpened` learns whether the session must
// open read-only: an older computer's desktop keeps a running session it opens that way.
// `onStarted` learns whether a fresh part became current, or the computer had none to make.
export function useSessionSwitch(bot: Bot, { onOpened, onStarted }: { onOpened?: (entry: BotSession, readOnly: boolean) => void; onStarted?: (moved: boolean) => void } = {}) {
  const { team, call, refresh, online } = useTeam()
  const key = useHostKey()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The part that was current when a New session was asked for; done once another is.
  const [startingFrom, setStartingFrom] = useState<string | null>(null)
  const asking = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const done = useRef({ onOpened, onStarted })
  done.current = { onOpened, onStarted }
  const current = currentPart(bot)
  const newState = team?.newSessions?.[bot.id]
  const writable = online && team !== null && !team.readOnly
  const starting = newState === 'opening' || pending === 'new' || startingFrom !== null
  useEffect(() => {
    if (startingFrom === null) return
    if (current !== startingFrom) { setStartingFrom(null); done.current.onStarted?.(true); return }
    if (newState === 'opening') return
    // The fresh part did not show up: read the team again and let the button go.
    const timer = setTimeout(() => { setStartingFrom(null); refresh?.() }, 20_000)
    return () => clearTimeout(timer)
  }, [startingFrom, current, newState, refresh])
  const failed = (failure: unknown) => {
    // The phone's own lock asked first and the user turned it away.
    if (!mounted.current || (failure as { code?: string })?.code === 'unlock/canceled') return
    if (unknownEndpoint(failure)) markUnknown(key)
    else setError(hostText((failure as { message?: string })?.message ?? String(failure)))
    refresh?.()
  }
  const ask = async (id: string, run: () => Promise<void>) => {
    if (!writable || asking.current) return
    asking.current = true
    setPending(id)
    setError(null)
    try { await run() } catch (failure) { failed(failure) } finally {
      asking.current = false
      if (mounted.current) setPending(null)
    }
  }
  const open = (entry: BotSession) => entry.current || starting ? undefined : ask(entry.id, async () => {
    await call('bot-open-part', { botId: bot.id, sessionId: entry.id })
    done.current.onOpened?.(entry, entry.running && !parallelSessions(team))
  })
  // 'empty': nobody talked in the current part, so another would only add an empty one.
  const canStart = writable && !starting && newState !== 'empty'
  const start = () => !canStart ? undefined : ask('new', async () => {
    const moved = await call('bot-new-part', { botId: bot.id })
    if (moved === true && mounted.current) setStartingFrom(current)
    else if (moved !== true) done.current.onStarted?.(false)
  })
  return { pending, error, open, start, starting, canStart, writable, newState }
}

// The chat's top-bar button: the sheet's way in, with a dot while another session of
// the Bot runs (green) or waits for the user's answer.
export function SessionsButton({ bot, onPress }: { bot: Bot; onPress: () => void }) {
  const { p } = useTheme()
  const { team } = useTeam()
  const { running, waiting } = elsewhere(botSessions(bot, team))
  const hint = [running > 0 ? t('{count} running in the background', { count: running }) : '', waiting > 0 ? t('Waiting for your answer') : ''].filter(Boolean).join(', ')
  return (
    <Pressable testID="chat-sessions" accessibilityRole="button" accessibilityLabel={t('Sessions')} accessibilityHint={hint || undefined}
      onPress={onPress} hitSlop={8} style={styles.button}>
      <ChatsIcon size={21} color={p.ink2} />
      {waiting > 0 || running > 0 ? <View style={[styles.buttonDot, { backgroundColor: waiting > 0 ? p.accent : p.green, borderColor: p.main }]} /> : null}
    </Pressable>
  )
}

export function SessionSheet({ bot, visible, onClose, onOpened }: {
  bot: Bot; visible: boolean; onClose: () => void; onOpened?: (entry: BotSession, readOnly: boolean) => void
}) {
  const { p } = useTheme()
  const insets = useSafeAreaInsets()
  const { team } = useTeam()
  const available = useSessionsAvailable(bot)
  const { pending, error, open, start, starting, canStart, writable, newState } = useSessionSwitch(bot, {
    onOpened: (entry, readOnly) => { onOpened?.(entry, readOnly); onClose() },
    onStarted: () => onClose(),
  })
  const entries = botSessions(bot, team)
  const backgroundRunning = entries.some(entry => !entry.current && entry.running)
  const busy = pending !== null || starting
  const close = () => { if (pending === null) onClose() }
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={close}>
      <View style={styles.modal}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('Close')} onPress={close} />
        <View testID="session-sheet" accessibilityViewIsModal style={[styles.panel, { backgroundColor: p.card, borderColor: p.line, marginBottom: insets.bottom + 12 }, shadow(3)]}>
          <Text accessibilityRole="header" numberOfLines={1} style={[typeScale.headerTitle, styles.title, { color: p.ink }]}>{t('Sessions of {name}', { name: bot.name })}</Text>
          {!available ? (
            <Text accessibilityRole="alert" style={[typeScale.small, styles.note, { color: p.ink2 }]}>{t('Update Godbot on the computer to switch sessions from the phone.')}</Text>
          ) : (
            <>
              <Pressable testID="session-new" accessibilityRole="button" accessibilityLabel={starting ? t('Starting a new session…') : t('New session')}
                accessibilityHint={newState === 'empty' ? t('This is already a new session. Send a message to begin.') : t('Start a new session with {name}', { name: bot.name })}
                accessibilityState={{ disabled: !canStart, busy: starting }} disabled={!canStart} onPress={() => void start()}
                style={({ pressed }) => [styles.row, pressed && canStart && { backgroundColor: p.hover }]}>
                {starting ? <ActivityIndicator size="small" color={p.accent} style={styles.mark} /> : <View style={styles.mark}><NewSessionIcon size={18} color={canStart ? p.accent : p.ink3} /></View>}
                <Text style={[typeScale.settingsRow, { flex: 1, color: canStart || starting ? p.ink : p.ink3 }]}>{starting ? t('Starting…') : t('New session')}</Text>
              </Pressable>
              {newState === 'empty' && !starting ? <Text style={[typeScale.caption, styles.hint, { color: p.ink3 }]}>{t('This is already a new session. Send a message to begin.')}</Text> : null}
              {backgroundRunning ? <Text accessibilityRole="text" style={[typeScale.caption, styles.note, { color: p.ink2 }]}>{t('A running session keeps using model calls in the background.')}</Text> : null}
              {team?.readOnly ? <Text accessibilityRole="alert" style={[typeScale.small, styles.note, { color: p.ink2 }]}>{hostText(team.readOnly)}</Text> : null}
              <View style={[styles.divider, { backgroundColor: p.line }]} />
              <ScrollView bounces={false} style={styles.list}>
                {entries.map(entry => (
                  <SessionRow key={entry.id} entry={entry} label={sessionLabel(entry, bot, team)} p={p}
                    opening={pending === entry.id} disabled={!writable || busy} onPress={() => void open(entry)} />
                ))}
              </ScrollView>
              {error !== null ? <Text testID="session-error" accessibilityRole="alert" style={[typeScale.small, styles.note, { color: p.danger }]}>{error}</Text> : null}
            </>
          )}
          <Pressable accessibilityRole="button" onPress={close} style={({ pressed }) => [styles.row, styles.closeRow, { borderTopColor: p.line }, pressed && { backgroundColor: p.hover }]}>
            <Text style={[typeScale.settingsRow, { flex: 1, textAlign: 'center', color: p.ink2 }]}>{t('Close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

// One session: a mark (breathing green while it runs, the accent while it waits for an
// answer), its name, and what it is doing or that it is the one on screen.
export function SessionRow({ entry, label, p, opening, disabled, onPress }: {
  entry: BotSession; label: string; p: Palette; opening: boolean; disabled: boolean; onPress: () => void
}) {
  const meta = sessionMeta(entry)
  const hint = entry.current ? t('Current session') : entry.running ? t('Open this running session') : entry.background ? t('Open this session') : t('Open this earlier session')
  const off = disabled || entry.current
  // The copy button sits beside the row, not in it, so TalkBack reaches both and a
  // copy never opens the session. It copies the current session too.
  return (
    <View style={[styles.rowWrap, { backgroundColor: entry.current ? p.hover : 'transparent' }]}>
      <Pressable testID={`session-${entry.id}`} accessibilityRole="button" accessibilityLabel={[label, meta.text].filter(Boolean).join(', ')} accessibilityHint={hint}
        accessibilityState={{ selected: entry.current, disabled: off, busy: opening }} disabled={off} onPress={onPress}
        style={({ pressed }) => [styles.row, styles.rowMain, { backgroundColor: pressed && !off ? p.hover : 'transparent' }]}>
        <View style={styles.mark}><SessionMark entry={entry} p={p} /></View>
        <Text style={[typeScale.settingsRow, { flex: 1, color: p.ink, fontWeight: entry.current ? '600' : '400' }]} numberOfLines={2}>{label}</Text>
        {opening
          ? <ActivityIndicator size="small" color={p.accent} accessibilityLabel={t('Opening this session…')} />
          : meta.text !== '' ? <Text style={[typeScale.caption, { color: meta.tone === 'wait' ? p.accent : meta.tone === 'run' ? p.green : p.ink3, flexShrink: 0 }]}>{meta.text}</Text> : null}
      </Pressable>
      <CopyIdButton id={entry.id} testID={`session-copy-${entry.id}`} />
    </View>
  )
}

function SessionMark({ entry, p }: { entry: BotSession; p: Palette }) {
  const reduced = useReducedMotion()
  const glow = useSharedValue(1)
  const run = entry.running && !entry.waiting
  useEffect(() => {
    glow.value = run && !reduced ? withRepeat(withSequence(withTiming(0.35, { duration: 700 }), withTiming(1, { duration: 700 })), -1, false) : 1
  }, [run, reduced])
  const style = useAnimatedStyle(() => ({ opacity: glow.value }))
  const color = entry.waiting ? p.accent : run ? p.green : entry.current ? p.ink2 : p.line2
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'flex-end' },
  panel: { marginHorizontal: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, maxHeight: '82%', overflow: 'hidden' },
  title: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  note: { paddingHorizontal: 16, paddingVertical: 6 },
  hint: { paddingHorizontal: 16, marginTop: -6, paddingBottom: 6, paddingLeft: 52 },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 2 },
  list: { flexGrow: 0 },
  row: { minHeight: 52, paddingHorizontal: 16, paddingVertical: 8, gap: 10, flexDirection: 'row', alignItems: 'center' },
  rowWrap: { flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  rowMain: { flex: 1, paddingRight: 4 },
  closeRow: { borderTopWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  mark: { width: 26, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  buttonDot: { position: 'absolute', top: 9, right: 8, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
})
