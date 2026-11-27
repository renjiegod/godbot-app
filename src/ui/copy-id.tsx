// A conversation's ID, for troubleshooting: the session ID its history, logs and
// folder on the computer go by, as the desktop shows it (team-ui/copy-id.js). The
// button copies the whole ID and shows a check for a moment.
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { t } from './i18n.ts'
import { CheckIcon, CopyIcon } from './icons.tsx'
import { MONO, type as typeScale, useTheme } from './tokens.ts'

const COPIED_MS = 1600

export function CopyIdButton({ id, testID }: { id: string; testID?: string }) {
  const { p } = useTheme()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (id === '') return null
  const copy = () => {
    void Clipboard.setStringAsync(id).then(() => {
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), COPIED_MS)
    }, () => {})
  }
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={copied ? t('Session ID copied') : t('Copy session ID')}
      accessibilityHint={id} hitSlop={8} onPress={copy}
      style={({ pressed }) => [styles.button, pressed && { backgroundColor: p.active }]}>
      {copied ? <CheckIcon size={16} color={p.green} /> : <CopyIcon size={16} color={p.ink3} />}
    </Pressable>
  )
}

// The ID as text with its copy button, under a conversation's name on its details page.
export function SessionIdLine({ id, testID }: { id: string; testID?: string }) {
  const { p } = useTheme()
  if (id === '') return null
  return (
    <View style={styles.line}>
      <Text style={[typeScale.caption, styles.label, { color: p.ink3 }]}>ID</Text>
      <Text selectable numberOfLines={1} ellipsizeMode="middle" style={[typeScale.caption, styles.value, { color: p.ink2 }]}>{id}</Text>
      <CopyIdButton id={id} testID={testID} />
    </View>
  )
}

const styles = StyleSheet.create({
  button: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'stretch', marginTop: 4 },
  label: { fontWeight: '600' },
  value: { flexShrink: 1, fontFamily: MONO },
})
