// Presentation labels and request/refresh handling are shared with the paired Android client.
import { useCallback, useEffect, useRef, useState } from 'react'

export const phaseNames = {
  todo: 'To do',
  doing: 'In progress',
  attention: 'Needs attention',
  review: 'Awaiting review',
  done: 'Done',
  history: 'History',
}
export const sourceNames = {
  draft: 'Draft',
  task: 'Bot assignment',
  room: 'Group chat',
  workflow: 'Workflow',
  run: 'Team run',
}
export const markNames = {
  draft: 'Draft',
  archived: 'Archived',
  queued: 'Queued',
  sent: 'Delivered',
  dependencies: 'Waiting for prerequisites',
  waiting: 'Waiting',
  selfActive: 'Group progress',
  roomReview: 'Group confirmation',
  selfDone: 'Reported complete by Bot',
  cancelled: 'Cancelled',
  accepted: 'Accepted',
  reported: 'Awaiting review',
  working: 'Working',
  awaitingReport: 'Waiting for a report',
  transferring: 'Transferring',
  blocked: 'Blocked',
  failed: 'Failed',
  unknown: 'Receipt needs checking',
  interrupted: 'Interrupted',
  stopped: 'Stopped',
  skipped: 'Skipped',
  interaction: 'Pending interaction',
  budget: 'Waiting for budget',
}
export const actionNames = {
  create: 'Save as draft',
  edit: 'Edit draft',
  dispatch: 'Assign to Bot',
  archive: 'Archive draft',
  approve: 'Accept evidence',
  reject: 'Request changes',
  retry: 'Retry assignment',
  transfer: 'Transfer assignment',
  note: 'Send note and mention owner',
  cancel: 'Cancel group task',
}
export const phaseIcons = { todo: '○', doing: '◐', attention: '!', review: '◇', done: '✓', history: '◷' }
export const defaultFilters = { tab: 'all', search: '', owner: '', room: '', source: '', section: '' }

// A stale review can be reopened against the new evidence without losing the reviewer's draft.
export function currentReview(form, item) {
  if (
    !form?.base ||
    !item ||
    form.base.id !== item.id ||
    form.base.version === item.version ||
    !['approve', 'reject'].includes(form.op) ||
    !item.actions.includes(form.op)
  )
    return null
  const child = form.child && item.children.find((c) => c.id === form.child.id && c.status === 'reported')
  if (form.child && !child) return null
  return { ...form, base: item, child }
}

export function activityByAttempt(events) {
  const groups = new Map()
  for (const event of events) {
    const attempt = event.attempt || 0
    if (!groups.has(attempt)) groups.set(attempt, { attempt, events: [] })
    groups.get(attempt).events.push(event)
  }
  return [...groups.values()]
}

export function anchoredItems(items, messageId, turnId) {
  if (messageId != null) {
    const key = String(messageId)
    const seq = /^(?:[a-z]+:)?(\d+)$/i.exec(key)?.[1]
    return items.filter((i) => (i.id != null && String(i.id) === key) || (seq != null && String(i.seq) === seq))
  }
  return turnId == null ? [] : items.filter((i) => i.turn === turnId)
}

