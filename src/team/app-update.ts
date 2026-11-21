// Godbot: the phone app's own updates. The relay that a computer's QR code names also
// serves the app: /app/latest.json describes the newest APK and /download/ holds it
// (godbot-server docs/protocol.md §10). Pure functions; the download runs in app-update-run.ts.

export interface AppManifest {
  versionName: string
  versionCode: number
  /** Absolute after parseManifest: a relative url is resolved against the manifest. */
  url: string
  /** Lowercase hex SHA-256 of the APK. */
  sha256: string
  size: number
  notes?: string
}

const SERVER = /^(wss?):\/\/([^/?#\s]+)/i

/** http(s)://<relay host>/app/latest.json for a ws(s)://<relay host>/v1/link address. */
export function manifestUrl(server: string): string | null {
  const match = SERVER.exec(server.trim())
  if (match === null) return null
  const scheme = match[1].toLowerCase() === 'wss' ? 'https' : 'http'
  return `${scheme}://${match[2]}/app/latest.json`
}

function resolveUrl(url: string, base: string): string {
  if (/^https?:\/\//i.test(url)) return url
  const origin = /^(https?:\/\/[^/?#]+)/i.exec(base)?.[1]
  if (origin === undefined) throw new Error('The update address is invalid.')
  if (url.startsWith('/')) return `${origin}${url}`
  const dir = base.replace(/[?#].*$/, '').replace(/[^/]*$/, '')
  return `${dir}${url}`
}

/** Checks a downloaded manifest; throws a person-readable error when it is not one. */
export function parseManifest(value: unknown, base: string): AppManifest {
  const record = value as Partial<AppManifest> | null
  if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new Error('The update information is invalid.')
  const { versionName, versionCode, url, sha256, size, notes } = record
  if (typeof versionName !== 'string' || versionName === '' || versionName.length > 64) throw new Error('The update has no version name.')
  if (!Number.isSafeInteger(versionCode) || (versionCode as number) <= 0) throw new Error('The update has no version code.')
  if (typeof url !== 'string' || url === '' || url.length > 2048) throw new Error('The update has no download address.')
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) throw new Error('The update has no checksum.')
  if (!Number.isSafeInteger(size) || (size as number) <= 0) throw new Error('The update has no size.')
  const absolute = resolveUrl(url, base)
  if (!/^https?:\/\//i.test(absolute)) throw new Error('The update address is invalid.')
  return {
    versionName,
    versionCode: versionCode as number,
    url: absolute,
    sha256: sha256.toLowerCase(),
    size: size as number,
    ...(typeof notes === 'string' && notes !== '' ? { notes: notes.slice(0, 2000) } : {}),
  }
}

export const isNewer = (manifest: AppManifest, currentCode: number) => manifest.versionCode > currentCode
