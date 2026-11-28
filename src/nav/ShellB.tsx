// Modified for Godbot. See NOTICE.
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StackActions, useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native'
import { useContext, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Image, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import * as Notifications from 'expo-notifications'
import { targetOf } from '../team/push-payload.ts'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as SecureStore from 'expo-secure-store'
import { onPrefsChange, readPrefs } from '../store.ts'
import { Drawer, useDrawer } from './Drawer.tsx'
import { ComputersCtx } from './computers.ts'
import { DEMO, useTeam } from '../team/context.tsx'
import { ErrorBoundary } from '../ui/error-boundary.tsx'
import { hostText, t } from '../ui/i18n.ts'
import { shadow, type as typeScale, useTheme } from '../ui/tokens.ts'
import { Avatar, RoomAvatar } from '../ui/marks.tsx'
import { ChevronRightIcon, ClockIcon, FolderIcon, GearIcon, PlusIcon, SearchIcon, SidebarIcon, SideIcon } from '../ui/icons.tsx'
import { ChatView, prefetchChat } from '../screens/Chat.tsx'
import { chatLayout } from '../screens/chat/layout.ts'
import { SessionsButton, SessionSheet, useSessionsAvailable } from '../screens/chat/sessions.tsx'
import { modelOf } from '../screens/model-menu.tsx'
import { isLocalModel } from '../team/bot-details.ts'
import { parallelSessions } from '../team/bot-sessions.ts'
import { NeedsYou } from '../screens/NeedsYou.tsx'
import { Settings } from '../screens/Settings.tsx'
import { TeamList, type ChatTarget } from '../screens/TeamList.tsx'
import { Automation } from '../screens/automation.tsx'
import { boardCommentTarget } from '../team/work-board-link.ts'
import { WorkBoardScreen } from '../screens/work-board.tsx'
import { BotDetails, BotEdit, NewBot, NewGroup, GroupDetails, GroupSettings, Memory, Folder, Usage, Computers, Secrets } from '../screens/manage.tsx'
import { Providers, Connectors, Capabilities, TeamUsage, Location, Updates, About } from '../screens/settings-pages.tsx'
import { LocalAgentUsage } from '../screens/local-agent-usage.tsx'
import { Side } from '../screens/side.tsx'
import { BotBrowser } from '../screens/manage.tsx'
import type { Bot, Room } from '../connection.ts'
import { pendingCountOf } from './pending.ts'
import { activeChatTarget, openChat } from './open-chat.ts'
import { Sheet, SheetHeader } from './sheet.tsx'
import { SidebarMenu, type SidebarMenuView } from './sidebar-menu.tsx'
import { lastChatKey, lastChatOf, primaryBot, type RosterEntry, type RosterSection } from './sidebar-roster.ts'

const Stack = createNativeStackNavigator()

function DrawerContent() {
  const computers = useContext(ComputersCtx)
  const { p } = useTheme()
  const { team, computer, online, error, call } = useTeam()
  const insets = useSafeAreaInsets()
  const navigation = useNavigation<NavigationProp<ParamListBase>>()
  const drawer = useDrawer()
  const pending = pendingCountOf(team)
  const fallbackId = (primaryBot(team) ?? team?.bots?.[0])?.id
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<SidebarMenuView | null>(null)
  const canWrite = online && team !== null && !team.readOnly
  const writeError = (cause: unknown) => Alert.alert(t('Error'), hostText(cause instanceof Error ? cause.message : String(cause)))
  const openScreen = (screen: string, params?: object) => { setMenu(null); drawer.close(); navigation.navigate(screen, params) }
  const showSettings = (entry: RosterEntry) => {
    if (entry.kind === 'bot') openScreen('BotEdit', { botId: entry.item.id })
    else openScreen('GroupSettings', { roomId: entry.item.id })
  }
  // The chat on screen is marked in the list, as the desktop marks its open chat. The
  // drawer sits outside the navigator, so it follows the container's own state.
  const [current, setCurrent] = useState<ChatTarget | undefined>(undefined)
  useEffect(() => {
    const update = () => setCurrent(activeChatTarget(navigation.getState(), fallbackId))
    update()
    return navigation.addListener('state', update)
  }, [navigation, fallbackId])
  // A chat replaces the one on screen; nothing stays stacked under it. Needs you and
  // Settings slide up over the chat and go back down to it.
  const open = async (target: ChatTarget) => {
    const item = target.kind === 'bot' ? team?.bots.find(bot => bot.id === target.id) : team?.rooms?.find(room => room.id === target.id)
    if (item?.hidden === true && searching && query.trim() !== '' && canWrite) {
      try { await call('set-flags', { id: target.id, hidden: false }) }
      catch (cause) { writeError(cause); return }
    }
    setSearching(false)
    setQuery('')
    drawer.close()
    openChat(navigation, target)
  }
  const toggleSection = (section: RosterSection) => {
    if (canWrite) void call('section-save', { id: section.id, collapsed: section.collapsed !== true }).catch(writeError)
  }
  const linkStatus = online ? t('Connected') : error ?? t(team === null ? 'Connecting…' : 'Reconnecting…')
  const hostName = computer?.name || computer?.server
  const hostId = computer?.hostDeviceId.slice(-8)
  return (
    <View style={{ flex: 1, backgroundColor: p.sidebar }}>
      <View style={[styles.drawerHead, { paddingTop: insets.top + 6 }]}>
        <View style={styles.brand}>
          <Image source={require('../../assets/favicon.png')} style={{ width: 22, height: 22 }} />
          <Text style={{ color: p.ink, fontSize: 16, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>Godbot</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('New section')} disabled={!canWrite} onPress={() => setMenu({ kind: 'name' })}
          style={[styles.round, { borderColor: p.line, opacity: canWrite ? 1 : 0.45 }]}>
          <FolderIcon size={18} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Search')} onPress={() => setSearching(on => !on)} hitSlop={4} style={[styles.round, { borderColor: p.line, backgroundColor: p.card }]}>
          <SearchIcon size={16} color={p.ink2} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('New')} onPress={() => setMenu({ kind: 'new' })} hitSlop={4} style={[styles.round, { borderColor: p.line, backgroundColor: p.card }]}>
          <PlusIcon size={16} color={p.ink2} />
        </Pressable>
      </View>
      {searching ? (
        <View style={[styles.search, { backgroundColor: p.hover }]}>
          <SearchIcon size={15} color={p.ink3} />
          <TextInput value={query} onChangeText={setQuery} placeholder={t('Search the team')} placeholderTextColor={p.ink3} autoFocus
            style={{ flex: 1, fontSize: 15, paddingVertical: 4, color: p.ink }} autoCapitalize="none" autoCorrect={false} />
        </View>
      ) : null}
      {pending > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => openScreen('Needs')}
          style={({ pressed }) => [styles.needsRow, { backgroundColor: pressed ? p.hover : 'transparent' }]}>
          <Text style={[typeScale.rowName, { color: p.accent, flex: 1 }]}>{t('Needs you')}</Text>
          <View style={[styles.badge, { backgroundColor: p.accent }]}><Text style={{ color: p.accentInk, fontSize: 12, fontWeight: '600' }}>{pending}</Text></View>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        <TeamList onOpen={target => void open(target)} onOptions={entry => setMenu({ kind: 'entry', entry })}
          onSection={section => setMenu({ kind: 'section', section })} onToggleSection={toggleSection}
          query={searching ? query : ''} current={current} />
      </View>
      {menu && <SidebarMenu key={menu.kind} menu={menu} onChange={setMenu}
        onCreate={openScreen} onSettings={showSettings}
        onSectionContext={section => openScreen('Memory', { id: section.id, name: section.name, section: true })} />}
      {!DEMO && (
        <Pressable accessibilityRole="button" onPress={() => computers.machines(team?.prefs)}
          style={[styles.remoteComputers, { borderTopColor: p.line }]}>
          <Text style={[typeScale.rowName, { color: p.ink }]}>{t('Remote computers')}</Text>
          <ChevronRightIcon size={16} color={p.ink2} />
        </Pressable>
      )}
      <View style={[styles.foot, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Settings')} onPress={() => openScreen('Settings')} hitSlop={4} style={[styles.round, { borderColor: p.line, backgroundColor: p.card }]}>
          <GearIcon size={18} color={p.ink2} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={[t('Godbot teams'), hostName, hostId, linkStatus].filter(Boolean).join(', ')}
          onPress={() => openScreen('Settings', { screen: 'Computers', initial: false })} style={styles.host}>
          <View style={[styles.hostDot, { backgroundColor: online ? p.green : p.ink3 }]} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[typeScale.small, { color: p.ink }]} numberOfLines={1}>{hostName ?? t('Godbot teams')}</Text>
            <Text style={[typeScale.caption, { color: p.ink2 }]} numberOfLines={error ? 2 : 1}>{!DEMO ? [hostId, linkStatus].filter(Boolean).join(' · ') : linkStatus}</Text>
          </View>
          <ChevronRightIcon size={14} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Work board')} onPress={() => openScreen('WorkBoard')}
          style={[styles.round, { borderColor:p.line, backgroundColor:p.card }]}><Text style={{color:p.accent,fontSize:18}}>▤</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Automation')} onPress={() => openScreen('Automation')}
          style={[styles.round, { borderColor: p.line, backgroundColor: p.card }]}>
          <ClockIcon size={18} />
        </Pressable>
      </View>
    </View>
  )
}

function Pill({ title, bot, room, bots, conversation, model }: {
  title: string; bot?: Parameters<typeof Avatar>[0]['bot']; room?: Room; bots: Bot[]; conversation: boolean; model?: string
}) {
  const { p, dark } = useTheme()
  if (conversation && bot) return (
    <View style={styles.conversationIdentity}>
      <Avatar bot={bot} dark={dark} size={24} ring={p.main} />
      <View style={styles.conversationTitle}>
        <Text style={[typeScale.rowPreview, { color: p.ink, fontWeight: '600' }]} numberOfLines={1}>{title}</Text>
        {model ? <Text style={[typeScale.caption, { color: p.ink2 }]} numberOfLines={1}>{model}</Text> : null}
      </View>
    </View>
  )
  return (
    <View style={[styles.pill, { backgroundColor: p.card, borderColor: p.line2 }]}>
      {bot ? <Avatar bot={bot} dark={dark} size={24} ring={p.card} /> : room ? <RoomAvatar room={room} bots={bots} dark={dark} size={24} ring={p.card} /> : null}
      <Text style={{ color: p.ink, fontSize: 14, lineHeight: 20, fontWeight: '500', marginLeft: bot || room ? 8 : 0, flexShrink: 1 }} numberOfLines={1}>{title}</Text>
    </View>
  )
}

function Header({ title, bot, room, bots = [], onMenu, onPill, onSide, sessions }: { title: string; bot?: Parameters<typeof Avatar>[0]['bot']; room?: Room; bots?: Bot[]; onMenu: () => void; onPill?: () => void; onSide?: () => void; sessions?: React.ReactNode }) {
  const { p } = useTheme()
  const { team, online, error } = useTeam()
  const pending = pendingCountOf(team) > 0
  const insets = useSafeAreaInsets()
  const conversation = chatLayout(team?.prefs?.layout, bot !== undefined) === 'conversation'
  const currentModel = conversation && bot ? modelOf({ ...bot, model: bot.appliedModel ?? bot.model }, team?.models ?? []) : undefined
  const model = currentModel && isLocalModel(currentModel.ref) && currentModel.ref.endsWith('/default')
    ? `${currentModel.provider} · ${currentModel.name}` : currentModel?.name
  const identity = <Pill title={title} bot={bot} room={room} bots={bots} conversation={conversation} model={model} />
  // The link dropped after the team loaded: the screen keeps what it shows and says so.
  const reconnecting = team !== null && !online
  return (
    <View style={{ backgroundColor: p.main }}>
    <View style={[styles.chatHeader, { paddingTop: insets.top + 4 }, conversation && styles.conversationHeader]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Open team list')} onPress={onMenu} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <SidebarIcon size={20} color={p.ink2} />
        {pending ? <View style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: p.accent }} /> : null}
      </Pressable>
      <View style={[styles.chatHeading, conversation && styles.conversationHeading]}>
        {title === '' ? null
          : bot === undefined && room === undefined ? <Text style={[typeScale.headerTitle, { color: p.ink }]} numberOfLines={1}>{title}</Text>
            : onPill !== undefined ? <Pressable accessibilityRole="button" onPress={onPill} style={{ maxWidth: '100%' }}>{identity}</Pressable> : identity}
      </View>
      {sessions}
      {onSide !== undefined ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('Side chat')} onPress={onSide} hitSlop={8} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <SideIcon size={20} color={p.ink2} />
        </Pressable>
      ) : <View style={{ width: 44 }} />}
    </View>
    {conversation ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.line }} /> : null}
    {reconnecting ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingBottom: 6 }} accessibilityRole="alert">
        <ActivityIndicator size="small" color={p.ink3} />
        <Text style={[typeScale.caption, { color: p.ink2, flexShrink: 1 }]}>{error ?? t('Reconnecting…')}</Text>
      </View>
    ) : null}
    </View>
  )
}