export function useWorkBoard({ call, subscribe, online = true, identity, filters, selected }) {
  const [view, setView] = useState(null),
    [item, setItem] = useState(null),
    [error, setError] = useState(''),
    [writeError, setWriteError] = useState('')
  const [reachable, setReachable] = useState(false)
  const [accessGone, setAccessGone] = useState(false)
  const cached = useRef(null)
  const [busy, setBusy] = useState(false),
    [refreshAt, setRefreshAt] = useState(null)
  const generation = useRef(0),
    read = useRef(0),
    writing = useRef(false),
    pending = useRef(null)
  const filterKey = JSON.stringify(filters)
  const refresh = useCallback(async () => {
    const stamp = ++read.current,
      gen = generation.current
    if (!online) return
    try {
      const [v, detail] = await Promise.all([
        call('board-view', JSON.parse(filterKey)),
        selected
          ? call('board-item', typeof selected === 'string' ? { id: selected } : selected).then(
              (value) => ({ value }),
              (cause) => ({ cause }),
            )
          : null,
      ])
      if (gen !== generation.current || stamp !== read.current) return
      // Keep loaded pages while their host revision and authorization filters match.
      const signature = JSON.stringify([
        filterKey,
        v.revision,
        v.counts,
        v.bots,
        v.rooms,
        v.columns.map((c) => c.items.map((i) => i.id)),
      ])
      if (cached.current !== signature) {
        setView(v)
        cached.current = signature
      }
      if (detail?.cause) {
        const gone =
          /无法访问|不存在|access|refused/i.test(detail.cause.message) || detail.cause.code === 'bot/not-found'
        if (gone) setItem(null)
        setAccessGone(gone)
        setError(detail.cause.message || String(detail.cause))
      } else {
        setAccessGone(false)
        setItem((old) =>
          old &&
          old.id === detail?.value?.id &&
          old.version === detail.value.version &&
          !detail.value.readOnly &&
          !old.readOnly
            ? { ...detail.value, events: old.events, eventNext: old.eventNext }
            : (detail?.value ?? null),
        )
        setError('')
      }
      setReachable(true)
      setRefreshAt(Date.now())
    } catch (e) {
      if (gen !== generation.current || stamp !== read.current) return
      if (/无法访问|不存在|access|refused/i.test(String(e.message))) {
        setView(null)
        setItem(null)
        cached.current = null
      }
      setReachable(false)
      setError(e.message || String(e))
    }
  }, [call, filterKey, selected, online, identity])
  useEffect(() => {
    setView(null)
    setItem(null)
    setRefreshAt(null)
    setReachable(false)
    pending.current = null
    cached.current = null
  }, [identity])
  useEffect(() => {
    setItem(null)
    setWriteError('')
  }, [selected])
  useEffect(() => {
    generation.current++
    let timer
    const soon = () => {
      clearTimeout(timer)
      timer = setTimeout(refresh, 75)
    }
    void refresh()
    const off =
      online &&
      subscribe?.((event) => {
        if (['work-board', 'revision', 'hello', 'live'].includes(event)) soon()
      })
    const poll = online ? setInterval(refresh, 12000) : null
    return () => {
      generation.current++
      clearTimeout(timer)
      clearInterval(poll)
      if (typeof off === 'function') off()
    }
  }, [refresh, subscribe, online])
  async function more(column) {
    if (!column.next) return
    const gen = generation.current,
      stamp = read.current
    try {
      const result = await call('board-view', {
        ...filters,
        phase: column.phase,
        after: { [column.phase]: column.next },
      })
      if (gen !== generation.current || stamp !== read.current) return
      const next = result.columns[0]
      setView(
        (v) =>
          v && {
            ...v,
            columns: v.columns.map((c) =>
              c.phase === next.phase
                ? {
                    ...next,
                    items: [...new Map([...c.items, ...next.items].map((i) => [i.id, i])).values()],
                  }
                : c,
            ),
          },
      )
    } catch (e) {
      if (gen === generation.current) setError(e.message || String(e))
    }
  }
  async function earlier() {
    if (!item?.eventNext) return
    const gen = generation.current
    try {
      const page = await call('board-item', { id: item.id, before: item.eventNext })
      if (gen === generation.current)
        setItem((old) =>
          old?.id === page.id && old.version === page.version && old.eventNext === item.eventNext
            ? { ...old, events: [...page.events, ...old.events], eventNext: page.eventNext }
            : old,
        )
    } catch (e) {
      if (gen === generation.current) {
        await refresh()
        setError(e.message || String(e))
      }
    }
  }
  async function act(input, newId) {
    if (writing.current || !online) return null
    const json = JSON.stringify(input),
      gen = generation.current
    const request = pending.current?.json === json ? pending.current : { json, id: newId() }
    pending.current = request
    writing.current = true
    setBusy(true)
    setWriteError('')
    try {
      const result = await call('board-action', { ...input, requestId: request.id })
      if (gen !== generation.current) return null
      pending.current = null
      await refresh()
      return result
    } catch (e) {
      if (gen === generation.current) {
        await refresh()
        setWriteError(e.message || String(e))
      }
      return null
    } finally {
      writing.current = false
      setBusy(false)
    }
  }
  return {
    view,
    item,
    error: writeError || error,
    busy,
    reachable,
    accessGone,
    refreshAt,
    refresh,
    more,
    earlier,
    act,
  }
}
