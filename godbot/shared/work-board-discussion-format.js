import { lexer } from 'marked'
import { mentionSpans } from './mentions.js'

export const commentLength = 8000
export const commentFileLimit = 2 * 1024 * 1024
export const commentFileCount = 5
export const commentReactions = ['👍', '❤️', '🎉', '👀', '✅', '🙏']

// Scan only visible Markdown text. Code, links, URL labels and images are inert.
function visibleText(tokens, visit) {
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        if (token.tokens) visibleText(token.tokens, visit)
        else if (!token.escaped) visit(token.raw)
        break
      case 'blockquote':
      case 'paragraph':
      case 'heading':
      case 'em':
      case 'strong':
      case 'del':
        visibleText(token.tokens ?? [], visit)
        break
      case 'list':
        for (const item of token.items) visibleText(item.tokens, visit)
        break
      case 'table':
        for (const cell of [...token.header, ...token.rows.flat()]) visibleText(cell.tokens, visit)
        break
    }
  }
}

export function commentMentions(text, bots) {
  const ids = new Set()
  let addressed = false
  let unmatched = false
  visibleText(lexer(text), (line) => {
    const spans = mentionSpans(line, bots).filter(span =>
      !/^[\p{L}\p{N}_-]/u.test(line.slice(span.end)) && !['\\', '@'].includes(line[span.start - 1]))
    for (const span of spans) {
      addressed = true
      if (span.bot) ids.add(span.bot.id)
    }
    for (const match of line.matchAll(/(?<![\w./\\@])@([\p{L}\p{N}_-]+)/gu)) {
      const name = match[1].toLowerCase()
      if (/^[\\/]/.test(line.slice(match.index + match[0].length))) continue
      if (spans.some(span => span.start === match.index)) continue
      addressed = true
      if (!['you', 'user', '我', '用户'].includes(name)) unmatched = true
    }
  })
  return { ids: [...ids], addressed, unmatched }
}

// Explicit addresses win. A human-only reply never falls back to the assignee.
/** @param {string} text
 * @param {{id: string, name: string}[]} bots
 * @param {{parent?: {botId?: string|null, deleted?: boolean}|null, root?: {continuation?: string|null}|null, assignee?: string|null, quiet?: boolean, editing?: boolean}} [options]
 */
export function commentPlan(text, bots, { parent, root, assignee, quiet, editing = false } = {}) {
  const mentions = commentMentions(text, bots)
  const continuation = editing ? null : parent
    ? parent.deleted ? null : parent.botId || root?.continuation
    : assignee
  const implicit = !mentions.addressed && bots.some(bot => bot.id === continuation) ? continuation : null
  const ids = quiet ? [] : mentions.addressed ? mentions.ids : implicit ? [implicit] : []
  return { ids, mentions: mentions.ids, unmatched: mentions.unmatched }
}

export function commentAddress(text, cursor, bots) {
  const match = /(?:^|[^\w./\\@])@([^@\n,，。;；!?！？()[\]<>]*?)$/u.exec(text.slice(0, cursor))
  if (!match || /\s$/.test(match[1])) return null
  const query = match[1].toLowerCase()
  const options = bots.filter(bot => bot.name.toLowerCase().includes(query)).slice(0, 8)
  return options.length ? { start: cursor - match[1].length - 1, end: cursor, options } : null
}

export function chooseCommentAddress(text, range, bot) {
  const token = '@' + bot.name + ' '
  return {
    body: text.slice(0, range.start) + token + text.slice(range.end),
    cursor: range.start + token.length,
  }
}

export const commentRunLabels = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Delivered',
  running: 'Working',
  waiting: 'Waiting for a report',
  answered: 'Replied',
  unavailable: 'Bot unavailable',
  terminal: 'Native terminal in use',
  failed: 'Failed',
  stopped: 'Stopped',
  unknown: 'Receipt needs checking',
  cancelled: 'Cancelled',
}

export const commentLink = (id, comment) => '#/godbot/work/' + id + '/comment/' + comment
