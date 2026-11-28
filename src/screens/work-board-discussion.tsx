import { memo, useEffect, useMemo, useRef, useState, type ElementRef } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as Crypto from 'expo-crypto'
import { Directory, EncodingType, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useTeam } from '../team/context.tsx'
import { makeBoardCommentLink } from '../team/work-board-link.ts'
import { t } from '../ui/i18n.ts'
import { BotMark } from '../ui/marks.tsx'
import { radius, shadow, useTheme, type as typeScale } from '../ui/tokens.ts'
import { BoardField } from './work-board-management.tsx'
import { Markdown } from './chat/markdown.tsx'
import { useWorkBoardDiscussion } from '../../godbot/shared/work-board-discussion.js'
import {
  chooseCommentAddress, commentAddress, commentFileCount, commentFileLimit, commentLength,
  commentPlan, commentReactions, commentRunLabels, commentModes, quoteRanges,
} from '../../godbot/shared/work-board-discussion-format.js'

type Bot = { id: string; name: string }
type FileRef = { id: string; name: string; mime: string; size: number }
type Upload = Omit<FileRef, 'id'> & { data: string }
type Run = { id: string; botId?: string; name?: string; state: string; sessionId?: string; turnId?: number; reason?: string }
type Binding = { runId: string; turnId?: number; steer: boolean }
type Annotation = { start: number; end: number; quote: string; note: string; commentId?: string }
type Comment = {
  id: string
  parentId: string | null
  rootId: string
  authorType: 'bot' | 'person'
  author: string | null
  botId: string | null
  body: string
  createdAt: number
  editedAt: number | null
  deleted: boolean
  resolvedAt: number | null
  revision: number
  replyCount?: number
  parent: { author: string | null; excerpt: string; deleted: boolean } | null
  attachments: FileRef[]
  reactions: string[]
  runs: Run[]
  unmatched: boolean
  quiet: boolean
  continuation: string | null
  conclusion?: { id: string; excerpt: string }
  annotations?: Annotation[]
}
type Draft = {
  body: string; parent: Comment | null; edit: Comment | null; keep: FileRef[]; files: Upload[]; quiet: boolean
}
type Page = { entries: Comment[]; root: Comment | null; next: number | null; focusFound: boolean; bots: Bot[]; assignee: string | null; readOnly: boolean; activeRuns?: Record<string, Binding> }
const fresh = (): Draft => ({ body: '', parent: null, edit: null, keep: [], files: [], quiet: false })
const noBots: Bot[] = []
const name = (entry: Comment) => entry.author ?? t('You')
const issue = (error: unknown) => error instanceof Error ? error.message : String(error)

const CommentBody = memo(function CommentBody({ body }: { body: string }) {
  const { p } = useTheme()
  return <Markdown text={body} p={p} textColor={p.ink} fontSize={14} lineHeight={21} />
})

