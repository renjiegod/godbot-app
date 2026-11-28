import { useState } from 'react'
import { Image, Text, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import { Directory, EncodingType, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useTeam, type TeamCtx } from '../team/context.tsx'
import { t } from '../ui/i18n.ts'
import { radius, type as typeScale, useTheme } from '../ui/tokens.ts'
import { BoardButton, BoardText, SectionCard, StatusPill, tint, type Catalog, type PlanFields, type Choose } from './work-board-management.tsx'
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
const row = { flexDirection: 'row', flexWrap: 'wrap', gap: 7 } as const
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

export function BoardPlanningDetail({ item, readOnly, open, add, annotate, openComment }: {
  item: PlanItem; catalog?: Catalog; readOnly: boolean; open: (id: string) => void
  add: () => void; annotate: (description: string) => void; openComment: (id: string, commentId: string) => void
}) {
  const { p } = useTheme()
  const { call } = useTeam()
  const [audit, setAudit] = useState(false)
  const [snapshot, setSnapshot] = useState(false)
  const [error, setError] = useState('')
  const { fields, planning: plan } = item
  if (!plan || !fields) return null
  const related = (title: string, refs: Relation[]) => refs.length ? <View style={{ gap: 6 }}>
    <Text style={[typeScale.caption, { color: p.ink3, fontWeight: '600' }]}>{t(title)}</Text>
    <View style={row}>
      {refs.map(ref => <BoardButton key={ref.id} variant="soft"
        title={ref.id + ' · ' + ref.title + (ref.stage ? ' · ' + t('Stage') + ' ' + ref.stage : '')} onPress={() => open(ref.id)} />)}
    </View>
  </View> : null
  const hasRelations = plan.parent || plan.prerequisites.length || plan.dependents.length || plan.duplicateOf || plan.duplicates.length
  const pct = plan.progress.total ? Math.round((100 * plan.progress.completed) / plan.progress.total) : 0
  return <View style={{ gap: 10 }}>
    {plan.waiting ? (
      <View style={{ padding: 11, borderRadius: radius.row, borderLeftWidth: 3, borderLeftColor: p.accent, backgroundColor: tint(p.accent, 0.1) }}>
        <BoardText>{t('Waiting for prerequisites') + ' · ' + plan.waiting}</BoardText>
      </View>
    ) : null}
    {item.reviewBlocked ? (
      <View style={{ padding: 11, borderRadius: radius.row, borderLeftWidth: 3, borderLeftColor: p.star, backgroundColor: tint(p.star, 0.14) }}>
        <BoardText>{t('Evidence must match the current requirements and prerequisites. Request changes before accepting.')}</BoardText>
      </View>
    ) : null}
    {fields.description ? (
      <SectionCard
        title={t('Task description')}
        right={!readOnly ? <BoardButton compact variant="soft" title={t('Add description annotation')} onPress={() => annotate(fields.description ?? '')} /> : undefined}
      >
        <BoardText>{fields.description}</BoardText>
      </SectionCard>
    ) : null}
    <SectionCard
      title={t('Subtasks')}
      badge={plan.progress.total ? plan.progress.completed + ' / ' + plan.progress.total : undefined}
      right={!readOnly ? <BoardButton compact variant="soft" title={t('New subtask')} onPress={add} /> : undefined}
    >
      {plan.progress.total ? (
        <View style={{ height: 6, borderRadius: 3, backgroundColor: p.bubble, overflow: 'hidden' }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: p.green, width: `${pct}%` }} />
        </View>
      ) : null}
      {plan.children.length ? <View style={row}>
        {plan.children.map(ref => <BoardButton key={ref.id} variant="soft"
          title={ref.id + ' · ' + ref.title + (ref.stage ? ' · ' + t('Stage') + ' ' + ref.stage : '')} onPress={() => open(ref.id)} />)}
      </View> : null}
    </SectionCard>
    {hasRelations ? (
      <SectionCard title={t('Task relationships')}>
        {related('Parent work item', plan.parent ? [plan.parent] : [])}
        {related('Waits for', plan.prerequisites)}
        {related('Blocks', plan.dependents)}
        {related('Duplicate of', plan.duplicateOf ? [plan.duplicateOf] : [])}
        {related('Duplicates', plan.duplicates)}
      </SectionCard>
    ) : null}
    {plan.snapshot ? <SectionCard>
      <BoardButton variant="soft" title={t('Source discussion snapshot')} selected={snapshot} onPress={() => setSnapshot(!snapshot)} />
      {snapshot ? <>
        <BoardButton title={plan.snapshot.id + ' · ' + t('Go to source comment')}
          onPress={() => openComment(plan.snapshot!.id, plan.snapshot!.commentId)} />
        <BoardText faint>{stamp(plan.snapshot.at)}</BoardText>
        <BoardText>{plan.snapshot.context.title}</BoardText>
        <BoardText>{plan.snapshot.context.description}</BoardText>
        {plan.snapshot.context.comments.map((comment, index) =>
          <View key={index} style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: p.line2 }}>
            <BoardText faint>{comment.author}</BoardText><BoardText>{comment.text}</BoardText>
          </View>)}
        {plan.snapshot.attachments.map(file => <BoardButton key={file.id} variant="soft" title={file.name} onPress={() => void (async () => {
          try { await shareBoardFile(await boardFile(call, item.id, file.id, undefined, true)) } catch (cause) { setError(issue(cause)) }
        })()} />)}
      </> : null}
    </SectionCard> : null}
    {plan.audit.length ? <SectionCard>
      <BoardButton variant="soft" title={t('Edit history')} selected={audit} onPress={() => setAudit(!audit)} />
      {audit ? plan.audit.map(entry => <View key={entry.id} style={{ gap: 5, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: p.line2 }}>
        <BoardText faint>{stamp(entry.at) + (entry.reason ? ' · ' + entry.reason : '')}</BoardText>
        {entry.changes.map(change => <BoardText key={change.field}>{t(({
          description: 'Task description', title: 'Title', criteria: 'Acceptance criteria', priority: 'Priority',
          labels: 'Labels', startDate: 'Start date', dueDate: 'Due date', statusId: 'Task status',
          assignee: 'Owner', parent: 'Parent work item', stage: 'Stage', blockedBy: 'Waits for',
          duplicateOf: 'Duplicate of', customValues: 'Custom property', archived: 'Archived', pendingDispatch: 'Queued',
        } as Record<string, string>)[change.field] ?? change.field) + '\n' +
          JSON.stringify(change.before) + '\n→ ' + JSON.stringify(change.after)}</BoardText>)}
      </View>) : null}
    </SectionCard> : null}
    {error ? <Text style={[typeScale.small, { color: p.danger }]}>{error}</Text> : null}
  </View>
}

