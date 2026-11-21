// A model provider's API key as `providers` describes it, read the way Godbot's own
// Models page reads it (src/client/team-ui/providers-page.js):
//   null                                  the route names no key here (a custom route added
//                                         without one): no badge, no key field, no hint
//   { configured: false, writable: true } it asks for a key, which can be typed here
//   { configured: true,  writable: true } a key Godbot keeps; it can be replaced or removed
//   { writable: false }                   the key comes from outside Godbot (an environment
//                                         variable): it cannot be changed here
export interface ProviderKey { configured?: boolean; writable?: boolean }
export type KeyState = 'missing' | 'set' | 'outside'

export function keyState(key: ProviderKey | null | undefined): KeyState | null {
  if (key === null || key === undefined) return null
  if (key.configured !== true) return 'missing'
  return key.writable ? 'set' : 'outside'
}

/** Whether the key field is offered (to type a key, replace it or remove it). */
export const keyEditable = (key: ProviderKey | null | undefined): boolean => key?.writable === true

/** Whether to say the key is set outside Godbot and cannot be changed here. */
export const keyOutside = (key: ProviderKey | null | undefined): boolean => key !== null && key !== undefined && !key.writable
