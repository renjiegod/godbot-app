import { useState } from 'react'
import { Image, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import { Directory, EncodingType, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useTeam, type TeamCtx } from '../team/context.tsx'
import { t } from '../ui/i18n.ts'
import { BoardButton, BoardText, assigneeName, boardName, type Catalog, type PlanFields, type Choose } from './work-board-management.tsx'
import { useBoardRead } from '../../godbot/shared/work-board.js'
import { commentRunLabels } from '../../godbot/shared/work-board-discussion-format.js'

export type BoardRef = { botId?: string; roomId?: string; sessionId?: string; messageId?: string; turnId?: number }
type Relation = { id: string; title: string; stage: number; phase: string }
type FileRef = { id: string; name: string; mime: string; size: number }
type Snapshot = {
  id: string; commentId: string; at: number; attachments: FileRef[]
  context: { title: string; description: string; comments: { text: string; author: string; at: number }[] }
}
type Audit = { id: string; at: number; reason: string; changes: { field: string; before: unknown; after: unknown }[] }
export type Plan = {
  parent?: Relation; duplicateOf?: Relation; duplicates: Relation[]; children: Relation[]
  prerequisites: Relation[]; dependents: Relation[]; progress: { completed: number; total: number }
  waiting: number; restricted: number; snapshot?: Snapshot; audit: Audit[]
}
type Run = BoardRef & {
  id: string; name?: string; commentId?: string; status: string; createdAt: number; attempt?: number;
  reason?: string; canStop?: boolean; canRetry?: boolean;
}
type LogEvent = { type: string; text?: string; toolId?: string; status?: string; name?: string }
type RunPage = { runs: Run[]; next?: string }
type RunLog = { run: Run; events?: LogEvent[]; unavailable?: boolean; omitted?: number }
type FileVersion = { id: string; commentId: string; size: number; at: number; version: number }
type Artifact = { id: string; name: string; mime: string; versions: FileVersion[] }
type PlanItem = { id: string; fields?: PlanFields; planning?: Plan; statusId?: string; reviewBlocked?: boolean }
const issue = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)
const stamp = (at: number) => new Date(at).toLocaleString()
const row = { flexDirection: 'row', flexWrap: 'wrap', gap: 6 } as const
export const runLabel = (status: string) => t((commentRunLabels as Record<string, string>)[status] ?? status)

export async function boardFile(call: TeamCtx['call'], id: string, fileId: string, commentId?: string, snapshot = false) {
  return await call('board-comment-file', { id, fileId, commentId, snapshot }) as FileRef & { bytes: string }
}
export async function shareBoardFile(data: FileRef & { bytes: string }) {
  const dir = new Directory(Paths.cache, 'work-comments', Crypto.randomUUID())
  dir.create({ intermediates: true })
  const path = new File(dir, data.name)
  await path.write(data.bytes, { encoding: EncodingType.Base64 })
  await Sharing.shareAsync(path.uri, { mimeType: data.mime, dialogTitle: data.name })
}