function ChatScreenB({ route, navigation }: any) {
  const { team, error, linked, call, computer } = useTeam()
  const { p, dark } = useTheme()
  const drawer = useDrawer()
  const params = route.params as ChatTarget | undefined
  // On launch the saved chat is read while the team state is still on its way.
  useEffect(() => { if (linked === true && team === null && params !== undefined) prefetchChat(call, computer?.hostDeviceId ?? '', params) }, [linked, team === null])
  const key = lastChatKey(computer?.hostDeviceId ?? 'demo')
  const fallback = primaryBot(team) ?? team?.bots?.[0]
  const kind = params?.kind ?? 'bot'
  const id = params?.id ?? fallback?.id ?? ''
  const bot = kind === 'bot' ? team?.bots?.find(b => b.id === id) : undefined
  const room = kind === 'room' ? team?.rooms?.find(r => r.id === id) : undefined
  const readOnlyPart = params?.readOnlyPart
  const partsRunning = team?.partsRunning
  // The Bot's sessions, from the Sessions button in the top bar.
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const sessionsAvailable = useSessionsAvailable(bot)
  useEffect(() => { setSessionsOpen(false) }, [kind, id])
  useEffect(() => {
    if (readOnlyPart !== undefined && readOnlyPart === bot?.sessionId && partsRunning !== undefined && partsRunning[readOnlyPart] !== true) {
      navigation.setParams({ readOnlyPart: undefined })
    }
  }, [readOnlyPart, bot?.sessionId, partsRunning, navigation])
  // A saved chat that the team no longer has is dropped and falls back to the
  // first Main Bot instead of opening an empty screen.
  const missing = team !== null && params !== undefined && ((kind === 'bot' && bot === undefined) || (kind === 'room' && room === undefined))
  useEffect(() => {
    if (team === null || params === undefined) return
    if (missing) {
      if (fallback !== undefined) navigation.setParams({ kind: 'bot', id: fallback.id, readOnlyPart: undefined })
      else void SecureStore.deleteItemAsync(key).catch(() => {})
    } else {
      void SecureStore.setItemAsync(key, JSON.stringify(params)).catch(() => {})
    }
  }, [team === null, key, params, missing, fallback?.id, navigation])
  const header = <Header title={bot?.name ?? room?.name ?? ''} bot={bot} room={room} bots={team?.bots ?? []} onMenu={() => drawer.open()} onPill={() => { if (bot) navigation.navigate('BotDetails', { botId: bot.id }); else if (room) navigation.navigate('GroupDetails', { roomId: room.id }) }} onSide={bot !== undefined && bot.sessionId !== undefined ? () => navigation.navigate('Side', { bot, sessionId: bot.sessionId }) : undefined}
    sessions={bot !== undefined && sessionsAvailable ? <SessionsButton bot={bot} onPress={() => setSessionsOpen(true)} /> : undefined} />
  if (team === null) return (
    <View style={{ flex: 1, backgroundColor: p.main }}>
      {header}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        <ActivityIndicator color={p.accent} />
        <Text style={[typeScale.caption, { color: p.ink3, textAlign: 'center' }]}>{error ?? t('Connecting…')}</Text>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Settings', { screen: 'Computers', initial: false })} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={[typeScale.caption, { color: p.accent }]}>{t('Computers')}</Text>
        </Pressable>
      </View>
    </View>
  )
  const onMissing = () => {
    if (fallback !== undefined) navigation.setParams({ kind: 'bot', id: fallback.id, readOnlyPart: undefined })
    else void SecureStore.deleteItemAsync(key).catch(() => {})
  }
  // An older computer's desktop keeps a running session it opens read-only until its turn
  // ends; a newer one takes input in any session, the running ones included.
  const sessionReadOnly = !parallelSessions(team) && readOnlyPart !== undefined && readOnlyPart === bot?.sessionId && partsRunning?.[readOnlyPart] === true
  return (
    <>
      <ChatView key={`${computer?.hostDeviceId ?? ''}:${kind}:${id}:${params?.boardPart ?? ''}`} bot={bot} room={room} header={header} onMissing={onMissing}
        boardPart={params?.boardPart} boardMessage={params?.boardMessage} boardTurn={params?.boardTurn} boardReference={params?.boardReference} sessionReadOnly={sessionReadOnly || !!params?.boardPart && params.boardPart !== (bot?.sessionId ?? room?.sessionId ?? id)} />
      {bot !== undefined && sessionsOpen ? <SessionSheet bot={bot} visible onClose={() => setSessionsOpen(false)}
        onOpened={(entry, readOnly) => navigation.setParams({ readOnlyPart: readOnly ? entry.head : undefined })} /> : null}
    </>
  )
}

