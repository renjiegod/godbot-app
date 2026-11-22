import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from 'react-native'
import { requireNativeView } from 'expo'
import type { ViewProps, NativeSyntheticEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RTCView } from 'react-native-webrtc'
import type { RpcClient } from '../../godbot/link/index.ts'
import { Action } from './Action.tsx'
import { connectDesktop, type DesktopPeer, type DesktopStats } from './desktop-peer.ts'
import { hasTurnServer } from './desktop-readiness.ts'
import { TrackpadHold } from './trackpad-hold.ts'
import { machineError, type Session, type Display } from './model.ts'
import { useMachinePalette } from './appearance.ts'
import { t } from '../ui/i18n.ts'

const HardwareKeyboard = requireNativeView<
  ViewProps & {
    label: string
    onHardwareKey: (e: NativeSyntheticEvent<{ code: string; down: boolean }>) => void
    onKeyboardBlur: () => void
  }
>('GodbotNative')
const bound = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
export function MachineDesktop({
  client,
  session,
  onControl,
  onEnd,
  canControl,
  controlReason,
  onRefresh,
  full,
  onFull,
  name,
  onDisconnect,
  resetInput,
}: {
  client: RpcClient
  session: Session
  onControl: (grant: boolean) => void
  onEnd: (reason?: string, diagnostics?: DesktopStats) => void
  resetInput: RefObject<(() => void) | null>
  controlReason: string
  onRefresh: () => void
  canControl: boolean
  full: boolean
  onFull: () => void
  name: string
  onDisconnect: () => void
}) {
  const p = useMachinePalette(),
    { width, height } = useWindowDimensions(),
    insets = useSafeAreaInsets()
  const [relayOnly, setRelayOnly] = useState(false)
  const [quality, setQuality] = useState<'balanced' | 'low'>('balanced')
  const hasTurn = hasTurnServer(session.iceServers)
  const [displays, setDisplays] = useState<Display[]>([]),
    [selected, select] = useState<string>(),
    [url, setUrl] = useState<string>()
  const [stats, setStats] = useState<DesktopStats>({ live: false }),
    [details, setDetails] = useState(false),
    [keyboard, setKeyboard] = useState(false),
    [text, setText] = useState('')
  const [viewport, setViewport] = useState({ zoom: 1, x: 0, y: 0 }),
    [stage, setStage] = useState({ width: 1, height: 1 })
  const [shownStats, setShownStats] = useState<DesktopStats>({ live: false })
  const showDetails = () => {
    cancelGesture()
    setShownStats(stats)
    setDetails(true)
  }
  const selectedDisplay = displays.find((d) => d.id === selected) ?? displays[0]
  const generation = useRef(0),
    peer = useRef<DesktopPeer | null>(null),
    current = useRef(session),
    end = useRef(onEnd)
  current.current = session
  end.current = onEnd
  const pos = useRef({ x: 0.5, y: 0.5 }),
    hold = useRef(new TrackpadHold())
  const latestStats = useRef<DesktopStats>({ live: false })
  const pointer = useRef({ x: 0, y: 0, start: 0, moved: 0, multi: false, drag: false, lastScroll: 0 })
  const cancelGesture = useCallback(() => {
    hold.current.finish()
    pointer.current.drag = false
    peer.current?.send({ type: 'reset' })
  }, [])
  useLayoutEffect(() => {
    resetInput.current = cancelGesture
    cancelGesture()
    return () => {
      resetInput.current = null
      cancelGesture()
    }
  }, [cancelGesture, resetInput, width, full])
  useEffect(() => {
    const listener = AppState.addEventListener('blur', cancelGesture)
    return () => listener.remove()
  }, [cancelGesture])
  const pinch = useRef({ distance: 0, startZoom: 1, x: 0, y: 0, dx: 0, dy: 0 })
  useEffect(() => {
    const abort = new AbortController()
    void client
      .rpc<{ displays: Display[] }>('desktop.displays', { sessionId: session.sessionId }, { signal: abort.signal })
      .then((res) => {
        if (!res.displays.length) throw new Error('No graphical session')
        setDisplays(res.displays)
      })
      .catch((e) => {
        if (!abort.signal.aborted) end.current(machineError(e), latestStats.current)
      })
    return () => abort.abort()
  }, [client, session.sessionId])
  useEffect(() => {
    if (!selectedDisplay) return
    setUrl(undefined)
    latestStats.current = { live: false }
    setStats(latestStats.current)
    setViewport({ zoom: 1, x: 0, y: 0 })
    pos.current = { x: 0.5, y: 0.5 }
    let connection: DesktopPeer
    try {
      connection = connectDesktop(
        client,
        current.current,
        selectedDisplay,
        ++generation.current,
        relayOnly,
        quality,
        setUrl,
        (next) => {
          latestStats.current = next
          setStats(next)
        },
        (e) => end.current(machineError(e), latestStats.current),
      )
    } catch (error) {
      end.current(machineError(error), latestStats.current)
      return
    }
    peer.current = connection
    return () => {
      cancelGesture()
      connection.close()
      peer.current = null
    }
  }, [
    client,
    session.sessionId,
    selectedDisplay?.id,
    selectedDisplay?.revision,
    session.iceGeneration,
    relayOnly,
    quality,
  ])
  useEffect(() => {
    if (!session.control) {
      cancelGesture()
      setKeyboard(false)
      setText('')
    }
  }, [session.control])
  const input = (e: Parameters<DesktopPeer['send']>[0]) => {
    if (current.current.control && stats.live) peer.current?.send(e)
  }
  function click(button: 0 | 2) {
    input({ type: 'button', button, down: true, ...pos.current })
    input({ type: 'button', button, down: false, ...pos.current })
  }
  function padStart(e: GestureResponderEvent) {
    const touch = e.nativeEvent.touches[0]
    if (!touch) return
    pointer.current = {
      x: touch.pageX,
      y: touch.pageY,
      start: Date.now(),
      moved: 0,
      multi: false,
      drag: false,
      lastScroll: Date.now(),
    }
    hold.current.start(() => {
      const gesture = pointer.current
      if (!gesture.multi && gesture.moved < 6 && current.current.control) {
        gesture.drag = true
        input({ type: 'button', button: 0, down: true, ...pos.current })
      }
    })
  }
  function padMove(e: GestureResponderEvent) {
    if (!hold.current.active) return
    const points = e.nativeEvent.touches,
      first = points[0]
    if (!first) return
    const g = pointer.current,
      dx = first.pageX - g.x,
      dy = first.pageY - g.y
    g.x = first.pageX
    g.y = first.pageY
    g.moved += Math.hypot(dx, dy)
    if (points.length > 1) g.multi = true
    if (g.multi || g.moved >= 6) hold.current.disarm()
    if (g.multi) {
      if (dx || dy) input({ type: 'wheel', dx, dy, ...pos.current })
      return
    }
    pos.current = {
      x: bound(pos.current.x + dx / Math.max(150, width * 0.8), 0, 1),
      y: bound(pos.current.y + dy / Math.max(140, width * 0.5), 0, 1),
    }
    input({ type: 'move', ...pos.current })
  }
  function padEnd(cancel = false) {
    if (!hold.current.finish()) return
    const g = pointer.current
    if (g.drag) input({ type: 'button', button: 0, down: false, ...pos.current })
    else if (!cancel && g.moved < 8) click(g.multi ? 2 : 0)
    if (cancel) input({ type: 'reset' })
  }
  function localPan(e: GestureResponderEvent, start: boolean) {
    const [a, b] = e.nativeEvent.touches
    if (!a) return
    const distance = b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0
    if (start || !!pinch.current.distance !== !!distance) {
      pinch.current = { distance, startZoom: viewport.zoom, x: a.pageX, y: a.pageY, dx: viewport.x, dy: viewport.y }
      return
    }
    const g = pinch.current,
      z = distance ? bound((g.startZoom * distance) / g.distance, 1, 3) : viewport.zoom
    setViewport({
      zoom: z,
      x: bound(g.dx + a.pageX - g.x, (-stage.width * (z - 1)) / 2, (stage.width * (z - 1)) / 2),
      y: bound(g.dy + a.pageY - g.y, (-stage.height * (z - 1)) / 2, (stage.height * (z - 1)) / 2),
    })
  }
  const landscape = width > height,
    screenWidth = full ? width : width - 32
  const ratio = selectedDisplay ? selectedDisplay.width / selectedDisplay.height : 16 / 9
  const screenHeight = landscape
    ? Math.max(96, height - insets.top - insets.bottom - 160)
    : bound(screenWidth / ratio, 100, height * 0.43)
  const viewer = (
    <View style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: '#202521' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 10,
          minHeight: 48,
        }}
      >
        <Text style={{ color: stats.live ? '#c3e7ca' : '#e9e9df' }} accessibilityLiveRegion="polite">
          {t(stats.live ? 'Live desktop' : stats.offerAccepted ? 'Waiting for video…' : 'Waiting for screen sharing…')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Display settings')}
          onPress={showDetails}
          style={{ padding: 12 }}
        >
          <Text style={{ color: '#fff' }}>{selectedDisplay?.name ?? t('Display')} ▾</Text>
        </Pressable>
      </View>
      <View
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout
          setStage({ width, height })
        }}
        style={{ height: screenHeight, overflow: 'hidden', backgroundColor: '#111' }}
        onStartShouldSetResponder={() => true}
        onResponderGrant={(e) => localPan(e, true)}
        onResponderMove={(e) => localPan(e, false)}
      >
        {url && (
          <RTCView
            streamURL={url}
            objectFit="contain"
            style={{
              flex: 1,
              transform: [{ translateX: viewport.x }, { translateY: viewport.y }, { scale: viewport.zoom }],
            }}
          />
        )}
        {!stats.offerAccepted && !stats.live && (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, gap: 8 }}>
            <Text style={{ color: '#f1f3ed', textAlign: 'center' }}>
              {t('Choose a screen on {name} if prompted.', { name })}
            </Text>
            <Action label="Cancel" onPress={() => onEnd()} />
          </View>
        )}
      </View>
      <View
        style={{ padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
      >
        <Text accessibilityLiveRegion="polite" style={{ flex: 1, color: '#f1f3ed', fontWeight: '600' }}>
          {t(session.control ? 'You have control' : session.controlPending ? 'Awaiting approval' : 'View only')}
        </Text>
        <Action
          label={session.control ? 'Release control' : session.controlPending ? 'Cancel request' : 'Request control'}
          primary={!session.control}
          disabled={!stats.live || !canControl}
          onPress={() => onControl(!session.control && !session.controlPending)}
        />
      </View>
    </View>
  )
  const controls = (
    <>
      {!canControl && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: p.ink2 }}>{t(controlReason)}</Text>
          <Action label="Check availability" onPress={onRefresh} />
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
        {!landscape && <Action label={full ? 'Exit full screen' : 'Full screen'} onPress={onFull} />}
        <Action label="Session details" onPress={showDetails} />
      </View>
      {session.control && stats.live && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: p.ink, fontWeight: '600' }}>{t('Touchpad')}</Text>
          <View
            accessible
            accessibilityLabel={t('Remote touchpad')}
            style={{
              height: landscape ? 86 : 130,
              borderRadius: 12,
              borderColor: p.padLine,
              borderWidth: 1,
              backgroundColor: p.sidebar,
            }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={padStart}
            onResponderMove={padMove}
            onResponderStart={(e) => {
              if (e.nativeEvent.touches.length > 1) {
                pointer.current.multi = true
                hold.current.disarm()
              }
            }}
            onResponderRelease={() => padEnd()}
            onResponderTerminate={() => padEnd(true)}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {[
              ['Click', () => click(0)],
              ['Right-click', () => click(2)],
              [
                'Keyboard',
                () => {
                  cancelGesture()
                  setKeyboard(true)
                },
              ],
              ['Scroll up', () => input({ type: 'wheel', dx: 0, dy: -120, ...pos.current })],
              ['Scroll down', () => input({ type: 'wheel', dx: 0, dy: 120, ...pos.current })],
            ].map(([label, action]) => (
              <Action key={String(label)} label={String(label)} onPress={action as () => void} />
            ))}
          </View>
        </View>
      )}
    </>
  )
  return (
    <View style={{ flex: 1 }}>
      {full && !landscape && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={2} style={{ flex: 1, color: p.ink, fontWeight: '600' }}>
            {name}
          </Text>
          <Action label="Disconnect" onPress={onDisconnect} />
        </View>
      )}
      {landscape ? (
        <View style={{ flex: 1, flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, justifyContent: 'center' }}>{viewer}</View>
          <ScrollView
            style={{ width: 210, flexGrow: 0 }}
            contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text numberOfLines={2} style={{ color: p.ink, fontSize: 18, fontWeight: '600' }}>
              {name}
            </Text>
            <Action label="Disconnect" onPress={onDisconnect} />
            {controls}
          </ScrollView>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: 10, paddingBottom: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {viewer}
          {controls}
        </ScrollView>
      )}
      <Modal visible={details} transparent onRequestClose={() => setDetails(false)}>
        <View
          style={{
            flex: 1,
            paddingLeft: insets.left,
            paddingRight: insets.right,
            justifyContent: 'flex-end',
            backgroundColor: '#0008',
          }}
        >
          <ScrollView
            style={{ flexGrow: 0, maxHeight: '88%', backgroundColor: p.card }}
            contentContainerStyle={{ padding: 18, gap: 8, paddingBottom: insets.bottom + 24 }}
          >
            <Text style={{ fontSize: 20, fontWeight: '600', color: p.cardInk }}>{t('Display settings')}</Text>
            {displays.map((display) => (
              <Action
                key={display.id}
                label={display.name + ' · ' + display.width + ' × ' + display.height}
                primary={display.id === selectedDisplay?.id}
                onPress={() => {
                  select(display.id)
                  setDetails(false)
                }}
              />
            ))}
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {[1, 1.5, 2].map((z) => (
                <Action
                  key={z}
                  label={z === 1 ? 'Fit' : z + '×'}
                  onPress={() => {
                    setViewport({ zoom: z, x: 0, y: 0 })
                    setDetails(false)
                  }}
                />
              ))}
            </View>
            <Text style={{ color: p.cardSecondary }}>
              {[
                shownStats.route && t(shownStats.route),
                shownStats.codec,
                shownStats.width && shownStats.height ? shownStats.width + ' × ' + shownStats.height : null,
                shownStats.kbps !== undefined ? shownStats.kbps + ' kbit/s' : null,
                shownStats.bytes !== undefined ? shownStats.bytes + ' B' : null,
                shownStats.drops !== undefined ? shownStats.drops + ' ' + t('frames dropped') : null,
                shownStats.fps !== undefined ? shownStats.fps + ' fps' : null,
                shownStats.rtt !== undefined ? shownStats.rtt + ' ms' : null,
              ]
                .filter(Boolean)
                .join(' · ') || t('Not available')}
            </Text>
            <Action label="Refresh stats" onPress={() => setShownStats(stats)} />
            <Action
              label={quality === 'low' ? 'Bandwidth saver on' : 'Bandwidth saver off'}
              primary={quality === 'low'}
              onPress={() => {
                setQuality(quality === 'low' ? 'balanced' : 'low')
                setDetails(false)
              }}
            />
            <Action
              label={relayOnly ? 'Use automatic route' : 'Use TURN only'}
              disabled={!hasTurn}
              onPress={() => {
                setRelayOnly(!relayOnly)
                setDetails(false)
              }}
            />
            <Action label="Done" onPress={() => setDetails(false)} />
          </ScrollView>
        </View>
      </Modal>
      <Modal
        visible={keyboard}
        transparent
        onRequestClose={() => {
          cancelGesture()
          setKeyboard(false)
        }}
      >
        <View
          style={{
            flex: 1,
            paddingLeft: insets.left,
            paddingRight: insets.right,
            justifyContent: 'flex-end',
            backgroundColor: '#0008',
          }}
        >
          <View style={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 8, backgroundColor: p.card }}>
            <Text style={{ color: p.ink, fontWeight: '600' }}>{t('Remote keyboard')}</Text>
            <HardwareKeyboard
              label={t('Tap to use a physical keyboard')}
              style={{ height: 48 }}
              onHardwareKey={({ nativeEvent }) =>
                input({ type: 'key', code: nativeEvent.code, down: nativeEvent.down })
              }
              onKeyboardBlur={() => input({ type: 'reset' })}
            />
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              autoFocus
              accessibilityLabel={t('Text to send')}
              style={{ color: p.cardInk, borderColor: p.line2, borderWidth: 1, padding: 10, minHeight: 55 }}
            />
            <View style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
              {[
                ['Escape', 'Esc'], ['Tab', 'Tab'], ['Enter', 'Enter'], ['Backspace', 'Backspace'],
                ['ArrowLeft', 'Left arrow'], ['ArrowRight', 'Right arrow'],
              ].map(([code, label]) => (
                <Action
                  key={code}
                  label={label}
                  onPress={() => {
                    input({ type: 'key', code, down: true })
                    input({ type: 'key', code, down: false })
                  }}
                />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Action
                label="Send text"
                primary
                disabled={!text}
                onPress={() => {
                  input({ type: 'text', text })
                  setText('')
                  cancelGesture()
                  setKeyboard(false)
                }}
              />
              <Action
                label="Done"
                onPress={() => {
                  cancelGesture()
                  setKeyboard(false)
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}