export function BoardExecutions({ id, initialRun, readOnly, modify, open, openComment }: {
  id: string; initialRun?: string; readOnly: boolean
  modify: (change: { op: string; runId: string; turnId?: number }) => Promise<boolean>
  open: (ref: BoardRef) => void; openComment: (id: string, comment: string) => void
}) {
  const { p } = useTheme()
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
  return <View style={{ gap: 10 }}>
    {error ? <Text style={[typeScale.small, { color: p.danger }]}>{error}</Text> : null}
    {runId ? <>
      <View style={row}>
        <BoardButton compact variant="soft" title={t('All runs')} onPress={() => choose(null)} />
        {run?.sessionId ? <BoardButton compact title={t('Open execution conversation')} onPress={() => open(run)} /> : null}
        {run?.commentId ? <BoardButton compact title={t('Go to source comment')} onPress={() => openComment(id, run.commentId!)} /> : null}
      </View>
      {run ? <SectionCard title={run.name ?? 'Bot'} right={<StatusPill phase={run.status === 'running' ? 'doing' : run.status === 'failed' ? 'attention' : 'done'} label={runLabel(run.status)} />}>
        {run.reason ? <BoardText faint>{run.reason}</BoardText> : null}
        {!readOnly ? <View style={row}>
          {run.canStop ? <BoardButton variant="danger" title={t('Stop this run')} onPress={() => setConfirm('run-stop')} /> : null}
          {run.canRetry ? <BoardButton title={t('Retry this run')} onPress={() => setConfirm('run-retry')} /> : null}
          {confirm ? <>
            <BoardButton variant="primary" title={t('Confirm')} onPress={() => void (async () => {
              if (await modify({ op: confirm, runId: run.id, turnId: run.turnId })) {
                if (confirm === 'run-retry') choose(null)
                else { setConfirm(null); log.refresh() }
              }
            })()} />
            <BoardButton title={t('Cancel')} onPress={() => setConfirm(null)} />
          </> : null}
        </View> : null}
      </SectionCard> : null}
      {transcript?.unavailable ? <BoardText faint>{t('Execution log becomes available when the engine reads this run.')}</BoardText> : null}
      {before ? <BoardButton variant="soft" title={t('Latest events')} onPress={() => setBefore(null)} /> : null}
      {transcript?.omitted ? <BoardButton variant="soft" title={t('Earlier activity')} onPress={() => setBefore(transcript.omitted!)} /> : null}
      {(transcript?.events ?? []).map((event, index) => <SectionCard key={index}>
        <BoardText>{[event.name, event.status && runLabel(event.status), event.text].filter(Boolean).join(' · ')}</BoardText>
        {event.toolId ? <BoardButton compact variant="soft" title={t('Tool details')} selected={event.toolId === toolId}
          onPress={() => setTool(event.toolId === toolId ? null : event.toolId!)} /> : null}
        {event.toolId && event.toolId === toolId && tool.data ? Object.entries(tool.data).filter(([key]) => key !== 'run')
          .map(([key, value]) => <View key={key}><BoardText faint>{t(key)}</BoardText><BoardText>{String(value)}</BoardText></View>) : null}
      </SectionCard>)}
    </> : <>
      {!runs && !error ? <BoardText faint>{t('Loading…')}</BoardText> : null}
      {runs && !runs.runs.length ? <BoardText faint>{t('No runs yet.')}</BoardText> : null}
      {runs?.runs.map(run => <SectionCard key={run.id}
        title={(run.name ?? 'Bot') + (run.attempt ? ' · ' + t('Attempt {number}', { number: run.attempt }) : '')}
        right={<StatusPill phase={run.status === 'running' ? 'doing' : run.status === 'failed' ? 'attention' : 'done'} label={runLabel(run.status)} />}
      >
        <BoardText faint>{stamp(run.createdAt) + (run.reason ? ' · ' + run.reason : '')}</BoardText>
        <BoardButton variant="soft" title={t('View run')} onPress={() => choose(run.id)} />
      </SectionCard>)}
      {after ? <BoardButton variant="soft" title={t('Latest runs')} onPress={() => setAfter(null)} /> : null}
      {runs?.next ? <BoardButton variant="soft" title={t('Earlier runs')} onPress={() => setAfter(runs.next!)} /> : null}
    </>}
  </View>
}

