import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { randomUUID } from 'expo-crypto'
import { identityFingerprint } from '../../godbot/link/index.ts'
import { openLink } from '../connection.ts'
import { forgetMachine, listMachines, markMachineConnected, type PhoneIdentity } from '../store.ts'
import { linkManager } from '../team/link.ts'
import { t } from '../ui/i18n.ts'
import { type as typeScale } from '../ui/tokens.ts'
import { useMachinePalette } from './appearance.ts'
import { MachineDesktop } from './Desktop.tsx'
import type { DesktopStats } from './desktop-peer.ts'
import { MachineTerminal } from './Terminal.tsx'
import { MachineConnection, type MachineState } from './session.ts'
import { type Mode, type SavedMachine } from './model.ts'
import { Action } from './Action.tsx'

export function RemoteComputers({
  identity,
  initial,
  onPair,
  onSession,
  onBack,
}: {
  identity: PhoneIdentity
  initial?: SavedMachine | null
  onSession: (active: boolean) => void
  onPair: () => void
  onBack: () => void
}) {
  const p = useMachinePalette(),
    insets = useSafeAreaInsets(),
    dimensions = useWindowDimensions()
  const [items, setItems] = useState<SavedMachine[]>([]),
    [target, setTarget] = useState<SavedMachine | null>(initial ?? null)
  const [state, setState] = useState<MachineState>({ connecting: !!initial }),
    [attempt, retry] = useState(0),
    [full, setFull] = useState(false)
  const [info, setInfo] = useState(false)
  const resetInput = useRef<(() => void) | null>(null)
  const [lastDesktop, setLastDesktop] = useState<{ reason: string; stats: DesktopStats } | null>(null)
  const [failedDetails, setFailedDetails] = useState(false)
  const [endedShell, setEndedShell] = useState<{ id: string; code: number | null } | null>(null)
  const conn = useRef<MachineConnection | null>(null)
  const load = useCallback(() => listMachines().then(setItems), [])
  useEffect(() => {
    void load()
    return linkManager.pause()
  }, [load])
  useEffect(() => {
    setFull(false)
    setInfo(false)
    setLastDesktop(null)
    setFailedDetails(false)
    setEndedShell(null)
    if (!target) {
      setState({ connecting: false })
      return
    }
    const c = new MachineConnection(setState)
    conn.current = c
    setState({ connecting: true })
    if (AppState.currentState === 'active' || AppState.currentState === null) {
      void c
        .connect((capture) => openLink(target, identity, undefined, capture))
        .then((hello) => hello && markMachineConnected(target.hostDeviceId, hello).then(load))
        .catch(() => {})
    } else setState({ connecting: false, error: 'Session ended in background' })
    const listener = AppState.addEventListener('change', (value) => {
      if (value !== 'active') {
        c.dispose()
        setEndedShell(null)
        setFull(false)
        setState({ connecting: false, error: 'Session ended in background' })
      }
    })
    return () => {
      listener.remove()
      c.dispose()
      conn.current = null
    }
  }, [target?.hostDeviceId, target?.server, target?.hostKey, identity, attempt])
  useEffect(() => {
    onSession(!!state.session)
    return () => onSession(false)
  }, [onSession, state.session?.sessionId])
  useEffect(() => {
    if (state.error && !state.hello) setEndedShell(null)
  }, [state.error, state.hello])
  const leave = () => {
    if (full) setFull(false)
    else if (info) setInfo(false)
    else if (target) setTarget(null)
    else onBack()
  }
  const back = () => {
    resetInput.current?.()
    if (state.session && !full && !info) {
      Alert.alert(t('End this session?'), target?.name, [
        { text: t('Stay'), style: 'cancel' },
        { text: t('End session'), onPress: () => setTarget(null) },
      ])
      return
    }
    leave()
  }
  useEffect(() => {
    const remove = BackHandler.addEventListener('hardwareBackPress', () => {
      back()
      return true
    })
    return () => remove.remove()
  })
  const session = state.session,
    hello = state.hello
  useEffect(() => {
    if (!session) setFull(false)
  }, [session?.sessionId])
  function start(mode: Mode) {
    if (!conn.current) return
    const run = () => {
      setEndedShell(null)
      setLastDesktop(null)
      void conn.current?.start(mode, randomUUID())
    }
    if (mode === 'terminal') {
      Alert.alert(
        t('Open terminal?'),
        t('Open a shell as {account} on {name}', { account: hello?.account ?? '', name: target?.name ?? '' }),
        [
          { text: t('Cancel'), style: 'cancel' },
          { text: t('Open terminal'), onPress: run },
        ],
      )
    } else run()
  }
  const close = (reason?: string, stats?: DesktopStats) => {
    resetInput.current?.()
    setEndedShell(null)
    if (reason && stats) setLastDesktop({ reason, stats })
    setFull(false)
    void conn.current?.end(reason)
  }
  function switchMode(mode: Mode) {
    const connection = conn.current
    if (!connection || !session || session.mode === mode) return
    resetInput.current?.()
    const message =
      mode === 'terminal'
        ? t('Open a shell as {account} on {name}', { account: hello?.account ?? '', name: target?.name ?? '' })
        : t('This closes the current shell on {name}.', { name: target?.name ?? '' })
    Alert.alert(t('End session and switch?'), message, [
      { text: t('Stay'), style: 'cancel' },
      {
        text: t('End and switch'),
        onPress: () => {
          setFull(false)
          void connection.end().then(() => connection.start(mode, randomUUID()))
        },
      },
    ])
  }
  const immersive =
    full || (session?.mode === 'desktop' && session.state === 'approved' && dimensions.width > dimensions.height)
  const shellId = session?.state === 'approved' && session.mode === 'terminal' ? session.sessionId : endedShell?.id
  const activeSurface = !!shellId || session?.state === 'approved'
  const TargetPane = activeSurface ? View : ScrollView
  const targetLayout = { padding: immersive ? 4 : 14, gap: 9 }
  const safeSides = { paddingLeft: insets.left, paddingRight: insets.right }
  const disconnect = () => {
    resetInput.current?.()
    Alert.alert(t('End this session?'), target?.name, [
      { text: t('Stay'), style: 'cancel' },
      { text: t('Disconnect'), onPress: () => close() },
    ])
  }
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, ...safeSides, backgroundColor: p.main }}
      behavior="height"
    >
      {!immersive && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 12,
            minHeight: 52,
            borderBottomWidth: 1,
            borderBottomColor: p.line,
          }}
        >
          <Action label={target ? 'Computers' : 'Back'} onPress={back} />
          <Text style={{ flex: 1, flexShrink: 1, textAlign: 'center', color: p.ink2, fontWeight: '600' }}>
            {t('Remote computers')}
          </Text>
          {target ? (
            <Action
              label="Details"
              onPress={() => {
                resetInput.current?.()
                setInfo(!info)
              }}
            />
          ) : (
            <Action label="Pair" onPress={onPair} />
          )}
        </View>
      )}
      {!target ? (
        <ScrollView contentContainerStyle={{ padding: 18, gap: 12 }}>
          <Text style={[typeScale.largeTitle, { color: p.ink }]}>{t('Computers')}</Text>
          {!items.length ? (
            <View style={{ padding: 18, backgroundColor: p.card, borderRadius: 12, gap: 10 }}>
              <Text style={{ color: p.cardInk, fontWeight: '600' }}>{t('Pair your first computer')}</Text>
              <Text style={{ color: p.cardSecondary }}>
                {t('Create a pairing offer in Godbot Computer Host on your Mac or Linux computer.')}
              </Text>
              <Action label="Pair computer" primary onPress={onPair} />
            </View>
          ) : (
            items.map((item) => (
              <Pressable
                key={item.hostDeviceId}
                accessibilityRole="button"
                accessibilityLabel={item.name}
                accessibilityHint={[
                  item.os,
                  t(item.desktop ? 'Desktop' : 'No graphical session'),
                  item.terminal ? t('Terminal') : null,
                  item.lastConnected
                    ? t('Last connected') + ' ' + new Date(item.lastConnected).toLocaleString()
                    : t('Check availability'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onPress={() => setTarget(item)}
                style={({ pressed }) => ({
                  padding: 16,
                  borderRadius: 12,
                  backgroundColor: p.card,
                  transform: [{ scale: pressed ? 0.99 : 1 }],
                  borderColor: p.line2,
                  borderWidth: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                })}
              >
                <Text style={{ color: p.cardAccent, fontSize: 24 }}>{item.desktop ? '▣' : '›_'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: p.cardInk, fontSize: 17, fontWeight: '600' }}>{item.name}</Text>
                  <Text style={{ color: p.cardSecondary }}>
                    {[
                      item.os,
                      t(item.desktop ? 'Desktop' : 'No graphical session'),
                      item.terminal ? t('Terminal') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <Text style={{ color: p.cardSecondary }}>
                    {item.lastConnected
                      ? t('Last connected') + ' · ' + new Date(item.lastConnected).toLocaleString()
                      : t('Check availability')}
                  </Text>
                </View>
                <Text style={{ color: p.cardSecondary }}>›</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      ) : (
        <TargetPane
          style={activeSurface ? { flex: 1, ...targetLayout } : { flex: 1 }}
          {...(!activeSurface && {
            contentContainerStyle: { flexGrow: 1, ...targetLayout },
            keyboardShouldPersistTaps: 'handled' as const,
          })}
        >
          {!immersive && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={2} style={[typeScale.largeTitle, { color: p.ink }]}>
                  {target.name}
                </Text>
                <Text style={{ color: p.ink2 }}>
                  {target.os} · {t(hello ? 'Online' : state.connecting ? 'Connecting…' : 'Not connected')}
                </Text>
              </View>
              {session && <Action label="Disconnect" onPress={disconnect} />}
            </View>
          )}
          {!immersive && session && hello?.desktop && hello.terminal && (
            <View style={{ flexDirection: 'row', gap: 5 }}>
              {(['desktop', 'terminal'] as const).map((mode) => (
                <Pressable
                  key={mode}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: session.mode === mode }}
                  onPress={() => switchMode(mode)}
                  style={{
                    paddingHorizontal: 16,
                    minHeight: 48,
                    justifyContent: 'center',
                    borderRadius: 10,
                    backgroundColor: session.mode === mode ? p.active : p.card,
                  }}
                >
                  <Text style={{ color: p.ink, fontWeight: session.mode === mode ? '600' : '400' }}>
                    {t(mode === 'desktop' ? 'Desktop' : 'Terminal')}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {state.error && (
            <Text accessibilityRole="alert" style={{ color: p.ink2, paddingVertical: 8 }}>
              {t(state.error)}
            </Text>
          )}
          {lastDesktop && !session && <Action label="Session details" onPress={() => setFailedDetails(true)} />}
          {state.connecting && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator color={p.accent} />
              <Action
                label="Cancel"
                onPress={() => {
                  conn.current?.dispose()
                  setTarget(null)
                }}
              />
            </View>
          )}
          {!hello && !state.connecting && <Action label="Reconnect" primary onPress={() => retry((n) => n + 1)} />}
          {hello && !session && !endedShell && !state.connecting && (
            <View
              style={{
                padding: 15,
                gap: 12,
                backgroundColor: p.card,
                borderColor: p.line,
                borderWidth: 1,
                borderRadius: 12,
              }}
            >
              <Text style={{ color: p.cardInk, fontSize: 17, fontWeight: '600' }}>{t('Available sessions')}</Text>
              <Action label="Check availability" onPress={() => void conn.current?.refresh()} />
              {hello.desktop ? (
                <Action
                  label={lastDesktop ? 'Retry desktop' : 'View desktop'}
                  primary
                  onPress={() => start('desktop')}
                />
              ) : (
                <Text style={{ color: p.cardSecondary }}>{t(hello.desktopReason || 'No graphical session')}</Text>
              )}
              {hello.terminal && (
                <>
                  <Text style={{ color: p.cardSecondary }}>
                    {t('Shell account')} · {hello.account}
                  </Text>
                  <Action label="Open terminal" primary={!hello.desktop} onPress={() => start('terminal')} />
                </>
              )}
            </View>
          )}
          {session?.state === 'pending' && (
            <View style={{ padding: 12, gap: 9 }}>
              <Text style={{ color: p.ink }}>{t('Waiting for approval on {name}', { name: target.name })}</Text>
              <Action label="Cancel request" onPress={() => close()} />
            </View>
          )}
          {endedShell && (
            <View style={{ gap: 8 }}>
              <Text accessibilityLiveRegion="polite" style={{ color: p.ink, fontWeight: '600' }}>
                {t('Shell ended')} · {t('Exit code')} {endedShell.code ?? '—'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                <Action label="Open new terminal" primary onPress={() => start('terminal')} />
                <Action label="Back to computer" onPress={() => setEndedShell(null)} />
              </View>
            </View>
          )}
          {shellId && conn.current?.client && (
            <MachineTerminal
              key={shellId}
              client={conn.current.client}
              sessionId={shellId}
              onEnd={close}
              onExit={(code) => {
                setEndedShell({ id: shellId, code })
                void conn.current?.end()
              }}
            />
          )}
          {session?.state === 'approved' && session.mode === 'desktop' && conn.current?.client && (
            <MachineDesktop
              key={session.sessionId}
              client={conn.current.client}
              session={session}
              onEnd={close}
              resetInput={resetInput}
              canControl={!!hello?.control}
              controlReason={
                hello?.os === 'macOS'
                  ? 'Allow Accessibility for Godbot Computer Host on the Mac.'
                  : 'The desktop session must grant keyboard and pointer access.'
              }
              onRefresh={() => void conn.current?.refresh()}
              name={target.name}
              onDisconnect={disconnect}
              onControl={(v) => void conn.current?.control(v)}
              full={full}
              onFull={() => setFull(!full)}
            />
          )}
        </TargetPane>
      )}
      {lastDesktop && (
        <Modal visible={failedDetails} transparent onRequestClose={() => setFailedDetails(false)}>
          <View style={{ flex: 1, justifyContent: 'flex-end', ...safeSides, backgroundColor: '#0008' }}>
            <ScrollView
              style={{ flexGrow: 0, maxHeight: '85%', backgroundColor: p.card }}
              contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 16, gap: 10 }}
            >
              <Text style={[typeScale.largeTitle, { color: p.cardInk }]}>{t('Session details')}</Text>
              <Text style={{ color: p.cardInk }}>
                {target?.name} · {t(lastDesktop.reason)}
              </Text>
              <Text style={{ color: p.cardSecondary }}>
                {t('Connection route')} · {t(lastDesktop.stats.route ?? 'Not available')}
              </Text>
              <Text style={{ color: p.cardSecondary }}>
                {t('Video codec')} · {lastDesktop.stats.codec ?? t('Not available')}
              </Text>
              <Text style={{ color: p.cardSecondary }}>
                {t('Frame rate')} ·{' '}
                {lastDesktop.stats.fps !== undefined ? lastDesktop.stats.fps + ' fps' : t('Not available')}
              </Text>
              <Action label="Done" onPress={() => setFailedDetails(false)} />
            </ScrollView>
          </View>
        </Modal>
      )}
      {target && (
        <Modal visible={info} animationType="slide" onRequestClose={() => setInfo(false)}>
          <View
            style={{
              flex: 1,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              ...safeSides,
              backgroundColor: p.main,
            }}
          >
            <ScrollView contentContainerStyle={{ padding: 18, gap: 12 }}>
              <Text style={[typeScale.largeTitle, { color: p.ink }]}>{target.name}</Text>
              {[
                [t('Host fingerprint'), identityFingerprint(target.hostKey)],
                [t('Server'), target.server],
                [
                  t('Available sessions'),
                  [
                    (hello?.desktop ?? target.desktop) ? t('Desktop') : '',
                    (hello?.terminal ?? target.terminal) ? t('Terminal') : '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || t('Not available'),
                ],
                [t('Shell account'), hello?.account ?? target.account],
                [
                  t('Last connected'),
                  new Date(
                    items.find((i) => i.hostDeviceId === target.hostDeviceId)?.lastConnected ?? target.lastConnected,
                  ).toLocaleString(),
                ],
              ].map(([k, v]) => (
                <View key={k}>
                  <Text style={{ color: p.ink2 }}>{k}</Text>
                  <Text selectable style={{ color: p.ink }}>
                    {v}
                  </Text>
                </View>
              ))}
              <Action
                label="Forget computer"
                onPress={() =>
                  Alert.alert(
                    t('Forget {name}?', { name: target.name }),
                    t('This removes this computer from this phone and closes its session.'),
                    [
                      { text: t('Cancel'), style: 'cancel' },
                      {
                        text: t('Forget'),
                        style: 'destructive',
                        onPress: () => {
                          conn.current?.dispose()
                          void forgetMachine(target.hostDeviceId).then(load)
                          setTarget(null)
                        },
                      },
                    ],
                  )
                }
              />
              <Text style={{ color: p.ink2 }}>
                {t(
                  'To revoke access on the computer, open Godbot Computer Host and remove this phone from Paired controllers.',
                )}
              </Text>
              <Action label="Done" onPress={() => setInfo(false)} />
            </ScrollView>
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  )
}
