// Godbot: the notice cursor per computer, kept on the phone. When Android kills the process
// and the keep-alive brings it back, the link manager resumes from here and the computer
// replays the notices that went out in between (link-manager.ts).
type Saved = { boot: string | null; seq: number }

const KEY = 'godbot.noticeCursor'
let cache: Record<string, Saved> | null = null
let writing: Promise<void> = Promise.resolve()

const secureStore = () => import('expo-secure-store')

async function all(): Promise<Record<string, Saved>> {
  if (cache !== null) return cache
  let entries: Record<string, Saved> = {}
  try {
    const text = await (await secureStore()).getItemAsync(KEY)
    const value: unknown = text === null ? {} : JSON.parse(text)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) entries = value as Record<string, Saved>
  } catch { /* unreadable: start over */ }
  cache ??= entries
  return cache
}

export async function loadNoticeCursor(host: string): Promise<Saved | null> {
  const saved = (await all())[host]
  return typeof saved?.boot === 'string' && typeof saved.seq === 'number' ? { boot: saved.boot, seq: saved.seq } : null
}

export function saveNoticeCursor(host: string, cursor: Saved): void {
  writing = writing.then(async () => {
    const entries = await all()
    const prev = entries[host]
    if (prev !== undefined && prev.boot === cursor.boot && prev.seq === cursor.seq) return
    entries[host] = { boot: cursor.boot, seq: cursor.seq }
    await (await secureStore()).setItemAsync(KEY, JSON.stringify(entries))
  }).catch(() => {})
}