function NeedsSheet({ navigation }: any) {
  return (
    <Sheet>
      <SheetHeader title={t('Needs you')} right={{ label: t('Done'), onPress: () => navigation.goBack(), strong: true }} />
      <NeedsYou onOpen={target => openChat(navigation, target)} />
    </Sheet>
  )
}

// Settings is a sheet with its own pages: they open inside it, and Done takes the
// whole sheet down to the chat underneath.
const SettingsStack = createNativeStackNavigator()
function SettingsHome({ navigation }: any) {
  return (
    <View style={{ flex: 1 }}>
      <SheetHeader title={t('Settings')} right={{ label: t('Done'), onPress: () => navigation.getParent()?.goBack(), strong: true }} />
      <Settings navigation={navigation} />
    </View>
  )
}
function SettingsSheet() {
  const { p } = useTheme()
  return (
    <Sheet>
      <SettingsStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.main }, animation: Platform.OS === 'android' ? 'slide_from_right' : 'default' }}>
        <SettingsStack.Screen name="SettingsHome" component={SettingsHome} />
        <SettingsStack.Screen name="Computers" component={Computers} />
        <SettingsStack.Screen name="Secrets" component={Secrets} />
        <SettingsStack.Screen name="Providers" component={Providers} />
        <SettingsStack.Screen name="Connectors" component={Connectors} />
        <SettingsStack.Screen name="Capabilities" component={Capabilities} />
        <SettingsStack.Screen name="TeamUsage" component={TeamUsage} />
        <SettingsStack.Screen name="LocalAgentUsage" component={LocalAgentUsage} />
        <SettingsStack.Screen name="Location" component={Location} />
        <SettingsStack.Screen name="Updates" component={Updates} />
        <SettingsStack.Screen name="About" component={About} />
        <SettingsStack.Screen name="Folder" component={Folder} />
      </SettingsStack.Navigator>
    </Sheet>
  )
}