export function BoardPlanningDetail({ item, catalog, readOnly, open, add, annotate, openComment }: {
  item: PlanItem; catalog?: Catalog; readOnly: boolean; open: (id: string) => void
  add: () => void; annotate: (description: string) => void; openComment: (id: string, commentId: string) => void
}) {
  const { call } = useTeam()
  const [audit, setAudit] = useState(false)
  const [snapshot, setSnapshot] = useState(false)
  const [error, setError] = useState('')
  const { fields, planning: plan } = item
  if (!plan || !fields) return null
  const related = (title: string, refs: Relation[]) => refs.length ? <View style={{ gap: 5 }}>
    <BoardText faint>{t(title)}</BoardText>
    {refs.map(ref => <BoardButton key={ref.id}
      title={ref.id + ' · ' + ref.title + (ref.stage ? ' · ' + t('Stage') + ' ' + ref.stage : '')} onPress={() => open(ref.id)} />)}
  </View> : null
  return <View style={{ gap: 9 }}>
    {fields.description ? <>
      <BoardText faint>{t('Task description')}</BoardText><BoardText>{fields.description}</BoardText>
      {!readOnly ? <BoardButton title={t('Add description annotation')} onPress={() => annotate(fields.description ?? '')} /> : null}
    </> : null}
    <View style={row}>
      {item.statusId ? <BoardText>{boardName(item.statusId, 'status', catalog)}</BoardText> : null}
      {fields.startDate ? <BoardText faint>{t('Start date') + ' ' + fields.startDate}</BoardText> : null}
      {fields.dueDate ? <BoardText faint>{t('Due date') + ' ' + fields.dueDate}</BoardText> : null}
      {fields.labels?.map(label => <BoardText key={label} faint>{label}</BoardText>)}
    </View>
    {(catalog?.properties ?? []).filter(p => !p.archived && fields.customValues && p.id in fields.customValues).map(p => {
      const value = fields.customValues?.[p.id]
      const format = (v: unknown) => ['person', 'people'].includes(p.kind) ? assigneeName(String(v), catalog) : String(v)
      return <BoardText key={p.id}>{p.name + ' · ' + (Array.isArray(value) ? value.map(format).join(', ') : format(value))}</BoardText>
    })}
    {plan.waiting ? <BoardText>{t('Waiting for prerequisites') + ' · ' + plan.waiting}</BoardText> : null}
    {item.reviewBlocked ? <BoardText>{t('Evidence must match the current requirements and prerequisites. Request changes before accepting.')}</BoardText> : null}
    {related('Parent work item', plan.parent ? [plan.parent] : [])}
    {related('Waits for', plan.prerequisites)}
    {related('Blocks', plan.dependents)}
    {related('Duplicate of', plan.duplicateOf ? [plan.duplicateOf] : [])}
    {related('Duplicates', plan.duplicates)}
    {plan.progress.total ? <BoardText>{t('Subtasks') + ' · ' + plan.progress.completed + ' / ' + plan.progress.total}</BoardText> : null}
    {related('Subtasks', plan.children)}
    {!readOnly ? <BoardButton title={t('New subtask')} onPress={add} /> : null}
    {plan.snapshot ? <View style={{ gap: 5 }}>
      <BoardButton title={t('Source discussion snapshot')} selected={snapshot} onPress={() => setSnapshot(!snapshot)} />
      {snapshot ? <>
        <BoardButton title={plan.snapshot.id + ' · ' + t('Go to source comment')}
          onPress={() => openComment(plan.snapshot!.id, plan.snapshot!.commentId)} />
        <BoardText faint>{stamp(plan.snapshot.at)}</BoardText>
        <BoardText>{plan.snapshot.context.title}</BoardText>
        <BoardText>{plan.snapshot.context.description}</BoardText>
        {plan.snapshot.context.comments.map((comment, index) =>
          <View key={index}><BoardText faint>{comment.author}</BoardText><BoardText>{comment.text}</BoardText></View>)}
        {plan.snapshot.attachments.map(file => <BoardButton key={file.id} title={file.name} onPress={() => void (async () => {
          try { await shareBoardFile(await boardFile(call, item.id, file.id, undefined, true)) } catch (cause) { setError(issue(cause)) }
        })()} />)}
      </> : null}
    </View> : null}
    {plan.audit.length ? <BoardButton title={t('Edit history')} selected={audit} onPress={() => setAudit(!audit)} /> : null}
    {audit ? plan.audit.map(entry => <View key={entry.id} style={{ gap: 5 }}>
      <BoardText faint>{stamp(entry.at) + (entry.reason ? ' · ' + entry.reason : '')}</BoardText>
      {entry.changes.map(change => <BoardText key={change.field}>{t(({
        description: 'Task description', title: 'Title', criteria: 'Acceptance criteria', priority: 'Priority',
        labels: 'Labels', startDate: 'Start date', dueDate: 'Due date', statusId: 'Task status',
        assignee: 'Owner', parent: 'Parent work item', stage: 'Stage', blockedBy: 'Waits for',
        duplicateOf: 'Duplicate of', customValues: 'Custom property', archived: 'Archived', pendingDispatch: 'Queued',
      } as Record<string, string>)[change.field] ?? change.field) + '\n' +
        JSON.stringify(change.before) + '\n→ ' + JSON.stringify(change.after)}</BoardText>)}
    </View>) : null}
    {error ? <BoardText>{error}</BoardText> : null}
  </View>
}

