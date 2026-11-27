import assert from 'node:assert/strict'
import test from 'node:test'
import { encryptPush, generatePushKey } from '../../godbot/link/push.ts'
import { boardCommentTarget, makeBoardCommentLink, parseBoardCommentLink } from './work-board-link.ts'
import { channelFor, noticeContent, openPush, pushContent, pushFields, targetOf } from './push-payload.ts'

const HOST = 'd-MAyclgO5Kks57TlYv5JAEQ'
const note = { v: 1 as const, kind: 'approval', title: 'GodBot', body: 'Run `rm -rf build`?', botId: 'b1', sessionId: 's1', seq: 7, time: 1_700_000_000_000 }

test('an FCM data message arrives as fields or as one JSON string', () => {
  const c = encryptPush(generatePushKey(), HOST, note)
  assert.deepEqual(pushFields({ notification: null, data: { v: '1', h: HOST, c } }), { h: HOST, c })
  assert.deepEqual(pushFields({ notification: null, data: { dataString: JSON.stringify({ v: '1', h: HOST, c }) } }), { h: HOST, c })
  assert.deepEqual(pushFields({ v: '1', h: HOST, c }), { h: HOST, c })
  assert.equal(pushFields({ data: { v: '2', h: HOST, c } }), null)
  assert.equal(pushFields({ data: { dataString: '{not json' } }), null)
  assert.equal(pushFields(null), null)
  assert.equal(pushFields({ notification: null, data: { title: 'someone else\'s push' } }), null)
})

test('a push opens only with its computer\'s key and for that computer', () => {
  const key = generatePushKey()
  const c = encryptPush(key, HOST, note)
  assert.deepEqual(openPush({ h: HOST, c }, host => (host === HOST ? key : undefined)), note)
  // No key for this computer: forgotten, or never paired.
  assert.equal(openPush({ h: HOST, c }, () => undefined), null)
  // Another key, or the sealed notice relabelled as coming from another computer.
  assert.equal(openPush({ h: HOST, c }, () => generatePushKey()), null)
  assert.equal(openPush({ h: 'd-Zmh6rfhivXdsj8GLjp-OIA', c }, () => key), null)
  // A tampered ciphertext.
  const flipped = c.slice(0, -2) + (c.endsWith('A') ? 'BA' : 'AA')
  assert.equal(openPush({ h: HOST, c: flipped }, () => key), null)
})

test('what waits for the person rings; Bot news is quieter', () => {
  assert.equal(channelFor('approval'), 'needs-you')
  assert.equal(channelFor('question'), 'needs-you')
  assert.equal(channelFor('view'), 'needs-you')
  assert.equal(channelFor('message'), 'messages')
  assert.equal(channelFor('done'), 'messages')
  assert.deepEqual(pushContent(note, HOST), {
    title: 'GodBot', body: 'Run `rm -rf build`?', channelId: 'needs-you',
    data: { kind: 'approval', host: HOST, botId: 'b1', sessionId: 's1' },
  })
})

test('a live notice becomes a notification text, and its tap target', () => {
  const words = { finished: 'Finished', newReply: 'New reply', approval: 'Approval needed', question: 'Has a question' }
  assert.deepEqual(noticeContent({ kind: 'approval', name: 'GodBot', text: 'shell', botId: 'b1', sessionId: 's1' }, words), {
    title: 'GodBot', body: 'Approval needed: shell', channelId: 'needs-you', data: { kind: 'approval', botId: 'b1', sessionId: 's1' },
  })
  assert.deepEqual(noticeContent({ kind: 'done', name: 'Coder', title: 'Release', roomId: 'r1', botId: 'b2' }, words), {
    title: 'Release', body: 'Finished', channelId: 'messages', data: { kind: 'done', botId: 'b2', roomId: 'r1' },
  })
  assert.equal(noticeContent({ kind: 'room' }, words), null)
  assert.deepEqual(targetOf({ roomId: 'r1', botId: 'b2' }), { kind: 'room', id: 'r1' })
  assert.deepEqual(targetOf({ botId: 'b2' }), { kind: 'bot', id: 'b2' })
  assert.equal(targetOf({}), null)
})

test('a board reply keeps the card and comment together in live and encrypted notices', () => {
  const workItemId = 'GB-71'
  const commentId = '96ab32d0-d71f-4f3d-9c5c-c4457d02c6dc'
  const reply = { ...note, kind: 'message', workItemId, commentId }
  const key = generatePushKey()
  const opened = openPush({ h: HOST, c: encryptPush(key, HOST, reply) }, () => key)
  assert.ok(opened)
  const fromPush = pushContent(opened, HOST)
  assert.deepEqual(boardCommentTarget(fromPush.data), { id: workItemId, comment: commentId })
  const fromLive = noticeContent({ ...reply, text: reply.body }, {
    finished: 'Finished', approval: 'Approval needed', question: 'Has a question', newReply: 'New reply',
  })
  assert.deepEqual(boardCommentTarget(fromLive?.data), { id: workItemId, comment: commentId })
  const link = makeBoardCommentLink(workItemId, commentId, HOST)
  assert.deepEqual(parseBoardCommentLink(link), { id: workItemId, comment: commentId, host: HOST })
  assert.equal(parseBoardCommentLink(link + '&host=another'), null)
  assert.equal(boardCommentTarget({ workItemId, commentId: 'unrelated' }), null)
})