const NOTICE_BANNER_KINDS = new Set(['question', 'approval', 'message', 'group', 'done'])

// A notice that lands while the app is open shows as a banner at the top when
// it belongs to another chat; a tap opens that chat.
function NoticeBanner() {
  const { p } = useTheme()
  const { team, onFeed } = useTeam()
  const { shown: drawerOpen } = useDrawer()
  const navigation = useNavigation<NavigationProp<ParamListBase>>()
  const insets = useSafeAreaInsets()
  const [notice, setNotice] = useState<{ text: string; target: ChatTarget; board: ReturnType<typeof boardCommentTarget>; seq: number } | null>(null)
  const banners = useRef(true)
  const fallbackRef = useRef<string | undefined>(undefined)
  fallbackRef.current = (primaryBot(team) ?? team?.bots?.[0])?.id
  useEffect(() => {
    const read = () => void readPrefs().then(prefs => { banners.current = prefs.banners !== 'off' })
    read()
    return onPrefsChange(read)
  }, [])
  useEffect(() => {
    if (onFeed === undefined) return
    let seq = 0
    return onFeed((event, data) => {
      if (event !== 'notice' || !NOTICE_BANNER_KINDS.has(String(data?.kind ?? '')) || !banners.current) return
      const target: ChatTarget = data.roomId !== undefined && data.roomId !== null
        ? { kind: 'room', id: data.roomId }
        : { kind: 'bot', id: data.botId ?? '' }
      if (!target.id) return
      const board = boardCommentTarget(data)
      const state = navigation.getState()
      const screen = state?.routes[state.index]
      if (board && screen?.name === 'WorkBoard' && (screen.params as { id?: string } | undefined)?.id === board.id) return
      // The chat on screen already shows its own messages and cards.
      const active = activeChatTarget(navigation.getState(), fallbackRef.current)
      if (!board && active?.kind === target.kind && active.id === target.id) return
      const body = typeof data.text === 'string' && data.text.length > 0
        ? data.text
        : data.kind === 'done' ? t('Finished') : t('New reply')
      const head = data.title ?? data.name
      const text = head !== undefined && head !== '' ? `${head}：${body}` : body
      const mine = ++seq
      setNotice({ text, target, board, seq: mine })
      setTimeout(() => setNotice(current => (current?.seq === mine ? null : current)), 8000)
    })
  }, [onFeed, navigation])
  if (notice === null || drawerOpen) return null
  return (
    <Pressable accessibilityRole="button" onPress={() => {
      if (notice.board) navigation.dispatch(StackActions.push('WorkBoard', notice.board))
      else openChat(navigation, notice.target)
      setNotice(null)
    }}
      style={[{ position: 'absolute', top: insets.top + 58, left: 12, right: 12, zIndex: 10, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: p.card, borderColor: p.accent, borderWidth: 1 }, shadow(2)]}>
      <Text style={[typeScale.small, { color: p.ink }]} numberOfLines={2}>{notice.text}</Text>
    </Pressable>
  )
}