export function WorkBoardDiscussion({ id, active, disabled: offline, focus, openExecution, onScroll, onCompose, openRun, openComment, createSubtask, quote }: {
  id: string; active: boolean; disabled: boolean; focus?: string
  openExecution: (run: Run) => void; onScroll: (offset: number) => void; onCompose: () => void
  openRun?: (runId: string) => void; openComment: (commentId: string) => void
  createSubtask?: (entry: Comment) => void; quote?: string
}) {
  const { p, dark } = useTheme()
  const { call, onFeed, online, computer, team } = useTeam()
  const state = useWorkBoardDiscussion({
    call, subscribe: onFeed, id, active, online, focus, requestId: Crypto.randomUUID,
  })
  const roots = state.roots as Page | null
  const replies = state.replies as Page | null
  const [draft, setDraft] = useState(fresh)
  const [annotation, setAnnotation] = useState<{ source: string; quote: string; note: string; commentId?: string } | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [modes, setModes] = useState<Record<string, { mode: string; runId: string; turnId?: number }>>({})
  const consumedQuote = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!quote) consumedQuote.current = undefined
    else if (active && quote !== consumedQuote.current) {
      consumedQuote.current = quote
      setAnnotation({ source: quote, quote: '', note: '' })
      onCompose()
    }
  }, [quote, active])
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [action, setAction] = useState<{ id: string; type: 'react' | 'menu' | 'delete' } | null>(null)
  const [cursor, setCursor] = useState(0)
  const [address, setAddress] = useState(false)
  const [placement, setPlacement] = useState<{ start: number; end: number } | undefined>(undefined)
  const selection = useRef({ start: 0, end: 0 })
  const input = useRef<ElementRef<typeof TextInput>>(null)
  const focusSeen = useRef<string | undefined>(undefined)
  const [threadOffsets, setThreadOffsets] = useState<Record<string, number>>({})
  const [replyY, setReplyY] = useState<number | null>(null)
  const bots = roots?.bots ?? noBots
  const root = replies?.root ?? roots?.entries.find(entry => entry.id === draft.parent?.rootId)
  const plan = useMemo(() => commentPlan(draft.body, bots, {
    parent: draft.parent, root, assignee: roots?.assignee, quiet: draft.quiet, editing: !!draft.edit,
  }), [draft.body, draft.parent, root, roots?.assignee, draft.quiet, draft.edit, bots])
  const notified = (plan.ids as string[]).filter(botId => !draft.edit?.runs.some(run => run.botId === botId))
  const disabled = offline || !online || !roots || roots.readOnly || !state.reachable || state.busy || picking
  const suggested = address && !disabled ? commentAddress(draft.body, cursor, bots) : null
  const ready = draft.body.trim() || draft.files.length || draft.keep.length || annotations.length

  useEffect(() => {
    if (!active) setAction(null)
  }, [active])

  function typeAt(body: string, next: number) {
    setDraft(prior => ({ ...prior, body }))
    setCursor(next)
    setAddress(false)
    selection.current = { start: next, end: next }
    setPlacement(selection.current)
    requestAnimationFrame(() => input.current?.focus())
  }

  function target(entry: Comment, edit = false) {
    if (edit) setDraft({ ...fresh(), body: entry.body, edit: entry, keep: entry.attachments, quiet: entry.quiet })
    else {
      setDraft(prior => ({ ...(prior.edit ? fresh() : prior), parent: entry }))
      state.openThread(entry.rootId)
    }
    setAddress(false)
    setAction(null)
    requestAnimationFrame(() => input.current?.focus())
  }

  async function attach() {
    setError(null)
    setPicking(true)
    try {
      const result = await File.pickFileAsync({ multipleFiles: true })
      if (result.canceled) return
      const combined = [...draft.keep, ...draft.files, ...result.result]
      if (combined.length > commentFileCount || combined.reduce((sum, file) => sum + file.size, 0) > commentFileLimit)
        throw new Error(t('Attach up to five files totaling 2 MB.'))
      const files = await Promise.all(result.result.map(async file => ({
        name: file.name, mime: file.type, size: file.size, data: await file.base64(),
      })))
      setDraft(prior => ({ ...prior, files: [...prior.files, ...files] }))
    } catch (cause) {
      setError(issue(cause))
    } finally {
      setPicking(false)
    }
  }

  async function download(entry: Comment, file: FileRef) {
    setError(null)
    try {
      const data = await call('board-comment-file', { id, commentId: entry.id, fileId: file.id }) as {
        name: string; mime: string; bytes: string
      }
      const dir = new Directory(Paths.cache, 'work-comments', Crypto.randomUUID())
      dir.create({ intermediates: true })
      const path = new File(dir, data.name)
      await path.write(data.bytes, { encoding: EncodingType.Base64 })
      await Sharing.shareAsync(path.uri, { mimeType: data.mime, dialogTitle: data.name })
    } catch (cause) {
      setError(issue(cause))
    }
  }

  async function submit() {
    if (disabled || !ready) return
    setError(null)
    const result = await state.write({
      op: draft.edit ? 'edit' : 'post',
      commentId: draft.edit?.id,
      expectedRevision: draft.edit?.revision,
      parentId: draft.parent?.id,
      body: draft.body,
      files: draft.files,
      keepFiles: draft.keep.map(file => file.id),
      quiet: draft.quiet,
      targets: notified,
      ...(annotations.length ? { annotations } : {}),
      ...(Object.keys(modes).length ? { modes } : {}),
    }, draft.parent?.rootId ?? (draft.edit?.parentId ? draft.edit.rootId : null))
    if (result) {
      setDraft(fresh())
      setAnnotations([])
      setAnnotation(null)
      setModes({})
      setAddress(false)
    }
  }

  function control(label: string, press: () => void, off = false, selected = false, key = label, primary = false) {
    return (
      <Pressable key={key} accessibilityRole="button" accessibilityLabel={label}
        accessibilityState={{ disabled: off, selected }} disabled={off} onPress={press}
        style={[styles.control, { backgroundColor: primary ? p.accent : p.hover, opacity: off ? 0.55 : 1 }]}>
        <Text style={[typeScale.small, { color: primary ? p.accentInk : selected ? p.accent : p.ink }]}>{label}</Text>
      </Pressable>
    )
  }
  const muted = (text: string) => <Text style={[typeScale.small, { color: p.ink2 }]}>{text}</Text>
  const copy = async (entry: Comment) => {
    if (!computer) return
    try {
      await Clipboard.setStringAsync(makeBoardCommentLink(id, entry.id, computer.hostDeviceId))
      setCopied(entry.id)
    } catch (cause) { setError(issue(cause)) }
  }
  const toggle = (entry: Comment, type: 'react' | 'menu' | 'delete') =>
    setAction(prior => prior?.id === entry.id && prior.type === type ? null : { id: entry.id, type })
  const focusAt = (entry: Comment, y: number) => {
    if (!active || focus !== entry.id || focusSeen.current === focus) return
    focusSeen.current = focus
    onScroll(y)
  }

  useEffect(() => {
    const rootId = replies?.root?.id
    const replyHasFocus = replies?.entries.some(entry => entry.id === focus)
    if (!active || !rootId || !replyHasFocus || replyY === null || !focus || focusSeen.current === focus) return
    const rootY = threadOffsets[rootId], containerY = threadOffsets[rootId + '-replies']
    if (rootY === undefined || containerY === undefined) return
    focusSeen.current = focus
    onScroll(rootY + containerY + replyY)
  }, [active, focus, onScroll, replies, replyY, threadOffsets])

  function comment(entry: Comment) {
    const current = action?.id === entry.id ? action.type : null
    const bot = entry.botId ? team?.bots?.find(b => b.id === entry.botId) : undefined
    return (
      <View key={entry.id} style={[styles.comment, shadow(1), {
        borderColor: focus === entry.id ? p.accent : p.line, backgroundColor: p.card,
      }]} onLayout={(event) => {
        if (entry.parentId && entry.id === focus) setReplyY(event.nativeEvent.layout.y)
      }}>
        <View style={styles.row}>
          {bot ? <BotMark bot={bot} dark={dark} size={24} /> : (
            <Text style={[styles.avatar, { backgroundColor: p.bubble, color: entry.botId ? p.accent : p.ink }]}>
              {entry.deleted ? '–' : Array.from(name(entry))[0]}
            </Text>
          )}
          <Text style={[typeScale.settingsRow, { color: p.ink, fontWeight: '600' }]}>
            {entry.deleted ? t('Deleted comment') : name(entry)}
          </Text>
          {muted(new Date(entry.createdAt).toLocaleString())}
          {entry.editedAt ? muted(t('Edited')) : null}
          {entry.resolvedAt ? muted(t('Resolved')) : null}
        </View>
        {entry.parent && entry.parentId !== entry.rootId ? muted(entry.parent.deleted
          ? t('Deleted comment')
          : (entry.parent.author ?? t('You')) + ' · ' + entry.parent.excerpt) : null}
        {entry.body ? <CommentBody body={entry.body} /> : null}
        {entry.annotations?.map((note, index) => <View key={index}
          style={{ borderLeftWidth: 2, borderLeftColor: p.accent, paddingLeft: 8 }}>
          {muted(note.quote)}<CommentBody body={note.note} />
        </View>)}
        {entry.conclusion ? control(t('Conclusion') + ' · ' + entry.conclusion.excerpt, () => openComment(entry.conclusion!.id)) : null}
        {entry.attachments.length ? <View style={styles.row}>{entry.attachments.map(file =>
          control(file.name, () => void download(entry, file), !online, false, file.id))}</View> : null}
        {entry.runs.map(run => (
          <View key={run.id} style={styles.row}>
            {muted((run.name ?? t('Bot')) + ' · ' + t((commentRunLabels as Record<string, string>)[run.state] ?? 'Unknown'))}
            {run.reason ? muted(run.reason) : null}
            {openRun ? control(t('View run'), () => openRun(run.id))
              : run.sessionId ? control(t('Open execution conversation'), () => openExecution(run)) : null}
          </View>
        ))}
        {entry.unmatched ? muted(t('An @mention did not match an available Bot.')) : null}
        <View style={styles.row}>
          {entry.reactions.map(emoji => control(emoji + ' 1', () => void state.write({
            op: 'react', commentId: entry.id, emoji, active: false,
          }, null), disabled, true, emoji))}
          {!entry.deleted ? control(t('Reply'), () => target(entry), disabled) : null}
          {!entry.deleted ? control(t('React'), () => toggle(entry, 'react'), disabled, current === 'react') : null}
          {entry.replyCount ? control(t('Replies ({count})', { count: entry.replyCount }),
            () => state.openThread(state.threadId === entry.id ? null : entry.id), false, state.threadId === entry.id) : null}
          {!entry.deleted
            ? control(t('Comment actions'), () => toggle(entry, 'menu'), disabled, current === 'menu') : null}
        </View>
        {current === 'react' ? <View style={styles.row}>{commentReactions.map(emoji => control(emoji, async () => {
          if (await state.write({ op: 'react', commentId: entry.id, emoji, active: !entry.reactions.includes(emoji) }, null))
            setAction(null)
        }, disabled, entry.reactions.includes(emoji)))}</View> : null}
        {current === 'menu' ? <View style={styles.row}>
          {entry.authorType === 'person' ? control(t('Edit comment'), () => target(entry, true), disabled) : null}
          {entry.authorType === 'person' ? control(t('Delete comment'), () => toggle(entry, 'delete'), disabled) : null}
          {openRun && entry.body ? control(t('Annotate text'), () => {
            target(entry)
            setAnnotation({ source: entry.body, quote: '', note: '', commentId: entry.id })
            onCompose()
          }, disabled) : null}
          {createSubtask ? control(t('Create subtask from comment'), () => createSubtask(entry), disabled) : null}
          {openRun && entry.parentId ? control(t('Mark as conclusion'), async () => {
            if (await state.write({ op: 'resolve', commentId: entry.rootId, resolved: true, conclusionId: entry.id }, entry.rootId))
              setAction(null)
          }, disabled) : null}
          {!entry.parentId ? control(t(entry.resolvedAt ? 'Reopen thread' : 'Resolve thread'), async () => {
            if (await state.write({ op: 'resolve', commentId: entry.id, resolved: !entry.resolvedAt }, null)) setAction(null)
          }, disabled) : null}
          {control(copied === entry.id ? t('Copied') : t('Copy comment link'), () => void copy(entry), !computer)}
        </View> : null}
        {current === 'delete' ? <View style={styles.row}>
          {muted(t('Delete this comment?'))}
          {control(t('Delete'), async () => {
            if (await state.write({ op: 'delete', commentId: entry.id, expectedRevision: entry.revision }, null)) {
              if (draft.edit?.id === entry.id || draft.parent?.id === entry.id) setDraft(fresh())
              setAction(null)
            }
          }, disabled)}
          {control(t('Cancel'), () => setAction(null))}
        </View> : null}
      </View>
    )
  }
  return (
    <View style={[styles.discussion, !active && { display: 'none' }]}>
      {state.readError || state.writeError || error ? <View accessibilityRole="alert" style={styles.row}>
        <Text style={[typeScale.small, { color: p.danger }]}>{error || state.writeError || state.readError}</Text>
        {control(t('Refresh'), () => { setError(null); void state.load() }, !online)}
      </View> : null}
      {focus && roots && !roots.focusFound ? muted(t('The linked comment is unavailable.')) : null}
      {!roots ? muted(t('Loading…')) : roots.entries.length === 0 ? muted(t('No comments yet.')) : null}
      <View style={styles.row}>
        {state.rootBefore ? control(t('Latest comments'), () => state.setRootBefore(null)) : null}
        {roots?.next ? control(t('Earlier comments'), () => state.setRootBefore(roots.next)) : null}
      </View>
      {roots?.entries.map(entry => (
        <View key={entry.id} style={styles.thread} onLayout={event => {
          const y = event.nativeEvent.layout.y
          focusAt(entry, y)
          if (focus && threadOffsets[entry.id] !== y)
            setThreadOffsets(prior => ({ ...prior, [entry.id]: y }))
        }}>
          {comment(entry)}
          {state.threadId === entry.id ? <View style={[styles.replies, { borderColor: p.line }]}
            onLayout={event => {
              const y = event.nativeEvent.layout.y
              if (focus && threadOffsets[entry.id + '-replies'] !== y)
                setThreadOffsets(prior => ({ ...prior, [entry.id + '-replies']: y }))
            }}>
            <View style={styles.row}>
              {state.replyBefore ? control(t('Latest replies'), () => state.setReplyBefore(null)) : null}
              {replies?.next ? control(t('Earlier replies'), () => state.setReplyBefore(replies.next)) : null}
            </View>
            {replies?.entries.map(comment)}
          </View> : null}
        </View>
      ))}
      <View style={[styles.composer, { borderColor: p.line2, backgroundColor: p.card }]}>
        {annotation ? <View style={{ gap: 7 }}>
          {muted(t('Source text'))}
          <Text selectable style={[typeScale.small, { color: p.ink }]}>{annotation.source}</Text>
          <BoardField title={t('Quoted text')} value={annotation.quote} multiline limit={4000}
            change={value => setAnnotation({ ...annotation, quote: value })} />
          <BoardField title={t('Annotation')} value={annotation.note} multiline limit={2000}
            change={note => setAnnotation({ ...annotation, note })} />
          <View style={styles.row}>
            {control(t('Add annotation'), () => {
              const range = quoteRanges(annotation.source, annotation.quote)[0]
              if (!range) return
              setAnnotations(old => [...old, { ...range, commentId: annotation.commentId, note: annotation.note }])
              setAnnotation(null)
            }, disabled || !annotation.note.trim() || !quoteRanges(annotation.source, annotation.quote).length || annotations.length >= 20)}
            {control(t('Cancel'), () => setAnnotation(null))}
          </View>
        </View> : null}
        {annotations.map((note, index) => <View key={index}>
          {muted(note.quote)}<CommentBody body={note.note} />
          {control(t('Remove annotation'), () => setAnnotations(old => old.filter((_, i) => i !== index)))}
        </View>)}
        {draft.edit || draft.parent ? <View style={styles.row}>
          {muted(draft.edit ? t('Edit comment') : t('Reply to {name}', { name: name(draft.parent!) }))}
          {control(t('Cancel'), () => { setDraft(fresh()); setAddress(false); setAnnotations([]); setAnnotation(null); setModes({}) }, state.busy || picking)}
        </View> : null}
        <TextInput ref={input} multiline maxLength={commentLength} editable={!disabled}
          accessibilityLabel={t('Comment')} placeholder={t('Write a comment…')} placeholderTextColor={p.ink3}
          value={draft.body} selection={placement} onFocus={onCompose} onSelectionChange={event => {
            const next = event.nativeEvent.selection
            if (placement && next.start === placement.start && next.end === placement.end) setPlacement(undefined)
            selection.current = next
            setCursor(next.start)
          }}
          onChangeText={body => {
            setPlacement(undefined)
            setDraft(prior => ({ ...prior, body }))
            setAddress(true)
          }} style={[styles.input, typeScale.settingsRow, { color: p.ink, backgroundColor: p.bubble }]} />
        {suggested ? <View style={styles.row}>{(suggested.options as Bot[]).map(bot =>
          control('@' + bot.name, () => {
            const next = chooseCommentAddress(draft.body, suggested, bot)
            typeAt(next.body, next.cursor)
          }, disabled, false, bot.id))}</View> : null}
        {draft.files.length || draft.keep.length ? <View style={styles.row}>
          {[...draft.keep, ...draft.files].map((file, index) => control(file.name + ' ×', () =>
            setDraft(prior => ({ ...prior, keep: prior.keep.filter(f => f !== file), files: prior.files.filter(f => f !== file) })),
          disabled, false, 'file-' + index))}
        </View> : null}
        {!draft.quiet && notified.length ? muted(t('Will wake {names}', {
          names: bots.filter(bot => notified.includes(bot.id)).map(bot => bot.name).join(', '),
        })) : null}
        {!draft.quiet ? notified.map(botId => {
          const binding = roots?.activeRuns?.[botId]
          if (!binding) return null
          const fileCount = draft.files.length + draft.keep.length
          return <View key={botId}>{muted(bots.find(bot => bot.id === botId)?.name ?? '')}
            <View style={styles.row}>
              {Object.entries(commentModes).filter(([mode]) => mode !== 'steer' || binding.steer && !fileCount)
                .map(([mode, label]) => control(t(label), () => setModes(old => ({ ...old,
                  [botId]: { mode, runId: binding.runId, turnId: binding.turnId },
                })), disabled, (modes[botId]?.mode ?? 'queue') === mode, mode))}
            </View>
          </View>
        }) : null}
        {!draft.quiet && plan.unmatched ? muted(t('An @mention did not match an available Bot.')) : null}
        <View style={styles.row}>
          {control(t('Mention a Bot'), () => {
            const { start, end } = selection.current
            const at = draft.body.slice(0, start).match(/[\w./@]$/) ? ' @' : '@'
            typeAt(draft.body.slice(0, start) + at + draft.body.slice(end), start + at.length)
            setAddress(true)
          }, disabled || !bots.length)}
          {control(t('Attach files'), () => void attach(), disabled)}
          {control(t('Comment without waking Bots'), () => setDraft(prior => ({ ...prior, quiet: !prior.quiet })), disabled, draft.quiet)}
          {control(t(draft.edit ? 'Save changes' : draft.parent ? 'Send reply' : 'Post comment'),
            () => void submit(), disabled || !ready, false, 'send-comment', true)}
        </View>
      </View>
    </View>
  )
}
const styles = StyleSheet.create({
  discussion: { gap: 9, paddingBottom: 12 },
  thread: { gap: 6 },
  replies: { marginLeft: 12, paddingLeft: 6, borderLeftWidth: StyleSheet.hairlineWidth, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  comment: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 10, gap: 7 },
  avatar: { borderRadius: 13, overflow: 'hidden', minWidth: 26, paddingVertical: 4, textAlign: 'center' },
  control: { minHeight: 44, justifyContent: 'center', borderRadius: 7, paddingHorizontal: 9 },
  composer: { padding: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, gap: 7 },
  input: { minHeight: 72, maxHeight: 180, borderRadius: 7, padding: 8, textAlignVertical: 'top' },
})
