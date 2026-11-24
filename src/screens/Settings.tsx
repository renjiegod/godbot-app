// Modified for Godbot. See NOTICE.
import { Children, Fragment, useCallback, useEffect, useState } from 'react'
import { AppState, Linking, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useTeam } from '../team/context.tsx'
import { GodbotNative } from '../../modules/godbot-native/index.ts'
import { keepAliveSupported, setKeepAlive } from '../team/keepalive.ts'
import { androidNotificationStatus } from '../team/notifications.ts'
import { onPushState, pushState, pushStatusText, setupPushAgain } from '../team/push-link.ts'
import { t, getLang, setLang } from '../ui/i18n.ts'
import { ChevronRightIcon } from '../ui/icons.tsx'
import { readPrefs, writePrefs } from '../store.ts'
import { radius, shadow, type as typeScale, useTheme } from '../ui/tokens.ts'

function Row({ label, hint, value, onPress, end }: { label: string; hint?: string; value?: string; onPress?: () => void; end?: React.ReactNode }) {
  const { p } = useTheme()
  const body = (
    <View style={styles.row}>
      <View style={{ flex: 1, minWidth: 96 }}>
        <Text style={[typeScale.settingsRow, { color: p.ink }]}>{label}</Text>
        {hint ? <Text style={[typeScale.small, { color: p.ink3, marginTop: 2 }]}>{hint}</Text> : null}
      </View>
      {value !== undefined ? <Text style={[typeScale.settingsRow, { color: p.ink2, flexShrink: 1, maxWidth: '52%', textAlign: 'right' }]} numberOfLines={1}>{value}</Text> : null}
      {end}
      {onPress ? <View style={{ flexShrink: 0 }}><ChevronRightIcon size={16} color={p.ink3} /></View> : null}
    </View>
  )
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed ? { backgroundColor: p.hover } : null}>{body}</Pressable> : body
}