// Godbot: a notice that arrives while the app is not on screen becomes a system notification
// (team/keepalive-task.ts, also with no screen at all). A tap on one, or on a pushed one,
// opens its chat.
function BackgroundNotices() {
  const { computer } = useTeam()
  const navigation = useNavigation<NavigationProp<ParamListBase>>()
  const host = computer?.hostDeviceId
  const last = Notifications.useLastNotificationResponse()
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (last === null || last === undefined) return
    const id = last.notification.request.identifier
    if (handled.current === id) return
    handled.current = id
    const data = last.notification.request.content.data as { host?: unknown } | undefined
    // A notice from another paired computer opens nothing here.
    if (typeof data?.host === 'string' && host !== undefined && data.host !== host) return
    const board = boardCommentTarget(data)
    if (board) navigation.dispatch(StackActions.push('WorkBoard', board))
    else {
      const target = targetOf(data)
      if (target !== null) openChat(navigation, target)
    }
  }, [last, host, navigation])
  return null
}

// The chat is the base. Details of a Bot or group push in from the side, with a
// back button and the back swipe; Settings, Needs you and the two Create forms slide
// up as sheets with Done or Cancel.
const PUSH = Platform.OS === 'android' ? 'slide_from_right' as const : 'default' as const
const RISE = Platform.OS === 'android' ? 'slide_from_bottom' as const : 'default' as const
function Inner({ initial }: { initial: ChatTarget | null }) {
  const { p } = useTheme()
  return (
    <View style={{ flex: 1 }}>
    <NoticeBanner />
    <BackgroundNotices />
    <Stack.Navigator initialRouteName="Chat" screenOptions={{ headerShown: false, animation: PUSH, contentStyle: { backgroundColor: p.main } }}>
      <Stack.Screen name="Chat" component={ChatScreenB} initialParams={initial ?? undefined} />
      <Stack.Screen name="BotDetails" component={BotDetails} />
      <Stack.Screen name="BotEdit" component={BotEdit} />
      <Stack.Screen name="SharedCapabilities" component={Capabilities} />
      <Stack.Screen name="GroupDetails" component={GroupDetails} />
      <Stack.Screen name="GroupSettings" component={GroupSettings} />
      <Stack.Screen name="Memory" component={Memory} />
      <Stack.Screen name="Automation" component={Automation} />
      <Stack.Screen name="WorkBoard" component={WorkBoardScreen} />
      <Stack.Screen name="Folder" component={Folder} />
      <Stack.Screen name="Usage" component={Usage} />
      <Stack.Screen name="BotBrowser">{({ route, navigation }: any) => <BotBrowser bot={route.params.bot} navigation={navigation} />}</Stack.Screen>
      <Stack.Screen name="Side">{({ route, navigation }: any) => <Side bot={route.params.bot} sessionId={route.params.sessionId} navigation={navigation} />}</Stack.Screen>
      <Stack.Group screenOptions={{ presentation: 'modal', animation: RISE }}>
        <Stack.Screen name="Settings" component={SettingsSheet} />
        <Stack.Screen name="Needs" component={NeedsSheet} />
        <Stack.Screen name="NewBot" component={NewBot} />
        <Stack.Screen name="NewGroup" component={NewGroup} />
      </Stack.Group>
    </Stack.Navigator>
    </View>
  )
}

