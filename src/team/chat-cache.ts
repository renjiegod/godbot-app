// In-memory LRU cache of the latest page per chat (`<computer>:<kind>:<id>`), so
// returning to a Bot or group shows its messages on the first frame while a fresh
// read brings anything new. Each write carries the key that loaded the page so an
// in-place route param switch can never overwrite the next chat's cache with the
// previous chat's items.
export interface CachedChatEntry<P, I> {
  page: P
  older: I[]
  cursor: unknown
}

// A result on a later history page can refer to a call already on screen.
// Its latest fields belong at the call's first position.
export function joinChatItems<I extends { timelineId?: string }>(older: I[], latest: I[]): I[] {
  if (!older.length) return latest
  const joined: I[] = []
  const positions = new Map<string, number>()
  for (const row of [...older, ...latest]) {
    const key = row.timelineId
    const at = key === undefined ? undefined : positions.get(key)
    if (at !== undefined) joined[at] = row
    else {
      if (key !== undefined) positions.set(key, joined.length)
      joined.push(row)
    }
  }
  return joined
}

export function createChatCache<P, I>(limit = 16) {
  const map = new Map<string, CachedChatEntry<P, I>>()
  return {
    get: (key: string) => map.get(key),
    has: (key: string) => map.has(key),
    keep(chatKey: string, ownerKey: string, entry: CachedChatEntry<P, I>) {
      if (chatKey === '' || ownerKey !== chatKey) return false
      map.delete(chatKey)
      map.set(chatKey, entry)
      if (map.size > limit) map.delete(map.keys().next().value as string)
      return true
    },
    size: () => map.size,
    clear: () => map.clear(),
  }
}
