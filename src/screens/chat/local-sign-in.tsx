// Godbot: the sign-in of a Bot's local agent CLI, below its blocked card. The computer
// runs the CLI's own login and the phone follows it: Codex's device code to enter on
// its page, or Claude Code's code page whose code comes back here.
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useTeam } from '../../team/context.tsx'
import { ACTIVE_STATES, PHONE_METHODS, phoneStep, signInFailureText, type LoginView } from '../../team/local-sign-in.ts'
import { t } from '../../ui/i18n.ts'
import type { useTheme } from '../../ui/tokens.ts'

type Palette = ReturnType<typeof useTheme>['p']
const message = (failure: unknown) => (failure as { message?: string })?.message ?? String(failure)

export function LocalSignIn({ botId, botName, route, agent, p }: { botId: string; botName: string; route: string; agent: string; p: Palette }) {
  const { call } = useTeam()
  const [view, setView] = useState<LoginView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pasted, setPasted] = useState('')
  // What the phone last put on the clipboard: the one-time code or the sign-in link.
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const [attempt, setAttempt] = useState(0)
  // The phone stopped following this sign-in (an error it could not get past).
  const [lost, setLost] = useState(false)
  const current = useRef<LoginView | null>(null)
  const resumed = useRef(false)

  useEffect(() => {
    let stopped = false
    let loginId: string | undefined
    setView(null)
    setError(null)
    setLost(false)
    resumed.current = false
    void (async () => {
      try {
        let next = await call('local-agent-login-start', { route, method: PHONE_METHODS[route] }) as LoginView
        loginId = next.loginId
        let failures = 0
        while (!stopped) {
          current.current = next
          setView(next)
          if (!ACTIVE_STATES.has(next.state)) break
          try {
            // Under the link's 30-second request limit.
            next = await call('local-agent-login-wait', { loginId, version: next.version, waitMs: 12_000 }) as LoginView
            failures = 0
          } catch (failure) {
            if (stopped) break
            // The browser sends the app to the background, and the link may drop and
            // come back meanwhile: the sign-in goes on on the computer, so keep asking.
            // A sign-in the computer no longer has is over.
            if (/has ended|已结束/u.test(message(failure)) || ++failures > 60) throw failure
            await new Promise(resolve => setTimeout(resolve, Math.min(1_000 * failures, 5_000)))
          }
        }
      } catch (failure) {
        if (stopped) return
        setLost(true)
        if ((failure as { code?: string })?.code !== 'unlock/canceled') setError(message(failure))
      }
    })()
    return () => {
      stopped = true
      // A sign-in nobody follows any more ends on the computer too.
      if (loginId !== undefined && ACTIVE_STATES.has(current.current?.state ?? '')) void call('local-agent-login-cancel', { loginId }).catch(() => {})
    }
  }, [route, attempt, call])

  // Signed in: the Bot answers the message its failed turn left (the repair card's Retry
  // on the computer). A held greeting the sign-in already sent again is not sent twice.
  useEffect(() => {
    if (view?.state !== 'done' || resumed.current) return
    resumed.current = true
    void call('resume', { botId }).catch(() => {})
  }, [view?.state, botId, call])

  const act = async (endpoint: string, payload: Record<string, unknown> = {}) => {
    if (view === null) return false
    setBusy(true)
    setError(null)
    try {
      const next = await call(endpoint, { loginId: view.loginId, ...payload }) as LoginView | null
      // The answer is the sign-in as it is now: shown at once, without waiting for the poll.
      if (next !== null && typeof next === 'object' && next.loginId === view.loginId) {
        current.current = next
        setView(previous => (previous !== null && previous.version > next.version ? previous : next))
      }
      return true
    } catch (failure) {
      setError(message(failure))
      return false
    } finally { setBusy(false) }
  }

  const step = phoneStep(view)
  const link = step.kind === 'device' || step.kind === 'code' ? step.link : undefined
  const restart = () => setAttempt(n => n + 1)
  const button = (label: string, onPress: () => void, primary = false, disabled = false) => (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={[styles.btn, { backgroundColor: primary ? p.accent : p.hover, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={{ color: primary ? p.accentInk : p.ink, fontWeight: primary ? '600' : '400' }}>{label}</Text>
    </Pressable>
  )

  return (
    <View testID="local-sign-in" style={[styles.panel, { borderColor: p.line }]}>
      <Text style={[styles.title, { color: p.ink }]}>{t('Sign in to {agent}', { agent })}</Text>
      {step.kind === 'starting' && error === null ? (
        <View style={styles.row}><ActivityIndicator color={p.ink3} /><Text style={[styles.small, { color: p.ink2 }]}>{t('Starting the sign-in of {agent}…', { agent })}</Text></View>
      ) : null}
      {step.kind === 'device' ? (
        <>
          <Text style={[styles.small, { color: p.ink2 }]}>{t('Open the page, sign in, and enter this one-time code.')}</Text>
          <View style={styles.row}>
            <Text testID="local-sign-in-code" selectable style={[styles.code, { color: p.ink, backgroundColor: p.hover }]}>{step.code}</Text>
            {button(copied === 'code' ? t('Copied to clipboard') : t('Copy code'), () => void Clipboard.setStringAsync(step.code).then(() => setCopied('code')))}
          </View>
        </>
      ) : null}
      {step.kind === 'code' ? (
        <Text style={[styles.small, { color: p.ink2 }]}>{t('Open the page and sign in, then paste the code it shows here.')}</Text>
      ) : null}
      {link !== undefined ? (
        <View style={styles.row}>
          {button(t('Open the sign-in page'), () => {
            // Codex's page asks for the code: it is on the clipboard when the page opens.
            if (step.kind === 'device') void Clipboard.setStringAsync(step.code).then(() => setCopied('code'))
            void Linking.openURL(link)
          }, true)}
          {/* The page may not open here (no browser, a check this browser cannot pass): the
              link opens on any other device, and the code comes back here. */}
          {button(copied === 'link' ? t('Copied to clipboard') : t('Copy link'), () => void Clipboard.setStringAsync(link).then(() => setCopied('link')))}
        </View>
      ) : null}
      {link !== undefined ? (
        <Text style={[styles.small, { color: p.ink3 }]}>{t('To sign in on another device, copy the link and open it there.')}</Text>
      ) : null}
      {step.kind === 'code' ? (
        <View style={styles.row}>
          <TextInput testID="local-sign-in-paste" value={pasted} onChangeText={setPasted} autoCapitalize="none" autoCorrect={false}
            placeholder={t('Authorization code')} placeholderTextColor={p.ink3}
            style={[styles.field, { color: p.ink, borderColor: p.line }]} />
          {button(t('Submit'), () => void act('local-agent-login-input', { text: pasted.trim() }).then(ok => { if (ok) setPasted('') }), false, busy || pasted.trim() === '')}
        </View>
      ) : null}
      {step.kind === 'device' || step.kind === 'code' ? (
        <Text style={[styles.small, { color: p.ink3 }]}>{step.verifying ? t('Checking the sign-in…') : t('Waiting for you to finish in the browser…')}</Text>
      ) : null}
      {step.kind === 'computer' ? (
        <Text style={[styles.small, { color: p.ink2 }]}>{t('{agent} signs in in a terminal: sign it in from Godbot on the computer.', { agent })}</Text>
      ) : null}
      {step.kind === 'done' ? (
        <Text testID="local-sign-in-done" style={[styles.small, { color: p.ink }]}>{t('{agent} is signed in. {bot} goes on with its answer.', { agent, bot: botName })}</Text>
      ) : null}
      {step.kind === 'failed' ? (
        <View style={{ gap: 2 }}>
          <Text style={[styles.small, { color: p.danger }]}>{signInFailureText(step.reason, agent)}</Text>
          {step.detail ? <Text style={[styles.small, { color: p.ink3, fontFamily: 'monospace' }]}>{step.detail}</Text> : null}
        </View>
      ) : null}
      {step.kind === 'canceled' ? <Text style={[styles.small, { color: p.ink2 }]}>{t('The sign-in was canceled.')}</Text> : null}
      {error !== null ? <Text style={[styles.small, { color: p.danger }]}>{error}</Text> : null}
      <View style={styles.row}>
        {ACTIVE_STATES.has(view?.state ?? '') && step.kind !== 'computer' && !lost ? button(t('Cancel'), () => void act('local-agent-login-cancel'), false, busy) : null}
        {step.kind === 'failed' || step.kind === 'canceled' || lost ? button(t('Try again'), restart) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  small: { fontSize: 13, lineHeight: 18 },
  code: { fontFamily: 'monospace', fontSize: 20, letterSpacing: 1.5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  btn: { minHeight: 36, borderRadius: 18, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  field: { flexGrow: 1, flexBasis: 160, minHeight: 40, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 10, fontFamily: 'monospace', fontSize: 14 },
})
