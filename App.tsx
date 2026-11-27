import 'react-native-gesture-handler'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Text, useColorScheme, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { DefaultTheme, NavigationContainer, StackActions, useNavigationContainerRef, type NavigationState } from '@react-navigation/native'
import { setLang, t } from './src/ui/i18n.ts'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { loadComputer, loadIdentity, listMachines, onPrefsChange, readPrefs, setActiveComputer, type PhoneIdentity, type SavedComputer } from './src/store.ts'
import { ComputersCtx, type ComputerActions } from './src/nav/computers.ts'
import { errorText } from './src/team/link.ts'
import { isPairingLink } from './src/team/pairing-link.ts'
import { parseBoardCommentLink, parseBoardViewLink } from './src/team/work-board-link.ts'
import { pauseKeepAlive, syncKeepAlive } from './src/team/keepalive.ts'
import { loadSeen } from './src/team/seen.ts'
import { DEMO, DemoProvider, TeamProvider, useTeam } from './src/team/context.tsx'
import { ErrorBoundary } from './src/ui/error-boundary.tsx'
import { palette, ThemeContext, useTheme } from './src/ui/tokens.ts'
import { Pair } from './src/screens/Pair.tsx'
import ShellB from './src/nav/ShellB.tsx'
import { RemoteComputers } from './src/machine/Computers.tsx'
import { type SavedMachine } from './src/machine/model.ts'

// Colors follow the computer's prefs plus the phone's light/dark mode. The
// local appearance pref overrides the system scheme.
function useDark(): boolean {
  const system = useColorScheme() === 'dark'
  const [override, setOverride] = useState<string | null>(null)
  useEffect(() => {
    void readPrefs().then(prefs => setOverride(prefs.theme ?? 'system'))
    return onPrefsChange(() => void readPrefs().then(prefs => setOverride(prefs.theme ?? 'system')))
  }, [])
  return override === 'dark' || (override !== 'light' && system)
}

// The phone's language pref; undefined until read, so the first frame is not in the wrong language.
function useLang(): string | undefined {
  const [lang, setLangState] = useState<string | undefined>(undefined)
  useEffect(() => {
    const apply = (prefs: Record<string, string>) => {
      const next = prefs.lang === 'zh' || prefs.lang === 'en' ? prefs.lang : 'system'
      setLang(next)
      setLangState(next)
    }
    void readPrefs().then(apply)
    return onPrefsChange(() => void readPrefs().then(apply))
  }, [])
  return lang
}

