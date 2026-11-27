import { useCallback, useEffect, useRef, useState } from 'react'

// The host owns ordering and permissions. Each view reads a bounded page and
// invalidations name a single card, so discussion traffic does not reload the board.
export function useWorkBoardDiscussion({ call, subscribe, id, active, online, focus, requestId }) {
  const [roots, setRoots] = useState(null)
  const [replies, setReplies] = useState(null)
  const [threadId, setThreadId] = useState(null)
  const [rootBefore, setRootBefore] = useState(/** @type {number | null} */ (null))
  const [replyBefore, setReplyBefore] = useState(/** @type {number | null} */ (null))
  const [readError, setReadError] = useState(null)
  const [writeError, setWriteError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reachable, setReachable] = useState(online)
  const loading = useRef(0)
  const opened = useRef(null)
  const sending = useRef(null)
  const load = useCallback(async () => {
    if (!active || !online) return
    const serial = ++loading.current
    try {
      const [page, thread] = await Promise.all([
        call('board-discussion', { id, before: rootBefore, focus: focus || threadId }),
        threadId ? call('board-discussion', { id, thread: threadId, before: replyBefore, focus }) : Promise.resolve(null),
      ])
      if (serial !== loading.current) return
      setRoots(page)
      setReplies(thread)
      setReachable(true)
      setReadError(null)
      if (focus && page.focusThread && opened.current !== focus) {
        opened.current = focus
        if (page.focusThread !== focus) {
          setReplyBefore(null)
          setThreadId(page.focusThread)
        }
      }
    } catch (error) {
      if (serial !== loading.current) return
      setReachable(false)
      if (error?.code === 'bot/not-found') {
        setRoots(null)
        setReplies(null)
      }
      setReadError(error?.message ?? String(error))
    }
  }, [active, online, call, id, rootBefore, replyBefore, threadId, focus])

  useEffect(() => {
    if (!active || !online) return
    let timer
    const refresh = (event, data) => {
      if (event !== 'hello' && event !== 'revision' && !(event === 'work-board-discussion' && data?.id === id)) return
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        void load()
      }, 90)
    }
    const unsubscribe = subscribe?.(refresh)
    void load()
    return () => {
      loading.current++
      unsubscribe?.()
      clearTimeout(timer)
    }
  }, [active, online, subscribe, id, load])

  const openThread = (thread) => {
    if (threadId === thread) return
    setReplies(null)
    setReplyBefore(null)
    setThreadId(thread)
  }

  async function write(input, thread) {
    if (sending.current?.busy || !online || !reachable || roots?.readOnly) return null
    const key = JSON.stringify(input)
    const attempt = sending.current?.key === key
      ? { ...sending.current, busy: true }
      : { key, id: requestId(), busy: true }
    sending.current = attempt
    setBusy(true)
    setWriteError(null)
    try {
      const result = await call('board-comment', { ...input, id, requestId: attempt.id })
      sending.current = null
      if (thread) openThread(thread)
      if (input.op === 'post') {
        if (thread) setReplyBefore(null)
        else setRootBefore(null)
      }
      return result
    } catch (error) {
      setWriteError(error?.message ?? String(error))
      if (error?.code === 'bot/stale') void load()
      return null
    } finally {
      if (sending.current === attempt) attempt.busy = false
      setBusy(false)
      void load()
    }
  }

  return {
    roots, replies: replies?.root?.id === threadId ? replies : null, threadId, rootBefore, replyBefore,
    setRootBefore, setReplyBefore, openThread, busy, reachable, readError, writeError, load, write,
  }
}
