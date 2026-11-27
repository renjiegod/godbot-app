import { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View, type GestureResponderEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Bot, ModelOption, TeamState } from '../connection.ts'
import { useTeam } from '../team/context.tsx'
import { isLocalModel, modelRoute, modelsForBot } from '../team/bot-details.ts'
import { EFFORT_NAMES, SPEED_NAMES, boltsOf, shownOptions, shownValue, speedOf, type Picks } from '../team/model-options.ts'
import { t } from '../ui/i18n.ts'
import { BoltIcon, CheckIcon, ChevronRightIcon } from '../ui/icons.tsx'
import { radius, type as typeScale, useTheme } from '../ui/tokens.ts'

// The desktop's model menu (ds-bot/src/client/model-menu.js) as a bottom sheet:
// models grouped by provider, the default one marked, and the thinking-level
// slider and other options (speed and the like) of the picked model under them.

type Model = NonNullable<TeamState['models']>[number] & { provider?: string; providerName?: string; reasoning?: Reasoning; options?: ModelOption[] }
interface Reasoning { efforts?: { id: string; name: string }[]; defaultEffort?: string }

export function groupModels(models: Model[]): [string, Model[]][] {
  const groups = new Map<string, Model[]>()
  for (const model of models) {
    const provider = model.provider ?? model.providerName ?? model.ref.split('/')[0]
    if (!groups.has(provider)) groups.set(provider, [])
    groups.get(provider)!.push(model)
  }
  const names = new Map<string, number>()
  for (const list of groups.values()) {
    const name = list[0].providerName ?? list[0].ref.split('/')[0]
    names.set(name, (names.get(name) ?? 0) + 1)
  }
  return [...groups].map(([provider, list]) => {
    const name = list[0].providerName ?? provider
    return [(names.get(name) ?? 0) > 1 ? `${name} (${provider})` : name, list]
  })
}

// What a Bot runs on, for display: the chosen model, else the one it last ran on.
export function modelOf(bot: Bot, models: Model[]): { ref: string; name: string; provider: string; served: boolean } | undefined {
  const ref = bot.model ?? bot.appliedModel
  if (!ref) return undefined
  const served = models.find(model => model.ref === ref)
  const [provider, ...rest] = ref.split('/')
  const name = isLocalModel(ref) && (served?.id ?? rest.join('/')) === 'default' ? t('CLI default') : served?.name ?? (rest.join('/') || ref)
  return { ref, name, provider: served?.providerName ?? provider, served: served !== undefined }
}

// What one model offers besides itself: its thinking levels and its other options
// (speed and the like). The catalog carries the levels for models Bots use and a local
// agent's options; any other ref asks the computer once, in the same answer.
export function useModelTraits(ref: string | undefined, models: Model[]): { reasoning: Reasoning | null | undefined; options: ModelOption[] | undefined } {
  const { call, computer, hello, online } = useTeam()
  const served = models.find(model => model.ref === ref)
  const key = `${computer?.hostDeviceId ?? ''}:${hello?.boot ?? ''}:${ref ?? ''}`
  const [fetched, setFetched] = useState<{ key: string; reasoning: Reasoning | null; options: ModelOption[] | undefined } | null>(null)
  useEffect(() => {
    if (!online || ref === undefined || served?.reasoning !== undefined) return
    let live = true
    call('efforts', { ref }).then(value => {
      const answer = value as (Reasoning & { options?: ModelOption[] }) | undefined
      const reasoning = answer?.efforts ? { efforts: answer.efforts, defaultEffort: answer.defaultEffort } : null
      if (live) setFetched({ key, reasoning, options: Array.isArray(answer?.options) ? answer.options : undefined })
    }).catch(() => {})
    return () => { live = false }
  }, [call, key, online, served?.reasoning !== undefined])
  const own = fetched?.key === key ? fetched : undefined
  return { reasoning: served?.reasoning ?? own?.reasoning, options: served?.options ?? own?.options }
}

// A thinking level or speed by its usual id in the phone's language; any other keeps its CLI's name.
const effortName = (effort: { id: string; name?: string }) => (EFFORT_NAMES[effort.id] ? t(EFFORT_NAMES[effort.id]) : effort.name ?? effort.id)
const speedName = (value: { id: string; name?: string }) => (SPEED_NAMES[value.id] ? t(SPEED_NAMES[value.id]) : value.name ?? value.id)