export function BoardExecutions({ id, initialRun, readOnly, modify, open, openComment }: {
  id: string; initialRun?: string; readOnly: boolean
  modify: (change: { op: string; runId: string; turnId?: number }) => Promise<boolean>
  open: (ref: BoardRef) => void; openComment: (id: string, comment: string) => void
}) {
  const { call, online, onFeed } = useTeam()
  const [runId, select] = useState<string | null>(initialRun ?? null)
  const [after, setAfter] = useState<string | null>(null)
  const [before, setBefore] = useState<number | null>(null)
  const [toolId, setTool] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const choose = (id: string | null) => { select(id); setBefore(null); setTool(null); setConfirm(null) }
  const page = useBoardRead({ call, subscribe: onFeed, endpoint: 'board-runs', id, active: !runId, online, query: { after } })
  const log = useBoardRead({ call, subscribe: onFeed, endpoint: 'board-runs', id, active: !!runId, online, query: { runId, before } })
  const tool = useBoardRead({ call, endpoint: 'board-runs', id, active: !!toolId, online, subscribe: undefined, query: { runId, toolId } })
  const runs = page.data as RunPage | null
  const transcript = log.data as RunLog | null
  const run = transcript?.run
  const error = page.error || log.error || tool.error
  return <View style={{ gap: 8 }}>
    {error ? <BoardText>{error}</BoardText> : null}
    {runId ? <>
      <BoardButton title={t('All runs')} onPress={() => choose(null)} />
      {run ? <BoardText>{(run.name ?? 'Bot') + ' · ' + runLabel(run.status) + (run.reason ? ' · ' + run.reason : '')}</BoardText> : null}
      {run?.sessionId ? <BoardButton title={t('Open execution conversation')} onPress={() => open(run)} /> : null}
      {run?.commentId ? <BoardButton title={t('Go to source comment')} onPress={() => openComment(id, run.commentId!)} /> : null}
      {run && !readOnly ? <View style={row}>
        {run.canStop ? <BoardButton title={t('Stop this run')} onPress={() => setConfirm('run-stop')} /> : null}
        {run.canRetry ? <BoardButton title={t('Retry this run')} onPress={() => setConfirm('run-retry')} /> : null}
        {confirm ? <>
          <BoardButton title={t('Confirm')} onPress={() => void (async () => {
            if (await modify({ op: confirm, runId: run.id, turnId: run.turnId })) {
              if (confirm === 'run-retry') choose(null)
              else { setConfirm(null); log.refresh() }
            }
          })()} />
          <BoardButton title={t('Cancel')} onPress={() => setConfirm(null)} />
        </> : null}
      </View> : null}
      {transcript?.unavailable ? <BoardText faint>{t('Execution log becomes available when the engine reads this run.')}</BoardText> : null}
      {before ? <BoardButton title={t('Latest events')} onPress={() => setBefore(null)} /> : null}
      {transcript?.omitted ? <BoardButton title={t('Earlier activity')} onPress={() => setBefore(transcript.omitted!)} /> : null}
      {(transcript?.events ?? []).map((event, index) => <View key={index} style={{ gap: 5, paddingVertical: 6 }}>
        <BoardText>{[event.name, event.status && runLabel(event.status), event.text].filter(Boolean).join(' · ')}</BoardText>
        {event.toolId ? <BoardButton title={t('Tool details')} selected={event.toolId === toolId}
          onPress={() => setTool(event.toolId === toolId ? null : event.toolId!)} /> : null}
        {event.toolId && event.toolId === toolId && tool.data ? Object.entries(tool.data).filter(([key]) => key !== 'run')
          .map(([key, value]) => <View key={key}><BoardText faint>{t(key)}</BoardText><BoardText>{String(value)}</BoardText></View>) : null}
      </View>)}
    </> : <>
      {!runs && !error ? <BoardText>{t('Loading…')}</BoardText> : null}
      {runs && !runs.runs.length ? <BoardText>{t('No runs yet.')}</BoardText> : null}
      {runs?.runs.map(run => <View key={run.id} style={{ gap: 5 }}>
        <BoardButton title={(run.name ?? 'Bot') + ' · ' + runLabel(run.status) + (run.attempt ? ' · ' + t('Attempt {number}', { number: run.attempt }) : '')}
          onPress={() => choose(run.id)} />
        <BoardText faint>{stamp(run.createdAt) + (run.reason ? ' · ' + run.reason : '')}</BoardText>
      </View>)}
      {after ? <BoardButton title={t('Latest runs')} onPress={() => setAfter(null)} /> : null}
      {runs?.next ? <BoardButton title={t('Earlier runs')} onPress={() => setAfter(runs.next!)} /> : null}
    </>}
  </View>
}

