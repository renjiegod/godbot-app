// Godbot: an end-to-end encrypted push from a computer, opened on the phone.
// The background task (push-task.ts) and the debug entry in About both come through here.
import { encryptPush, generatePushKey } from '../../godbot/link/push.ts'
import { t } from '../ui/i18n.ts'
import { showLocal } from './notify.ts'
import { pushKeys } from './push-keys.ts'
import { openPush, pushContent, pushFields } from './push-payload.ts'

/**
 * Opens an FCM data payload and shows it. `keys` replaces the stored push keys (the debug
 * entry uses a throwaway key). Resolves false when the payload is not a Godbot push or no
 * stored key opens it.
 */
export async function handlePushPayload(payload: unknown, keys?: Record<string, string>): Promise<boolean> {
  const fields = pushFields(payload)
  if (fields === null) return false
  const known = keys ?? await pushKeys()
  const note = openPush(fields, host => known[host])
  if (note === null) return false
  await showLocal(pushContent(note, fields.h))
  return true
}

// A device id that no computer has: the throwaway key below seals the sample for it.
const DEBUG_HOST = 'd-godbot-debug-push-00'

/** Seals a sample notice exactly as a computer would and sends it through the handler. */
export async function debugPush(): Promise<boolean> {
  const key = generatePushKey()
  const c = encryptPush(key, DEBUG_HOST, {
    v: 1, kind: 'approval', title: t('Godbot test notification'),
    body: t('Sealed and opened like a push from your computer.'), time: Date.now(),
  })
  return handlePushPayload({ notification: null, data: { v: '1', h: DEBUG_HOST, c } }, { [DEBUG_HOST]: key })
}