function ThemeProvider({ children, appearance }: { children: React.ReactNode; appearance?: {theme?: string; accent?: string} }) {
  const dark = useDark()
  const { team } = useTeam()
  const value = useMemo(() => ({ dark, p: palette(dark, appearance?.theme ?? team?.prefs?.theme, appearance?.accent ?? team?.prefs?.accent) }), [dark, appearance?.theme, appearance?.accent, team?.prefs?.theme, team?.prefs?.accent])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// The navigator lives inside the palette provider so its container theme can
// follow the computer's theme instead of flashing the default white.
function ThemedShell({ lang }: { lang?: string }) {
  const dark = useDark()
  // A language change re-mounts the navigator so every screen reads the new
  // strings; the saved navigation state keeps the user where they were.
  const navState = useRef<NavigationState | undefined>(undefined)
  const { team, computer } = useTeam()
  const navigation = useNavigationContainerRef()
  const pendingLink = useRef<ReturnType<typeof parseBoardCommentLink> | ReturnType<typeof parseBoardViewLink>>(null)
  const openComment = useCallback(() => {
    const link = pendingLink.current
    if (!link || !navigation.isReady()) return
    pendingLink.current = null
    if (link.host !== computer?.hostDeviceId) {
      Alert.alert(t('Work board'), t('This link belongs to another paired computer.'))
      return
    }
    navigation.dispatch(StackActions.push('WorkBoard', 'viewId' in link ? { viewId: link.viewId } : { id: link.id, comment: link.comment }))
  }, [computer?.hostDeviceId, navigation])
  useEffect(() => {
    let active = true
    const open = (url?: string | null) => {
      const link = parseBoardCommentLink(url) ?? parseBoardViewLink(url)
      if (active && link) {
        pendingLink.current = link
        openComment()
      }
    }
    void Linking.getInitialURL().then(open)
    const subscription = Linking.addEventListener('url', (event) => open(event.url))
    return () => { active = false; subscription.remove() }
  }, [openComment])
  const value = useMemo(() => ({ dark, p: palette(dark, team?.prefs?.theme, team?.prefs?.accent) }), [dark, team?.prefs?.theme, team?.prefs?.accent])
  const navTheme = useMemo(() => ({
    dark,
    colors: {
      primary: value.p.accent,
      background: value.p.main,
      card: value.p.sidebar,
      text: value.p.ink,
      border: value.p.line,
      notification: value.p.accent,
    },
    fonts: DefaultTheme.fonts,
  }), [dark, value])
  return (
    <ThemeContext.Provider value={value}>
      <NavigationContainer key={lang} ref={navigation} onReady={openComment} theme={navTheme} initialState={navState.current} onStateChange={state => { navState.current = state }}>
        <ErrorBoundary>
          <ShellB />
        </ErrorBoundary>
      </NavigationContainer>
    </ThemeContext.Provider>
  )
}

function Linked({ computer, identity, lang }: { computer: SavedComputer; identity: PhoneIdentity; lang?: string }) {
  // "Keep connected in background" comes back on with the app, and names the computer.
  useEffect(() => { void syncKeepAlive(computer.name).catch(() => {}) }, [computer.name])
  return (
    <TeamProvider computer={computer} identity={identity}>
      <ThemedShell lang={lang} />
    </TeamProvider>
  )
}

function Boot() {
  const { p } = useTheme()
  const [identity, setIdentity] = useState<PhoneIdentity | null>(null)
  const [computer, setComputer] = useState<SavedComputer | null | undefined>(undefined)
  const [bootError, setBootError] = useState<string | null>(null)
  const [appearance, setAppearance] = useState<{theme?:string; accent?:string}>()
  const [machines, setMachines] = useState(false)
  const [initialMachine, setInitialMachine] = useState<SavedMachine | null>(null)
  const [adding, setAdding] = useState(false)
  const [offer, setOffer] = useState<string | null>(null)
  const [seenReady, setSeenReady] = useState(false)
  const lang = useLang()
  const machineBusy = useRef(false)
  const noteSession = useCallback((active: boolean) => { machineBusy.current = active }, [])

  // With no computer left (the last one was forgotten) there is nothing to keep a link to.
  useEffect(() => { if (computer === null) pauseKeepAlive() }, [computer])

  useEffect(() => {
    void loadSeen().finally(() => setSeenReady(true))
    if (DEMO) return
    Promise.all([loadIdentity(), loadComputer(), listMachines()])
      .then(([nextIdentity, saved, known]) => { setIdentity(nextIdentity); setComputer(saved ?? null); if (!saved && known.length) setMachines(true) })
      .catch(failure => setBootError(errorText(failure)))
  }, [])

  // A pairing link opened from the system camera arrives on whatever screen is showing.
  useEffect(() => {
    // Pair.tsx asks the person to confirm the computer before anything is sent.
    const open = (url?: string | null) => {
      if (!isPairingLink(url)) return
      const review = () => { setOffer(url); setAdding(true) }
      if (machineBusy.current) {
        Alert.alert(t('End this session?'), t('Pair another computer'), [
          { text: t('Stay'), style: 'cancel' }, { text: t('End session'), onPress: review },
        ])
      } else review()
    }
    void Linking.getInitialURL().then(open)
    const subscription = Linking.addEventListener('url', event => open(event.url))
    return () => subscription.remove()
  }, [])

  const actions = useMemo<ComputerActions>(() => ({
    add: () => setAdding(true),
    machines: colors => { setAppearance(colors); setInitialMachine(null); setMachines(true) },
    switchTo: id => void setActiveComputer(id).then(loadComputer).then(next => setComputer(next ?? null)),
    reload: () => void loadComputer().then(next => setComputer(next ?? null)),
  }), [])
  const paired = useCallback((next: SavedComputer) => { setAdding(false); setOffer(null); setMachines(false); setComputer(next) }, [])

  if (DEMO && lang !== undefined && seenReady) {
    return <ComputersCtx.Provider value={actions}><DemoProvider><ThemedShell lang={lang} /></DemoProvider></ComputersCtx.Provider>
  }
  if (bootError !== null) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.main }}><Text style={{ color: p.danger }}>{bootError}</Text></View>
  if (identity === null || computer === undefined || lang === undefined || !seenReady) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: p.main }}><ActivityIndicator color={p.accent} /></View>
  const openMachines = () => { setInitialMachine(null); setAdding(false); setOffer(null); setMachines(true) }
  if (machines && !adding) return <ThemeProvider appearance={appearance}><RemoteComputers identity={identity} initial={initialMachine} onSession={noteSession} onPair={() => setAdding(true)} onBack={() => { setInitialMachine(null);setMachines(false) }}/></ThemeProvider>
  if (computer === null || adding) return <ThemeProvider><Pair identity={identity} offer={offer} machineEntry={machines} onPaired={paired} onMachine={value => {setInitialMachine(value);setMachines(true);setAdding(false);setOffer(null)}} onMachines={openMachines} onCancel={computer !== null || machines ? () => { setAdding(false); setOffer(null) } : undefined} /></ThemeProvider>
  return <ComputersCtx.Provider value={actions}><Linked key={computer.hostDeviceId} computer={computer} identity={identity} lang={lang} /></ComputersCtx.Provider>
}

export default function App() {
  const dark = useDark()
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <Boot />
        </ErrorBoundary>
        <StatusBar style={dark ? 'light' : 'dark'} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