export function BoardArtifacts({ id, choose, openComment }: { id: string; choose: Choose; openComment: (id: string, comment: string) => void }) {
  const { call, online, onFeed } = useTeam()
  const page = useBoardRead({ call, subscribe: onFeed, endpoint: 'board-artifacts', id, active: true, online, query: undefined })
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null)
  const data = page.data as { artifacts: Artifact[] } | null
  const items = (data?.artifacts ?? []).filter(item => !filter ||
    (filter === 'other' ? !/^(image|video|text)\//.test(item.mime) : item.mime.startsWith(filter + '/')))
  const choices: [string, string][] = [['', t('All files')], ['image', t('Images')], ['video', t('Video')], ['text', t('Text')], ['other', t('Other')]]
  async function show(version: FileVersion, preview: boolean) {
    try {
      setError('')
      const file = await boardFile(call, id, version.id, version.commentId)
      if (preview && /^image\/(png|jpeg|webp|gif)$/.test(file.mime))
        setPreview({ src: 'data:' + file.mime + ';base64,' + file.bytes, name: file.name })
      else await shareBoardFile(file)
    } catch (cause) { setError(issue(cause)) }
  }
  return <View style={{ gap: 8 }}>
    <BoardButton title={choices.find(([id]) => id === filter)?.[1] ?? t('All files')}
      onPress={() => choose(t('Artifact type'), choices, value => { setFilter(value); setPreview(null) })} />
    {error || page.error ? <BoardText>{error || page.error}</BoardText> : null}
    {data && !items.length ? <BoardText>{t('No matching artifacts.')}</BoardText> : null}
    {preview ? <View>
      <BoardButton title={t('Close preview')} onPress={() => setPreview(null)} />
      <Image accessibilityLabel={preview.name} source={{ uri: preview.src }} resizeMode="contain" style={{ width: '100%', height: 260 }} />
    </View> : null}
    {items.map(item => <View key={item.id} style={{ gap: 5 }}>
      <BoardText>{item.name + ' · v' + item.versions.at(-1)?.version}</BoardText>
      {[...item.versions].reverse().map(version => <View key={version.id} style={row}>
        <BoardText faint>{'v' + version.version + ' · ' + stamp(version.at) + ' · ' + Math.ceil(version.size / 1024) + ' KB'}</BoardText>
        {/^image\/(png|jpeg|webp|gif)$/.test(item.mime) ? <BoardButton title={t('Preview')} onPress={() => void show(version, true)} /> : null}
        <BoardButton title={t('Download attachment')} onPress={() => void show(version, false)} />
        <BoardButton title={t('Go to source comment')} onPress={() => openComment(id, version.commentId)} />
      </View>)}
    </View>)}
  </View>
}
