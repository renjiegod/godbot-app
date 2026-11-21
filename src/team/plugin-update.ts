// Godbot: the computer's plugin update, as Godbot's update-check reports it
// (dsh-godbot src/host/team-runtime/core/update.js `view()`). Godbot adds an update mode,
// a download phase, a "ready" phase, progress, blockers and the reasons an automatic
// install waits.
import { t } from '../ui/i18n.ts'

export type UpdateMode = 'auto' | 'notify' | 'off'
export const UPDATE_MODES: UpdateMode[] = ['auto', 'notify', 'off']

export interface PluginUpdate {
  name?: string
  current?: string
  latest?: string | null
  source?: string
  enabled?: boolean
  mode?: UpdateMode
  checkedAt?: number
  checkFailed?: boolean
  phase?: string
  installed?: string | null
  error?: string | null
  progress?: { done: number; total: number | null }
  blocked?: { reason?: string; dsh?: string; peers?: string[]; found?: string }
  waiting?: { kind: string; count?: number }[]
  available?: boolean
  notes?: string
}

export function blockedText(update: PluginUpdate): string | null {
  const blocked = update.blocked
  if (blocked === undefined) return null
  const version = update.latest ?? ''
  if (blocked.reason === 'dsh') return t('Godbot {version} needs DSH {dsh}.', { version, dsh: blocked.dsh ?? '' })
  if (blocked.reason === 'peers') return t('Godbot {version} needs {peers}. Run scripts/install-local.mjs again on the computer.', { version, peers: (blocked.peers ?? []).join(', ') })
  return t('The release archive holds {found}.', { found: blocked.found ?? '' })
}

export function waitingText(update: PluginUpdate): string | null {
  if (update.waiting === undefined || update.waiting.length === 0) return null
  const turns = update.waiting.find(reason => reason.kind === 'turns')
  if (turns !== undefined) return t('Installs when no Bot is working ({count} running).', { count: turns.count ?? 1 })
  if (update.waiting.some(reason => reason.kind === 'idle')) return t('Installs after the computer has been idle for two minutes.')
  return null
}

export function pluginUpdateText(update: PluginUpdate | null): string {
  if (update === null) return '—'
  const version = update.installed ?? update.latest ?? ''
  switch (update.phase) {
    case 'downloading': {
      const { done = 0, total = null } = update.progress ?? {}
      return total !== null && total > 0
        ? t('Downloading Godbot {version}… {percent}%', { version: update.latest ?? '', percent: Math.min(100, Math.floor(done / total * 100)) })
        : t('Downloading Godbot {version}…', { version: update.latest ?? '' })
    }
    case 'ready': return t('Godbot {version} is downloaded and ready to install.', { version: update.latest ?? '' })
    case 'installing': return t('Updating Godbot…')
    case 'installed': return t('Restart DSH to start using Godbot {version}.', { version })
    case 'updated': return t('Godbot {version} is installed.', { version })
    case 'failed': return t('The update did not finish: {reason}', { reason: update.error ?? '' })
  }
  const blocked = blockedText(update)
  if (blocked !== null) return blocked
  if (update.available) return t('Godbot {version} is available', { version: update.latest ?? '' })
  if (update.source === 'app') return t('Updates come with the Godbot app.')
  if (update.enabled === false || update.mode === 'off') return t('Update checks are off.')
  if (update.source === 'path') return t('Installed from a local folder; update it there.')
  if (update.checkFailed === true || update.latest === undefined || update.latest === null) return t('Could not check for updates.')
  return t('Up to date')
}

/** Whether the page offers Install: a newer release, or one already downloaded. */
export const canInstall = (update: PluginUpdate | null): boolean =>
  update !== null && update.blocked === undefined && update.phase !== 'installing' && (update.available === true || update.phase === 'ready')