export function effortLabel(reasoning: Reasoning | null | undefined, effort: string | undefined): string | undefined {
  const efforts = reasoning?.efforts ?? []
  if (efforts.length === 0) return undefined
  const picked = efforts.some(e => e.id === effort) ? effort : undefined
  const current = picked ?? reasoning?.defaultEffort
  if (current === undefined) return t('Default')
  const level = efforts.find(e => e.id === current)
  return level ? effortName(level) : current
}

// When the model names its default level the stops are the levels and a reset
// clears back to Default; otherwise Default sits at the first stop.
function effortStops(reasoning: Reasoning | null | undefined): { effort?: string; label: string }[] {
  const efforts = reasoning?.efforts ?? []
  if (efforts.length === 0) return []
  const hasDefault = efforts.some(effort => effort.id === reasoning?.defaultEffort)
  const levels = efforts.map(effort => ({ effort: effort.id, label: effortName(effort) }))
  return hasDefault ? levels : [{ label: t('Default') }, ...levels]
}

const KNOB = 18
const INSET = 11

export function EffortBar({ reasoning, current, onPick, disabled = false }: {
  reasoning: Reasoning | null | undefined; current?: string; onPick: (effort: string | undefined) => void; disabled?: boolean
}) {
  const { p } = useTheme()
  const stops = effortStops(reasoning)
  const [picked, setPicked] = useState(current)
  const [width, setWidth] = useState(0)
  const dragging = useRef(false)
  useEffect(() => { if (!dragging.current && !disabled) setPicked(current) }, [current, disabled])
  if (stops.length === 0) return null
  const hasDefault = (reasoning?.efforts ?? []).some(effort => effort.id === reasoning?.defaultEffort)
  const activeEffort = picked ?? (hasDefault ? reasoning?.defaultEffort : undefined)
  const activeIndex = Math.max(0, stops.findIndex(stop => (stop.effort ?? null) === (activeEffort ?? null)))
  const ratio = stops.length <= 1 ? 1 : activeIndex / (stops.length - 1)
  const span = Math.max(1, width - INSET * 2)
  const stopAt = (event: GestureResponderEvent) => {
    const r = Math.max(0, Math.min(1, (event.nativeEvent.locationX - INSET) / span))
    return stops[Math.round(r * (stops.length - 1))] ?? stops[0]
  }
  const commit = (effort: string | undefined) => {
    if (disabled) return
    setPicked(effort)
    if ((effort ?? null) !== (current ?? null)) onPick(effort)
  }
  return (
    <View style={{ gap: 6, paddingHorizontal: 16, paddingVertical: 10 }} accessibilityRole="adjustable" accessibilityLabel={t('Thinking level')} accessibilityState={{ disabled }}
      accessibilityValue={{ text: stops[activeIndex].label }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => commit(stops[Math.max(0, Math.min(stops.length - 1, activeIndex + (event.nativeEvent.actionName === 'increment' ? 1 : -1)))].effort)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 28 }}>
        <Text style={[typeScale.caption, { color: p.ink3, fontWeight: '500' }]}>{t('Thinking level')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
          {picked === undefined && hasDefault ? <Text style={[typeScale.caption, { color: p.ink3 }]}>{t('Default')}</Text> : null}
          <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: '600', color: p.accent, flexShrink: 1 }} numberOfLines={1}>{stops[activeIndex].label}</Text>
          {picked !== undefined || !hasDefault ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('Default')} disabled={disabled || picked === undefined} onPress={() => commit(undefined)} hitSlop={10}
              style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: p.hover, opacity: picked === undefined ? 0.35 : 1 }}>
              <Text style={{ color: p.ink2, fontSize: 13 }}>↺</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: 32, justifyContent: 'center' }}
        onStartShouldSetResponder={() => !disabled} onMoveShouldSetResponder={() => !disabled} onResponderTerminationRequest={() => false}
        onResponderGrant={event => { dragging.current = true; setPicked(stopAt(event).effort) }}
        onResponderMove={event => setPicked(stopAt(event).effort)}
        onResponderRelease={event => { dragging.current = false; commit(stopAt(event).effort) }}
        onResponderTerminate={() => { dragging.current = false; setPicked(current) }}>
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 6, bottom: 6, borderRadius: 999, backgroundColor: p.hover, borderWidth: StyleSheet.hairlineWidth, borderColor: p.line }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: INSET * 2 + span * ratio, borderRadius: 999, backgroundColor: p.accent }} />
        {stops.map((stop, index) => {
          const at = stops.length <= 1 ? 1 : index / (stops.length - 1)
          return <View key={stop.effort ?? 'default'} pointerEvents="none" style={{ position: 'absolute', left: INSET + span * at - 2, width: 4, height: 4, borderRadius: 2, backgroundColor: at <= ratio + 0.001 ? 'rgba(255,255,255,0.65)' : p.ink3, opacity: at <= ratio + 0.001 ? 1 : 0.45 }} />
        })}
        <View pointerEvents="none" style={{ position: 'absolute', left: INSET + span * ratio - KNOB / 2, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }} />
      </View>
    </View>
  )
}