export function BoardArtifacts({ id, choose, openComment }: { id: string; choose: Choose; openComment: (id: string, comment: string) => void }) {
  const { p } = useTheme()
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
  return <View style={{ gap: 10 }}>
    <View style={row}>
      <BoardButton compact selected={!!filter} title={choices.find(([id]) => id === filter)?.[1] ?? t('All files')}
        onPress={() => choose(t('Artifact type'), choices, value => { setFilter(value); setPreview(null) }, filter)} />
    </View>
    {error || page.error ? <Text style={[typeScale.small, { color: p.danger }]}>{error || page.error}</Text> : null}
    {data && !items.length ? <BoardText faint>{t('No matching artifacts.')}</BoardText> : null}
    {preview ? <SectionCard right={<BoardButton compact title={t('Close preview')} onPress={() => setPreview(null)} />}>
      <Image accessibilityLabel={preview.name} source={{ uri: preview.src }} resizeMode="contain" style={{ width: '100%', height: 240, borderRadius: radius.input }} />
    </SectionCard> : null}
    {items.map(item => <SectionCard key={item.id} title={item.name} badge={'v' + item.versions.at(-1)?.version}>
      {[...item.versions].reverse().map(version => <View key={version.id} style={{ gap: 6 }}>
        <BoardText faint>{'v' + version.version + ' · ' + stamp(version.at) + ' · ' + Math.ceil(version.size / 1024) + ' KB'}</BoardText>
        <View style={row}>
          {/^image\/(png|jpeg|webp|gif)$/.test(item.mime) ? <BoardButton compact variant="soft" title={t('Preview')} onPress={() => void show(version, true)} /> : null}
          <BoardButton compact variant="soft" title={t('Download attachment')} onPress={() => void show(version, false)} />
          <BoardButton compact variant="soft" title={t('Go to source comment')} onPress={() => openComment(id, version.commentId)} />
        </View>
      </View>)}
    </SectionCard>)}
  </View>
}
