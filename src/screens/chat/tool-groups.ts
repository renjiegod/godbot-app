import type { ChatItem } from './items.tsx'

export interface ItemRow { item: ChatItem; key: string; stamp?: string }
export interface ToolGroupRow { tools: ItemRow[]; key: string }
export type ChatRow = ItemRow | ToolGroupRow

export function groupToolRows(rows: ItemRow[]): ChatRow[] {
  const grouped: ChatRow[] = []
  for (let start = 0; start < rows.length;) {
    const first = rows[start]
    const { kind, sessionId, turn } = first.item
    let end = start + 1
    if (kind === 'tool' && turn !== undefined) {
      while (end < rows.length) {
        const next = rows[end].item
        if (next.kind !== 'tool' || next.sessionId !== sessionId || next.turn !== turn) break
        end++
      }
    }
    grouped.push(end === start + 1 ? first : { key: `tools:${first.key}`, tools: rows.slice(start, end) })
    start = end
  }
  return grouped
}
