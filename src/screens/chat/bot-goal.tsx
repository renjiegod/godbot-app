import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { BotGoal } from '../../connection.ts'
import { t } from '../../ui/i18n.ts'
import { type as textStyle, type Palette } from '../../ui/tokens.ts'

type Draft = Pick<BotGoal, 'objective' | 'acceptance'> & { turns: string; minutes: string; revision: number | null }

function statusOf(goal: BotGoal | undefined) {
  if (goal === undefined) return ''
  switch (goal.status) {
    case 'completed': return t('Completed')
    case 'stopped': return goal.activity ? t('Stopping') : t('Stopped')
    case 'paused': return goal.activity ? t('Pausing') : t('Paused')
    case 'blocked': return t('Needs review')
    default:
      if (goal.activity === 'waiting') return t('Waiting for input')
      return goal.activity === 'running' ? t('Running') : t('Queued')
  }
}

type Props = {
  botId: string; sessionId: string; goal?: BotGoal; canWrite: boolean; open: boolean
  onOpen: () => void; onClose: () => void; refresh: () => void
  call: (endpoint: string, payload?: unknown) => Promise<unknown>; p: Palette
}

export function BotGoalCard({ botId, sessionId, goal, canWrite, open, onOpen, onClose, refresh, call, p }: Props) {
  const insets = useSafeAreaInsets()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canStart = goal === undefined || !goal.activity && ['completed', 'stopped'].includes(goal.status)
  const canEdit = goal !== undefined && !['completed', 'stopped'].includes(goal.status)
  const edit = (fresh: boolean) => setDraft({
    objective: fresh ? '' : goal?.objective ?? '', acceptance: fresh ? '' : goal?.acceptance ?? '',
    turns: String(fresh ? 8 : goal?.maxTurns ?? 8), minutes: String(fresh ? 30 : goal?.maxMinutes ?? 30),
    revision: goal?.revision ?? null,
  })
  function close() {
    setError(null); setDraft(null); onClose()
  }
  async function send(action: string) {
    if (pending || !canWrite) return
    setPending(true)
    setError(null)
    try {
      await call('bot-goal-control', {
        botId, sessionId, action, goalId: goal?.id, revision: goal?.revision ?? null,
        requestId: Date.now() + '-' + Math.random(),
        ...(draft && (action === 'start' || action === 'edit') ? {
          objective: draft.objective, acceptance: draft.acceptance, maxTurns: Number(draft.turns),
          maxMinutes: Number(draft.minutes), revision: draft.revision,
        } : {}),
      })
      refresh()
      if (action === 'start' || action === 'edit') setDraft(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      refresh()
    } finally { setPending(false) }
  }
  const button = (label: string, act: () => void, disabled = false) => (
    <Pressable key={label} accessibilityRole="button" disabled={disabled || pending} onPress={act}
      style={[styles.button, { backgroundColor: p.hover, opacity: disabled || pending ? .5 : 1 }]}>
      <Text style={[textStyle.small, { color: p.ink }]}>{t(label)}</Text>
    </Pressable>
  )
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Goal')} onPress={onOpen}
      style={[styles.card, { backgroundColor: p.card, borderColor: p.line }]}>
      <Text style={[textStyle.small, { color: p.ink }]}>{t('Goal')}</Text>
      {goal ? <Text numberOfLines={1} style={[textStyle.small, { color: p.ink2, flex: 1 }]}>
        {statusOf(goal) + ' · ' + goal.objective}
      </Text> : null}
    </Pressable>
    <Modal visible={open} onRequestClose={close} presentationStyle="pageSheet" animationType="slide">
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: p.main }}
        contentContainerStyle={[styles.sheet, { paddingTop: Math.max(20, insets.top), paddingBottom: Math.max(24, insets.bottom) }]}>
        <View style={styles.row}>
          <Text style={[textStyle.settingsRow, { color: p.ink, flex: 1, fontWeight: '600' }]}>{t('Goal')}</Text>
          {button('Close', close)}
        </View>
        {draft && canWrite ? <>
          <Text style={[textStyle.small, { color: p.ink2 }]}>{t('Objective')}</Text>
          <TextInput accessibilityLabel={t('Objective')} multiline maxLength={4000} value={draft.objective}
            onChangeText={objective => setDraft({ ...draft, objective })} style={[styles.field, { color: p.ink, borderColor: p.line }]} />
          <Text style={[textStyle.small, { color: p.ink2 }]}>{t('Done when')}</Text>
          <TextInput accessibilityLabel={t('Done when')} multiline maxLength={2000} value={draft.acceptance}
            onChangeText={acceptance => setDraft({ ...draft, acceptance })} style={[styles.field, { color: p.ink, borderColor: p.line }]} />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[textStyle.small, { color: p.ink2 }]}>{t('Goal turns')}</Text>
              <TextInput accessibilityLabel={t('Goal turns')} keyboardType="number-pad" maxLength={2} value={draft.turns}
                onChangeText={turns => setDraft({ ...draft, turns })} style={[styles.field, { color: p.ink, borderColor: p.line }]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[textStyle.small, { color: p.ink2 }]}>{t('Active minutes')}</Text>
              <TextInput accessibilityLabel={t('Active minutes')} keyboardType="number-pad" maxLength={3} value={draft.minutes}
                onChangeText={minutes => setDraft({ ...draft, minutes })} style={[styles.field, { color: p.ink, borderColor: p.line }]} />
            </View>
          </View>
          <View style={styles.row}>
            {button(canStart ? 'Start goal' : 'Save', () => void send(canStart ? 'start' : 'edit'), !draft.objective.trim())}
            {button('Cancel', () => setDraft(null))}
          </View>
        </> : <>
          {goal ? <>
            <Text selectable style={[textStyle.settingsRow, { color: p.ink }]}>{goal.objective}</Text>
            {goal.acceptance ? <Text selectable style={{ color: p.ink2 }}>{t('Done when') + ' · ' + goal.acceptance}</Text> : null}
            <Text style={{ color: p.ink2 }}>{statusOf(goal) + ' · ' + t('{used} of {max} turns', { used: goal.turns, max: goal.maxTurns })}</Text>
            {goal.reason ? <Text style={{ color: p.ink2 }}>{goal.reason}</Text> : null}
            {goal.checkpoint ? <Text selectable style={{ color: p.ink }}>{goal.checkpoint.summary}</Text> : null}
            {goal.checkpoint?.evidence ? <Text selectable style={{ color: p.ink }}>{goal.checkpoint.evidence}</Text> : null}
            {goal.checkpoint?.next ? <Text selectable style={{ color: p.ink2 }}>{t('Next step') + ' · ' + goal.checkpoint.next}</Text> : null}
          </> : null}
          {canWrite ? <View style={styles.row}>
            {canStart ? button('Start goal', () => edit(true)) : null}
            {canEdit && goal.status === 'active' ? button('Pause goal', () => void send('pause')) : null}
            {canEdit && goal.status !== 'active' ? button('Resume goal', () => void send('resume'), Boolean(goal.activity)) : null}
            {canEdit ? button('Edit goal', () => edit(false)) : null}
            {canEdit ? button('Stop goal', () => void send('stop')) : null}
          </View> : null}
        </>}
        {error ? <Text accessibilityRole="alert" style={{ color: p.danger }}>{error}</Text> : null}
      </ScrollView>
    </Modal>
  </>
}

const styles = StyleSheet.create({
  card: { alignSelf: 'flex-start', maxWidth: '92%', marginHorizontal: 12, marginVertical: 5, paddingHorizontal: 10, minHeight: 40,
    flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10 },
  sheet: { paddingHorizontal: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  field: { borderWidth: 1, borderRadius: 8, minHeight: 44, paddingVertical: 6, paddingHorizontal: 9 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8 },
})
