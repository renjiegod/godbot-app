import { t } from '../ui/i18n.ts'
import type { Palette } from '../ui/tokens.ts'
import { markNames, phaseNames } from '../../godbot/shared/work-board.js'

export const layoutShortLabels: Record<string, string> = {
  board: 'Board',
  list: 'List',
  table: 'Table',
  swimlane: 'Swimlane',
  gantt: 'Timeline',
}

/** Convert #hex or rgb(...) theme token into translucent rgba(...) for soft semantic pills. */
export function tint(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (hex) {
    const raw = hex[1].length === 3
      ? hex[1].split('').map(c => c + c).join('')
      : hex[1]
    const r = parseInt(raw.slice(0, 2), 16)
    const g = parseInt(raw.slice(2, 4), 16)
    const b = parseInt(raw.slice(4, 6), 16)
    return `rgba(${r},${g},${b},${alpha})`
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color.trim())
  if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})`
  return `rgba(128,128,128,${alpha})`
}

export function phaseTone(phase: string, p: Pick<Palette, 'accent' | 'danger' | 'star' | 'green' | 'ink2' | 'ink3'>): string {
  switch (phase) {
    case 'doing': return p.accent
    case 'attention': return p.danger
    case 'review': return p.star
    case 'done': return p.green
    case 'history': return p.ink3
    default: return p.ink2
  }
}

export function statusText(item: { statusId?: string; mark?: string; phase?: string }, catalog?: { statuses: { id: string; name: string }[] }): string {
  const custom = catalog?.statuses.find(s => s.id === item.statusId)?.name
  if (custom) return custom
  return t((markNames as Record<string, string>)[item.mark ?? ''] ?? (phaseNames as Record<string, string>)[item.phase ?? ''] ?? item.mark ?? 'Unknown')
}
