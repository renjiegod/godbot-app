import { useState } from 'react'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTeam } from '../team/context.tsx'
import { hostText, t } from '../ui/i18n.ts'
import { CheckIcon } from '../ui/icons.tsx'
import { shadow, type as typeScale, useTheme } from '../ui/tokens.ts'
import { primaryBot, type RosterEntry, type RosterSection } from './sidebar-roster.ts'

export type SidebarMenuView =
  | { kind: 'new' }
  | { kind: 'entry'; entry: RosterEntry }
  | { kind: 'section'; section: RosterSection }
  | { kind: 'name'; section?: RosterSection; entryId?: string }

export function SidebarMenu({ menu, onChange, onCreate, onSettings, onSectionContext }: {
  menu: SidebarMenuView
  onChange: (menu: SidebarMenuView | null) => void
  onCreate: (target: 'NewBot' | 'NewGroup') => void
  onSettings: (entry: RosterEntry) => void
  onSectionContext: (section: RosterSection) => void
}) {
  const { p } = useTheme()
  const insets = useSafeAreaInsets()
  const { team, call, online, hello } = useTeam()
  const [name, setName] = useState(menu.kind === 'name' ? menu.section?.name ?? '' : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canWrite = online && team !== null && !team.readOnly
  const close = () => { if (!busy) onChange(null) }
  async function write(endpoint: string, payload: object) {
    if (!canWrite || busy) return
    setError('')
    setBusy(true)
    try {
      await call(endpoint, payload)
      onChange(null)
    } catch (cause) {
      setError(hostText(cause instanceof Error ? cause.message : String(cause)))
    } finally {
      setBusy(false)
    }
  }

  const action = (label: string, onPress: () => void, options: { disabled?: boolean; danger?: boolean; checked?: boolean; key?: string } = {}) => (
    <Pressable key={options.key ?? label} accessibilityRole="button" onPress={onPress} disabled={busy || options.disabled}
      accessibilityState={{ disabled: busy || options.disabled, selected: options.checked }}
      style={({ pressed }) => [styles.action, pressed && { backgroundColor: p.hover }]}>
      <Text style={[typeScale.settingsRow, { flex: 1, color: busy || options.disabled ? p.ink3 : options.danger ? p.danger : p.ink }]}>{label}</Text>
      {options.checked ? <CheckIcon /> : null}
    </Pressable>
  )

  const allowed = { disabled: !canWrite }
  let title: string
  let body: React.ReactNode
  if (menu.kind === 'new') {
    title = t('New…')
    body = <>
      {action(t('Create new Bot'), () => onCreate('NewBot'), allowed)}
      {action(t('Create group chat'), () => onCreate('NewGroup'), allowed)}
      {action(t('New section'), () => onChange({ kind: 'name' }), allowed)}
    </>
  } else if (menu.kind === 'section') {
    const { section } = menu
    title = section.name
    body = <>
      {action(t('Rename section'), () => onChange({ kind: 'name', section }), allowed)}
      {hello?.capabilities.includes('section-context') && action(t('Section description and memory'), () => onSectionContext(section))}
      {action(t('Delete section'), () => Alert.alert(t('Delete section'), section.name, [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('Delete'), style: 'destructive', onPress: () => void write('section-delete', { id: section.id }) },
      ]), { ...allowed, danger: true })}
    </>
  } else if (menu.kind === 'name') {
    title = t(menu.section ? 'Rename section' : 'New section')
    const save = () => {
      if (!name.trim()) return
      void write('section-save', { id: menu.section?.id, name: name.trim(), ...(menu.entryId ? { add: [menu.entryId] } : {}) })
    }
    body = <>
      <TextInput accessibilityLabel={t('Section name')} placeholder={t('Section name')} placeholderTextColor={p.ink3}
        autoFocus value={name} onChangeText={setName} returnKeyType="done" onSubmitEditing={save} editable={!busy}
        style={[styles.input, typeScale.settingsRow, { color: p.ink, backgroundColor: p.hover }]} />
      {action(t('Save'), save, { disabled: !canWrite || !name.trim() })}
    </>
  } else {
    const { entry } = menu
    const item = entry.item
    const lead = entry.kind === 'bot' && primaryBot(team)?.id === item.id
    const main = entry.kind === 'bot' && (lead || team?.mainBotIds?.includes(item.id))
    const setFlags = (flags: object) => void write('set-flags', { id: item.id, ...flags })
    title = item.name
    body = <>
      {action(t(entry.kind === 'bot' ? 'Edit Bot' : 'Group settings'), () => onSettings(entry))}
      {!lead && action(t(item.pinned ? 'Unpin' : 'Pin'), () => setFlags({ pinned: !item.pinned }), allowed)}
      {!main && action(t(item.hidden ? 'Show in sidebar' : 'Hide from sidebar'), () => setFlags({ hidden: !item.hidden }), allowed)}
      {!lead && <>
        <Text style={[styles.label, typeScale.caption, { color: p.ink3 }]}>{t('Move to section')}</Text>
        {(team?.sections ?? []).map(section => action(section.name, () => setFlags({ sectionId: section.id }), {
          disabled: !canWrite || item.sectionId === section.id, checked: item.sectionId === section.id, key: section.id,
        }))}
        {item.sectionId && action(t('Remove from section'), () => setFlags({ sectionId: null }), allowed)}
        {action(t('Move to new section…'), () => onChange({ kind: 'name', entryId: item.id }), allowed)}
      </>}
    </>
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <View style={styles.modal}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('Close')} onPress={close} />
        <View accessibilityViewIsModal style={[styles.panel, { backgroundColor: p.card, borderColor: p.line, marginBottom: insets.bottom + 12 }, shadow(3)]}>
          <Text accessibilityRole="header" numberOfLines={1} style={[typeScale.headerTitle, styles.title, { color: p.ink }]}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
            {body}
            {error !== '' && <Text accessibilityRole="alert" style={[styles.label, typeScale.small, { color: p.danger }]}>{error}</Text>}
          </ScrollView>
          {action(t('Cancel'), close)}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'flex-end' },
  panel: { marginHorizontal: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, maxHeight: '78%', overflow: 'hidden' },
  title: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  label: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  action: { minHeight: 46, paddingHorizontal: 16, gap: 8, flexDirection: 'row', alignItems: 'center' },
  input: { minHeight: 46, marginHorizontal: 16, marginTop: 8, paddingHorizontal: 10, borderRadius: 8 },
})