// Every model under its provider, the default one marked.
function ModelGroups({ models, current, fallback, onPick }: { models: Model[]; current?: string; fallback?: string | null; onPick: (ref: string) => void }) {
  const { p } = useTheme()
  return (
    <ScrollView style={{ maxHeight: 420 }}>
      {groupModels(models).map(([provider, list]) => (
        <View key={provider}>
          <Text style={[typeScale.caption, { color: p.ink3, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }]}>{provider}</Text>
          {list.map(item => (
            <Pressable key={item.ref} accessibilityRole="radio" accessibilityState={{ checked: item.ref === current }}
              onPress={() => onPick(item.ref)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: p.hover }]}>
              <Text style={[typeScale.settingsRow, { color: p.ink, flex: 1 }]} numberOfLines={1}>
                {isLocalModel(item.ref) && item.ref.endsWith('/default') ? t('CLI default') : item.name}
              </Text>
              {item.needsKey ? <Text style={[typeScale.caption, { color: p.ink3 }]}>{t('Needs an API key')}</Text> : null}
              {item.ref === fallback ? <Text style={[typeScale.caption, { color: p.ink3 }]}>{t('Default')}</Text> : null}
              {item.ref === current ? <CheckIcon color={p.accent} /> : null}
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  )
}

// A model picker for a Bot that does not exist yet (Create new Bot): the same trigger
// and sheet as a Bot's model menu, without the thinking level.
export function ModelPicker({ current, onPick, hostedOnly }: { current?: string; onPick: (ref: string) => void; hostedOnly?: boolean }) {
  const { p } = useTheme()
  const { team } = useTeam()
  const [open, setOpen] = useState(false)
  const insets = useSafeAreaInsets()
  const catalog = (team?.models ?? []) as Model[]
  const models = hostedOnly ? modelsForBot(catalog) : catalog
  const model = models.find(item => item.ref === current)
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Model')} onPress={() => setOpen(true)}
        style={[styles.trigger, { backgroundColor: p.card, borderColor: p.line }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[typeScale.settingsRow, { color: p.ink, fontWeight: '500' }]} numberOfLines={1}>{model?.name ?? t('Choose a model')}</Text>
          {model ? <Text style={[typeScale.caption, { color: p.ink3 }]} numberOfLines={1}>{model.providerName ?? model.ref.split('/')[0]}</Text> : null}
        </View>
        <Text style={{ color: p.ink3, fontSize: 12 }}>⌄</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityLabel={t('Close')} />
        <View style={[styles.sheet, { backgroundColor: p.card, paddingBottom: insets.bottom + 8 }]}>
          <View style={[styles.grab, { backgroundColor: p.line }]} />
          <ModelGroups models={models} current={current} fallback={team?.defaultModel} onPick={ref => { onPick(ref); setOpen(false) }} />
        </View>
      </Modal>
    </>
  )
}

// The model's other options under its thinking level, as on the desktop: Speed (and
// any choice of a few values) as segments, an on/off option as a switch. Each pick
// saves on the Bot at once; Default hands the option back to the agent's own setting.
function ModelOptionsSection({ options, picks, disabled, onPick }: { options: ModelOption[] | undefined; picks: Picks; disabled: boolean; onPick: (id: string, value: string | boolean | null) => void }) {
  const { p } = useTheme()
  const list = shownOptions(options)
  if (list.length === 0) return null
  return (
    <View style={{ gap: 12, paddingHorizontal: 16, paddingVertical: 10 }} pointerEvents={disabled ? 'none' : 'auto'}>
      {list.map(option => {
        const { value, picked } = shownValue(option, picks)
        const label = option.id === 'speed' ? t('Speed') : option.name ?? option.id
        // The same reset as the thinking level's: a pick shows ↺, no pick says Default.
        const reset = picked ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('Default')} hitSlop={10} onPress={() => onPick(option.id, null)}
            style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: p.hover }}>
            <Text style={{ color: p.ink2, fontSize: 13 }}>↺</Text>
          </Pressable>
        ) : <Text style={[typeScale.caption, { color: p.ink3 }]}>{t('Default')}</Text>
        if (option.type === 'toggle') return (
          <View key={option.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[typeScale.caption, { color: p.ink3, fontWeight: '500' }]}>{label}</Text>
              {option.description ? <Text style={[typeScale.small, { color: p.ink3 }]} numberOfLines={2}>{option.description}</Text> : null}
            </View>
            {reset}
            <Switch accessibilityLabel={label} value={value === true} onValueChange={next => onPick(option.id, next)} />
          </View>
        )
        const values = option.values ?? []
        const active = values.find(entry => entry.id === value)
        return (
          <View key={option.id} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 20 }}>
              <Text style={[typeScale.caption, { color: p.ink3, fontWeight: '500' }]}>{label}</Text>
              {reset}
            </View>
            <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segments, { backgroundColor: p.hover, borderColor: p.line }]}>
              {values.map(entry => {
                const checked = entry.id === value
                const bolts = option.id === 'speed' ? boltsOf(option, entry.id) : 0
                return (
                  <Pressable key={entry.id} accessibilityRole="radio" accessibilityState={{ checked }} accessibilityLabel={speedName(entry)}
                    onPress={() => { if (!checked || !picked) onPick(option.id, entry.id) }}
                    style={[styles.segment, checked ? { backgroundColor: p.card, borderColor: p.line } : null]}>
                    {bolts > 0 ? <BoltIcon count={bolts} size={11} color={checked ? '#d97706' : p.ink3} /> : null}
                    <Text style={[typeScale.caption, { color: checked ? p.ink : p.ink2, fontWeight: checked ? '600' : '500' }]} numberOfLines={1}>{speedName(entry)}</Text>
                  </Pressable>
                )
              })}
            </View>
            {active?.description ? <Text style={[typeScale.small, { color: p.ink3 }]}>{t(active.description)}</Text> : null}
          </View>
        )
      })}
    </View>
  )
}