export default function ShellB() {
  const { p } = useTheme()
  const { computer } = useTeam()
  const { width: windowWidth } = useWindowDimensions()
  const width = Math.min(Math.max(windowWidth * 0.85, windowWidth - 44), 340, windowWidth)
  const key = lastChatKey(computer?.hostDeviceId ?? 'demo')
  // Render the navigator only once the saved chat is known, so it can start on it.
  const [saved, setSaved] = useState<ChatTarget | null | undefined>(undefined)
  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync(key).then(text => { if (active) setSaved(lastChatOf(text)) }, () => { if (active) setSaved(null) })
    return () => { active = false }
  }, [key])
  // The left edge swipe is the iOS back gesture on pushed screens, so the
  // drawer only claims it while the root Chat is on top. The shell sits
  // outside the navigator, so it tracks the top route through the container's
  // own navigation object instead of useNavigationState.
  const navigation = useNavigation<NavigationProp<ParamListBase>>()
  const [top, setTop] = useState('Chat')
  useEffect(() => {
    const update = () => {
      const state = navigation.getState()
      setTop(state?.routes?.[state.index ?? 0]?.name ?? 'Chat')
    }
    update()
    return navigation.addListener('state', update)
  }, [navigation])
  if (saved === undefined) return <View style={{ flex: 1, backgroundColor: p.main }} />
  return (
    <Drawer width={width} content={<DrawerContent />} edgeEnabled={top === 'Chat'}>
      <ErrorBoundary>
        <Inner initial={saved} />
      </ErrorBoundary>
    </Drawer>
  )
}

const styles = StyleSheet.create({
  chatHeader: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8, paddingHorizontal: 10 },
  conversationHeader: { paddingBottom: 4 },
  chatHeading: { flex: 1, alignItems: 'center', minWidth: 0 },
  conversationHeading: { alignItems: 'flex-start', paddingStart: 4 },
  conversationIdentity: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, minWidth: 0 },
  conversationTitle: { flexShrink: 1, minWidth: 0 },
  needsRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 4, borderRadius: 10, paddingHorizontal: 12, height: 44 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingTop: 6 },
  remoteComputers: { minHeight: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth },
  host: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  hostDot: { width: 6, height: 6, borderRadius: 3 },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: 5 },
  drawerHead: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingBottom: 5 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 8, borderRadius: 10, paddingHorizontal: 10, height: 36 },
  pill: { flexDirection: 'row', alignItems: 'center', height: 40, borderRadius: 20, paddingHorizontal: 14, borderWidth: 0.5, maxWidth: '100%', ...shadow(1) },
})
