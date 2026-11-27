// The desktop's model options (dsh-godbot src/client/team-ui/model-options.js) without
// the drawing: which options a model shows, the speed a Bot runs at, and how many
// bolts it gets. The computer describes the options the same way for every agent.
import type { ModelOption } from '../connection.ts'

export type Picks = Record<string, string | boolean> | undefined

// Thinking levels by their usual ids; the caller translates the English name.
export const EFFORT_NAMES: Record<string, string> = { none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' }
export const SPEED_NAMES: Record<string, string> = { standard: 'Standard', fast: 'Fast', ultrafast: 'Ultrafast' }

// Options worth a control: a toggle, or a choice of two values or more. Speed first.
export function shownOptions(options: ModelOption[] | undefined): ModelOption[] {
  const list = (options ?? []).filter(option => option.type === 'toggle' || (option.values?.length ?? 0) >= 2)
  return [...list.filter(option => option.id === 'speed'), ...list.filter(option => option.id !== 'speed')]
}

// How many bolts a value of a choice shows: none for the first (standard) tier, one
// for the next, two for any faster.
export function boltsOf(option: ModelOption, valueId: string | undefined): number {
  return Math.min(2, Math.max(0, (option.values ?? []).findIndex(value => value.id === valueId)))
}

// The speed a Bot runs at: its pick when the model offers it, else the agent's own
// default. Undefined for a model with one speed.
export function speedOf(options: ModelOption[] | undefined, picks: Picks): { option: ModelOption; valueId: string; picked: boolean; bolts: number } | undefined {
  const option = (options ?? []).find(entry => entry.id === 'speed' && entry.type === 'select')
  const values = option?.values ?? []
  if (option === undefined || values.length < 2) return undefined
  const picked = values.find(value => value.id === picks?.speed)
  const value = picked ?? values.find(entry => entry.id === option.defaultValue) ?? values[0]
  return { option, valueId: value.id, picked: picked !== undefined, bolts: boltsOf(option, value.id) }
}

// What a control shows for one option: the Bot's pick when it is one the model offers,
// else the agent's default (undefined when the agent names none).
export function shownValue(option: ModelOption, picks: Picks): { value: string | boolean | undefined; picked: boolean } {
  const pick = picks?.[option.id]
  if (option.type === 'toggle') return typeof pick === 'boolean' ? { value: pick, picked: true } : { value: option.defaultValue === true, picked: false }
  const offered = (option.values ?? []).some(value => value.id === pick)
  return offered ? { value: pick, picked: true } : { value: option.defaultValue, picked: false }
}