// The trigger shows the model name over its provider and thinking level, as on the desktop.
export function ModelMenu({ bot, onManage, readOnly = false }: { bot: Bot; onManage: () => void; readOnly?: boolean }) {
  const { p } = useTheme()
  const { team, call, refresh } = useTeam()
  const [open, setOpen] = useState(false)
  const [reading, setReading] = useState(false)
  const [writing, setWriting] = useState(false)
  const saving = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const insets = useSafeAreaInsets()
  const catalog = (team?.models ?? []) as Model[]
  const model = modelOf(bot, catalog)
  const models = modelsForBot(catalog, model?.ref)
  const local = isLocalModel(model?.ref)
  const { reasoning, options } = useModelTraits(model?.ref, catalog)
  const level = effortLabel(reasoning, bot.effort)
  // A faster speed shows in the trigger, as a bolt does in the desktop's header.
  const speed = speedOf(options, bot.modelOptions)
  const fastName = speed !== undefined && speed.bolts > 0
    ? speedName({ id: speed.valueId, name: speed.option.values?.find(value => value.id === speed.valueId)?.name })
    : undefined
  const save = async (patch: Record<string, unknown>) => {
    if (readOnly || saving.current) return
    saving.current = true
    setWriting(true)
    try {
      await call('update-bot', { id: bot.id, ...patch })
      setError(null)
    } catch (failure) {
      setError((failure as Error)?.message ?? String(failure))
    } finally {
      setWriting(false)
      saving.current = false
    }
  }
  const show = async () => {
    if (readOnly) return
    setOpen(true)
    setReading(true)
    try {
      await (local ? call('local-agent-models', { route: modelRoute(model?.ref) }) : call('models'))
      refresh?.()
    } catch (failure) {
      setError((failure as Error)?.message ?? String(failure))
    } finally {
      setReading(false)
    }
  }
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Model')} accessibilityState={{ disabled: readOnly, expanded: open }}
        disabled={readOnly} onPress={() => void show()}
        style={[styles.trigger, { backgroundColor: p.card, borderColor: p.line }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={[typeScale.settingsRow, { color: p.ink, fontWeight: '500', flexShrink: 1 }]} numberOfLines={1}>{model?.name ?? t('Choose a model')}</Text>
            {model && speed !== undefined && fastName !== undefined ? <BoltIcon count={speed.bolts} size={11} /> : null}
          </View>
          {model ? <Text style={[typeScale.caption, { color: p.ink3 }]} numberOfLines={1}>{model.served || models.length === 0
            ? [model.provider, level, fastName].filter(Boolean).join(' · ')
            : t('{provider} · not available', { provider: model.provider })}</Text> : null}
        </View>
        {readOnly ? null : <Text style={{ color: p.ink3, fontSize: 12 }}>⌄</Text>}
      </Pressable>
      {model ? null : <Text style={[typeScale.small, { color: p.ink3, marginTop: 6 }]}>{t('Pick a model and {name} can start.', { name: bot.name })}</Text>}
      {error ? <Text style={[typeScale.small, { color: p.danger, marginTop: 6 }]}>{error}</Text> : null}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityLabel={t('Close')} />
        <View style={[styles.sheet, { backgroundColor: p.card, paddingBottom: insets.bottom + 8 }]}>
          <View style={[styles.grab, { backgroundColor: p.line }]} />
          <View pointerEvents={writing || readOnly ? 'none' : 'auto'} accessibilityElementsHidden={readOnly} importantForAccessibility={readOnly ? 'no-hide-descendants' : 'auto'}>
            <ModelGroups models={models} current={model?.ref} fallback={team?.defaultModel} onPick={ref => { if (ref !== bot.model) void save({ model: ref }) }} />
          </View>
          {reading ? <Text style={[typeScale.caption, styles.feedback, { color: p.ink3 }]}>{t('Reading models…')}</Text> : null}
          {!reading && models.length === 0 ? <Text style={[typeScale.caption, styles.feedback, { color: p.ink3 }]}>{t('No models are set up in DeepSeek Harness yet.')}</Text> : null}
          {error ? <Text accessibilityRole="alert" style={[typeScale.caption, styles.feedback, { color: p.danger }]}>{error}</Text> : null}
          {model && (reasoning?.efforts?.length ?? 0) > 0 && !readOnly ? (
            <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line, marginTop: 6 }}>
              <EffortBar key={model.ref} reasoning={reasoning} current={reasoning?.efforts?.some(e => e.id === bot.effort) ? bot.effort : undefined}
                disabled={writing} onPick={effort => void save({ effort: effort ?? null })} />
            </View>
          ) : null}
          {model && shownOptions(options).length > 0 && !readOnly ? (
            <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }}>
              <ModelOptionsSection options={options} picks={bot.modelOptions} disabled={writing} onPick={(id, value) => void save({ modelOptions: { [id]: value } })} />
            </View>
          ) : null}
          {local || readOnly ? null : <Pressable accessibilityRole="button" onPress={() => { setOpen(false); onManage() }}
            style={[styles.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.line }]}>
            <Text style={[typeScale.settingsRow, { color: p.ink, flex: 1 }]}>{t('Models and providers…')}</Text>
            <ChevronRightIcon color={p.ink3} />
          </Pressable>}
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 8 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 8 },
  grab: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 16 },
  feedback: { paddingHorizontal: 16, paddingVertical: 8 },
  segments: { flexDirection: 'row', gap: 2, padding: 2, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  segment: { flex: 1, minWidth: 0, minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent', paddingHorizontal: 6 },
})
