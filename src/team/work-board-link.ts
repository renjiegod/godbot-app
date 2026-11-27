const route = /^godbot:\/\/work\/(GB-[1-9]\d{0,14})\/comment\/([a-f0-9-]{36})\?host=([A-Za-z0-9_-]{1,160})$/

export function makeBoardCommentLink(id: string, comment: string, host: string) {
  return 'godbot://work/' + id + '/comment/' + comment + '?host=' + encodeURIComponent(host)
}

export function parseBoardCommentLink(url?: string | null) {
  const match = typeof url === 'string' ? route.exec(url) : null
  return match ? { id: match[1], comment: match[2], host: match[3] } : null
}

export function makeBoardViewLink(viewId: string, host: string) {
  return 'godbot://work/view/' + viewId + '?host=' + encodeURIComponent(host)
}

export function parseBoardViewLink(url?: string | null) {
  const match = typeof url === 'string' ? /^godbot:\/\/work\/view\/([a-f0-9-]{36})\?host=([A-Za-z0-9_-]{1,160})$/.exec(url) : null
  return match ? { viewId: match[1], host: match[2] } : null
}

export function boardCommentTarget(data: unknown) {
  const item = data as { workItemId?: unknown; commentId?: unknown } | null
  return item && typeof item.workItemId === 'string' && /^GB-[1-9]\d{0,14}$/.test(item.workItemId)
    && typeof item.commentId === 'string' && /^[a-f0-9-]{36}$/.test(item.commentId)
    ? { id: item.workItemId, comment: item.commentId } : null
}
