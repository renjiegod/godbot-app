import { useRef, useState, type ComponentRef, type Ref } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps } from 'react-native'
import { mentionSpans } from '../../godbot/shared/mentions.js'
import { chooseCommentAddress, commentAddress } from '../../godbot/shared/work-board-discussion-format.js'
import type { Bot } from '../connection.ts'
import { t } from './i18n.ts'
import { BotMark } from './marks.tsx'
import { type as typeScale, useTheme, type Palette } from './tokens.ts'

type MentionBot = Pick<Bot, 'id' | 'name'>
type Selection = { start: number; end: number }
type Input = ComponentRef<typeof TextInput>
const origin = { start: 0, end: 0 }
const empty: MentionBot[] = []

export function useBotMentions(text: string, setText: (value: string) => void, bots: MentionBot[], disabled = false, maxLength = Infinity) {
  const input = useRef<Input>(null)
  const [menu, setMenu] = useState<'typing' | 'button' | null>(null)
  const [selection, setSelection] = useState<Selection>(origin)
  const [placement, setPlacement] = useState<Selection>()
  const address = menu && selection.start === selection.end ? commentAddress(text, selection.start, bots) : null
  const options: MentionBot[] = disabled ? empty : menu === 'button' ? bots : address?.options ?? empty

  function choose(bot: MentionBot) {
    const range = address ?? selection
    const before = text.slice(0, range.start)
    const prefix = !address && /[\p{L}\p{N}_./\\@]$/u.test(before) ? ' ' : ''
    const next = chooseCommentAddress(text, range, bot)
    if (next.body.length + prefix.length > maxLength) return
    setText(before + prefix + next.body.slice(range.start))
    const cursor = next.cursor + prefix.length
    const position = { start: cursor, end: cursor }
    setSelection(position)
    setPlacement(position)
    setMenu(null)
    requestAnimationFrame(() => input.current?.focus())
  }

  return {
    options, choose,
    toggle: () => setMenu(menu === 'button' ? null : 'button'),
    close: () => setMenu(null),
    inputProps: {
      ref: input,
      selection: placement,
      onSelectionChange: (event: Parameters<NonNullable<TextInputProps['onSelectionChange']>>[0]) => {
        const next = event.nativeEvent.selection
        setSelection(next)
        if (next.start === placement?.start && next.end === placement.end) setPlacement(undefined)
      },
      onChangeText: (value: string) => {
        setPlacement(undefined)
        setText(value)
        setMenu('typing')
      },
    },
  }
}

export function HighlightedBotInput({ value, bots, everyone, p, ref, ...inputProps }:
  Omit<TextInputProps, 'value' | 'defaultValue' | 'children'> & {
    value: string; bots: MentionBot[]; everyone: boolean; p: Palette; ref: Ref<Input>
  }) {
  const spans = mentionSpans(value, bots).filter(span => span.bot || everyone)
  let cursor = 0
  const runs = spans.map(span => {
    const before = value.slice(cursor, span.start)
    cursor = span.end
    return <Text key={span.start}>{before}<Text style={{ color: p.accent, backgroundColor: p.conversationUser }}>{value.slice(span.start, span.end)}</Text></Text>
  })
  // The editable native TextInput owns the spans, caret and keyboard composition.
  return <TextInput ref={ref} {...inputProps}><Text>{runs}{value.slice(cursor)}</Text></TextInput>
}

export function BotMentionOptions({ bots, choose, roster }: { bots: MentionBot[]; choose: (bot: MentionBot) => void; roster?: Bot[] }) {
  const { p, dark } = useTheme()
  if (!bots.length) return null
  return (
    <ScrollView accessibilityLabel={t('Mention a Bot')} nestedScrollEnabled keyboardShouldPersistTaps="handled"
      style={[styles.list, { backgroundColor: p.card, borderColor: p.line2 }]} contentContainerStyle={styles.listContent}>
      {bots.map(bot => <Pressable key={bot.id} accessibilityRole="button" accessibilityLabel={'@' + bot.name}
        onPress={() => choose(bot)} style={({ pressed }) => [styles.option, pressed && { backgroundColor: p.conversationUser }]}>
        <BotMark bot={roster?.find(item => item.id === bot.id) ?? bot} dark={dark} size={22} />
        <Text numberOfLines={1} style={[typeScale.settingsRow, styles.name, { color: p.ink }]}>@{bot.name}</Text>
      </Pressable>)}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  list: { flexGrow: 0, maxHeight: 184, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9 },
  listContent: { padding: 3 },
  option: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, borderRadius: 6 },
  name: { flex: 1, minWidth: 0 },
})
