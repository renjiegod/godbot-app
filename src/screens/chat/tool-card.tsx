import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTeam } from '../../team/context.tsx'
import { ChevronRightIcon } from '../../ui/icons.tsx'
import { t } from '../../ui/i18n.ts'
import { type Palette, type as typeScale } from '../../ui/tokens.ts'
import type { ChatItem } from './items.tsx'
import type { ItemRow } from './tool-groups.ts'

const statusLabels: Record<string, string> = { running: 'Running', completed: 'Done', failed: 'Failed',
  pending: 'Pending', interrupted: 'Interrupted', declined: 'Declined' }
const fields = { cwd: 'Working folder', input: 'Input', output: 'Output', error: 'Error', changes: 'Changes' }
type Details = Partial<Record<keyof typeof fields, string>>

export function ToolGroupCard({ tools, p, conversation, open, onToggle }: { tools: ItemRow[]; p: Palette; conversation: boolean; open: boolean; onToggle: () => void }) {
  const name = t('{count} tool calls', { count: tools.length })
  const running = tools.filter(({ item }) => item.status === 'running' || item.status === 'pending').length
  const runningLabel = running ? t('{count} running', { count: running }) : ''
  return <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
    accessibilityLabel={runningLabel ? `${name}, ${runningLabel}` : name} onPress={onToggle}
    style={({ pressed }) => [styles.heading, conversation && styles.inlineHeading, { backgroundColor: pressed ? p.hover : undefined }]}>
    <View style={open ? styles.chevronOpen : undefined}>
      <ChevronRightIcon size={15} color={p.ink2} />
    </View>
    <Text style={[typeScale.small, { color: p.ink2 }]}>{name}</Text>
    {runningLabel ? <Text style={[typeScale.caption, { color: p.ink2 }]}>{runningLabel}</Text> : null}
  </Pressable>
}

export function ToolCard({ item, p, conversation, open, onToggle }: { item: ChatItem; p: Palette; conversation: boolean; open: boolean; onToggle?: () => void }) {
  const { call } = useTeam()
  const { botId, sessionId, turn, toolId, status, name, text } = item
  const [detail, setDetail] = useState<Details | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const canOpen = !!toolId && !!botId && !!sessionId && turn !== undefined
  useEffect(() => {
    if (!open || !canOpen) return
    let current = true
    setDetail(null)
    setFailed(false)
    void call('chat-tool', { botId, sessionId, turn, toolId }).then(data => {
      if (current) setDetail(data as Details)
    }, () => { if (current) setFailed(true) })
    return () => { current = false }
  }, [open, canOpen, botId, sessionId, turn, toolId, status, call, retry])
  const label = t(statusLabels[status ?? ''] ?? 'Unknown')
  const heading = <>
    <Text numberOfLines={conversation && !open ? 1 : undefined}
      style={[typeScale.small, styles.target, { color: conversation ? p.ink2 : p.ink, fontWeight: conversation ? '500' : '600' }]}>{name}</Text>
    {text ? <Text numberOfLines={open ? undefined : conversation ? 1 : 2} style={[typeScale.caption, styles.target, { color: p.ink2 }]}>{text}</Text> : null}
    {conversation && !open && status === 'completed' ? null
      : <Text style={[typeScale.caption, !conversation && styles.status, { color: status === 'failed' ? p.danger : status === 'running' ? p.accent : p.ink2 }]}>{label}</Text>}
    {conversation && canOpen ? <View style={open ? styles.chevronOpen : undefined}><ChevronRightIcon size={14} color={p.ink2} /></View> : null}
  </>
  return <View style={conversation ? undefined : [styles.card, { borderColor: p.line2 }]}>
    {canOpen
      ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }}
          accessibilityLabel={[name, text, label].filter(Boolean).join(', ')}
          style={({ pressed }) => [styles.heading, conversation && styles.inlineHeading, pressed && { backgroundColor: p.hover }]}
          onPress={onToggle}>{heading}</Pressable>
      : <View style={[styles.heading, conversation && styles.inlineHeading]}>{heading}</View>}
    {open && canOpen ? <View style={[styles.body, { borderColor: p.line }, conversation && [styles.inlineBody, { backgroundColor: p.card }]]}>
      {failed ? <Text accessibilityRole="button" onPress={() => setRetry(n => n + 1)} style={{ color: p.accent }}>{t('Retry')}</Text>
        : detail === null ? <Text style={{ color: p.ink2 }}>{t('Loading…')}</Text>
        : !Object.values(detail).some(Boolean) ? <Text style={{ color: p.ink2 }}>{t('No tool details recorded')}</Text>
        : Object.entries(fields).map(([key, title]) => {
          const value = detail[key as keyof Details]
          return value ? <View key={key}>
            <Text style={[typeScale.caption, { color: p.ink2 }]}>{t(title)}</Text>
            <Text selectable style={[typeScale.small, { color: p.ink }]}>{value}</Text>
          </View> : null
        })}
    </View> : null}
  </View>
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, marginVertical: 3 },
  heading: { minHeight: 44, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingHorizontal: 10, paddingVertical: 7, gap: 7 },
  inlineHeading: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, gap: 6 },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  target: { flexShrink: 1 },
  status: { marginLeft: 'auto' },
  body: { borderTopWidth: StyleSheet.hairlineWidth, padding: 10, gap: 8 },
  inlineBody: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, marginBottom: 8 },
})