// A choice of a few values, all in view: the iOS segmented control's shape.
function Choice<T extends string>({ label, options, value, onPick }: { label: string; options: { id: T; label: string }[]; value: T; onPick: (id: T) => void }) {
  const { p } = useTheme()
  return (
    <View style={styles.choice}>
      <Text style={[typeScale.settingsRow, { color: p.ink }]}>{label}</Text>
      <View style={[styles.segments, { backgroundColor: p.hover }]} accessibilityRole="radiogroup">
        {options.map(option => {
          const on = option.id === value
          return (
            <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onPick(option.id)}
              style={[styles.segment, on && [{ backgroundColor: p.card }, shadow(1)]]}>
              <Text style={[typeScale.small, { color: on ? p.ink : p.ink2, fontWeight: on ? '600' : '400', textAlign: 'center' }]} numberOfLines={1}>{option.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const { p } = useTheme()
  const items = Children.toArray(children).filter(Boolean)
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={[typeScale.caption, { color: p.ink3, paddingHorizontal: 18, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 11 }]}>{label}</Text>
      <View style={[styles.card, { backgroundColor: p.card, borderColor: p.line }]}>
        {items.map((child, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={[styles.divider, { backgroundColor: p.line }]} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
    </View>
  )
}

export function Settings({ navigation }: { navigation?: any }) {
  const { p } = useTheme()
  const { team, computer } = useTeam()
  const [prefs, setPrefs] = useState<Record<string, string>>({})
  const [, bump] = useState(0)
  const androidSdk = Platform.OS === 'android' ? Number(Platform.Version) : 0
  const [notifAllowed, setNotifAllowed] = useState(false)
  const refreshNotif = useCallback(() => {
    if (Platform.OS !== 'android' || androidSdk < 33) return
    void PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).then(setNotifAllowed, () => {})
  }, [androidSdk])
  // Whether Android leaves the keep-alive out of battery optimization; read again on return
  // from the system page.
  const [batteryFree, setBatteryFree] = useState(() => GodbotNative?.isIgnoringBatteryOptimizations() ?? false)
  const refreshBattery = useCallback(() => { setBatteryFree(GodbotNative?.isIgnoringBatteryOptimizations() ?? false) }, [])
  useEffect(() => {
    void readPrefs().then(setPrefs)
    refreshNotif()
    if (Platform.OS !== 'android') return
    const sub = AppState.addEventListener('change', next => { if (next === 'active') { refreshNotif(); refreshBattery() } })
    return () => sub.remove()
  }, [refreshNotif, refreshBattery])
  const set = (key: string, value: string) => { const next = { ...prefs, [key]: value }; setPrefs(next); void writePrefs({ [key]: value }) }
  const openNotifications = () => {
    if (Platform.OS !== 'android') return
    if (notifAllowed || androidSdk < 33) { void Linking.openSettings(); return }
    void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).then(result => {
      if (result === PermissionsAndroid.RESULTS.GRANTED) setNotifAllowed(true)
      else if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) void Linking.openSettings()
    }, () => void Linking.openSettings())
  }
  const [push, setPush] = useState(pushState())
  useEffect(() => onPushState(() => setPush(pushState())), [])
  const toggleKeepAlive = (on: boolean) => {
    set('keepAlive', on ? 'on' : 'off')
    // The ongoing notification needs the permission on Android 13 and later.
    if (on && androidSdk >= 33 && !notifAllowed) {
      void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).then(result => setNotifAllowed(result === PermissionsAndroid.RESULTS.GRANTED), () => {})
    }
    void setKeepAlive(on, computer?.name).catch(() => {})
  }
  const togglePush = (on: boolean) => {
    const value = on ? 'on' : 'off'
    setPrefs(prev => ({ ...prev, push: value }))
    // The setup reads the saved setting, so it runs once the write has landed.
    void writePrefs({ push: value }).then(() => setupPushAgain())
  }
  const theme = prefs.theme ?? 'system'
  const lang = getLang()
  const notifStatus = androidNotificationStatus(androidSdk, notifAllowed)
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      <Section label={t('Phone')}>
        <Row label={t('Computers')} value={computer?.name ?? ''} onPress={() => navigation?.navigate('Computers')} />
        <Choice label={t('Appearance')} value={theme as 'system' | 'light' | 'dark'} onPick={next => set('theme', next)}
          options={[{ id: 'system', label: t('System') }, { id: 'light', label: t('Light') }, { id: 'dark', label: t('Dark') }]} />
        <Choice label={t('Language')} value={lang as 'system' | 'zh' | 'en'} onPick={next => { set('lang', next); setLang(next); bump(v => v + 1) }}
          options={[{ id: 'system', label: t('Follow system') }, { id: 'zh', label: '简体中文' }, { id: 'en', label: 'English' }]} />
        <Row label={t('In-app banners')} end={<Switch value={prefs.banners !== 'off'} onValueChange={on => set('banners', on ? 'on' : 'off')} trackColor={{ false: p.line2, true: p.accent }} thumbColor={p.knob} />} />
        {Platform.OS === 'android' ? <Row label={t('Notifications')} value={notifStatus !== undefined ? t(notifStatus) : undefined} onPress={openNotifications} /> : null}
        {keepAliveSupported() ? <Row label={t('Keep connected in background')} hint={t('Keeps the link open with an ongoing notification. Uses more battery.')}
          end={<Switch accessibilityLabel={t('Keep connected in background')} value={prefs.keepAlive === 'on'} onValueChange={toggleKeepAlive} trackColor={{ false: p.line2, true: p.accent }} thumbColor={p.knob} />} /> : null}
        {/* Phone makers stop background apps their own way: on these two system pages the person lets Godbot keep running. */}
        {keepAliveSupported() && prefs.keepAlive === 'on' ? <Row label={t('Battery optimization')} value={batteryFree ? t('Not restricted') : t('Restricted')}
          hint={batteryFree ? undefined : t('Android may cut the link to save battery. Tap to let Godbot run in the background.')}
          onPress={() => { GodbotNative?.requestIgnoreBatteryOptimizations() }} /> : null}
        {keepAliveSupported() && prefs.keepAlive === 'on' ? <Row label={t('Auto-start and lock')}
          hint={t('Let Godbot start on its own and run in the background without limits, then lock it in Recents. The link then survives a reboot and clearing Recents.')}
          onPress={() => { GodbotNative?.openAutoStartSettings() }} /> : null}
        <Row label={t('Push notifications')} hint={pushStatusText(push, t)}
          end={<Switch accessibilityLabel={t('Push notifications')} value={prefs.push !== 'off'} onValueChange={togglePush} trackColor={{ false: p.line2, true: p.accent }} thumbColor={p.knob} />} />
      </Section>
      {/* The desktop settings pages, in the desktop's order. */}
      <Section label={t('Team')}>
        <Row label={t('Models')} onPress={() => navigation?.navigate('Providers')} />
        <Row label={t('Connectors')} onPress={() => navigation?.navigate('Connectors')} />
        <Row label={t('Capabilities')} onPress={() => navigation?.navigate('Capabilities')} />
        <Row label={t('Usage')} onPress={() => navigation?.navigate('TeamUsage')} />
        <Row label={t('Local agent usage')} onPress={() => navigation?.navigate('LocalAgentUsage')} />
        <Row label={t('Secrets')} onPress={() => navigation?.navigate('Secrets')} />
        <Row label={t('Location')} onPress={() => navigation?.navigate('Location')} />
        <Row label={t('Updates & diagnostics')} onPress={() => navigation?.navigate('Updates')} />
        <Row label={t('About Godbot')} onPress={() => navigation?.navigate('About')} />
      </Section>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 14, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', ...shadow(1) },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, minHeight: 50, gap: 10 },
  choice: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  segments: { flexDirection: 'row', borderRadius: 9, padding: 2 },
  segment: { flex: 1, minHeight: 34, paddingVertical: 5, borderRadius: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
})
