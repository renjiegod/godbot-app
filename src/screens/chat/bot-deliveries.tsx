import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTeam } from '../../team/context.tsx'
import type { DeliveryProgress } from '../../connection.ts'
import { messageClock, t } from '../../ui/i18n.ts'
import { type, useTheme } from '../../ui/tokens.ts'

const labels = {
  queued: 'Queued', accepted: 'Engine accepted', blocked: 'Delivery blocked', replied: 'Replied', stopped: 'Stopped',
} as const

interface Delivery {
  id: string
  from: string
  to: string
  state: keyof typeof labels
  reason?: string
  progress?: DeliveryProgress
  text: string
}

export function BotDeliveries({ botId, sessionId }: { botId: string; sessionId: string }) {
  const [open, setOpen] = useState(false)
  const { p } = useTheme()
  return <>
    <Pressable accessibilityRole="button" testID="bot-deliveries-open" onPress={() => setOpen(true)} style={styles.entry}>
      <Text style={[type.caption, { color: p.accent }]}>{t('Bot message delivery')}</Text>
    </Pressable>
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      {open ? <DeliveryList key={sessionId} botId={botId} sessionId={sessionId} onClose={() => setOpen(false)} /> : null}
    </Modal>
  </>
}

function DeliveryList({ botId, sessionId, onClose }: { botId: string; sessionId: string; onClose: () => void }) {
  const { team, call } = useTeam()
  const { p } = useTheme()
  const insets = useSafeAreaInsets()
  const [rows, setRows] = useState<Delivery[] | null>(null)
  const [failed, setFailed] = useState(false)

  const revision = team?.revision
  useEffect(() => {
    let cancelled = false
    void call('bot-deliveries', { botId, sessionId }).then(recent => {
      if (!cancelled) {
        setRows(recent as Delivery[])
        setFailed(false)
      }
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [botId, sessionId, call, revision])

  const name = (id: string) => team?.bots.find(bot => bot.id === id)?.name ?? id
  return <View style={[styles.sheet, { backgroundColor: p.main, paddingTop: Math.max(insets.top, 12), paddingBottom: insets.bottom }]}>
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[type.settingsRow, { color: p.ink, fontWeight: '600' }]}>{t('Bot message delivery')}</Text>
      <Pressable onPress={onClose} accessibilityRole="button" style={styles.close}>
        <Text style={[type.settingsRow, { color: p.accent }]}>{t('Done')}</Text>
      </Pressable>
    </View>
    {failed ? <Text accessibilityRole="alert" style={[type.caption, styles.message, { color: p.danger }]}>{t('Could not read message delivery')}</Text> : null}
    {rows === null && !failed ? <ActivityIndicator color={p.accent} /> : null}
    {rows?.length === 0 ? <Text style={[type.caption, styles.message, { color: p.ink3 }]}>{t('No messages yet')}</Text> : null}
    <ScrollView contentContainerStyle={styles.list}>
      {rows?.map(row => <View key={row.id} style={[styles.row, { borderColor: p.line }]}>
        <Text style={[type.caption, { color: p.ink2 }]}>{name(row.from)} → {name(row.to)}</Text>
        <Text selectable style={[type.bubble, { color: p.ink }]}>{row.text}</Text>
        <Text testID={'bot-delivery-' + row.state} style={[type.caption, { color: row.state === 'blocked' ? p.danger : p.ink2 }]}>
          {t(labels[row.state])}{row.reason ? ' · ' + row.reason : ''}
        </Text>
        {row.progress ? <Text selectable style={[type.caption, { color: p.ink2 }]}>
          {messageClock(row.progress.at)} · {row.progress.blocked ? t('Blocked · {text}', { text: row.progress.text }) : row.progress.text}
        </Text> : null}
      </View>)}
    </ScrollView>
  </View>
}

const styles = StyleSheet.create({
  entry: { alignSelf: 'flex-end', minHeight: 36, justifyContent: 'center', paddingHorizontal: 16 },
  sheet: { flex: 1 },
  header: { minHeight: 52, paddingLeft: 18, paddingRight: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  close: { padding: 12 },
  message: { paddingHorizontal: 18, paddingVertical: 8 },
  list: { paddingHorizontal: 18 },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12, gap: 5 },
})
