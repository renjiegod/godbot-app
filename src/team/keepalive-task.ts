// Godbot: how the keep-alive service reaches JavaScript, with or without screens.
// - Each time the service starts (the switch, a reboot, an app update, Android restarting the
//   killed process) it runs the headless task below, which holds the link to the active
//   computer. The task returns at once, so it (and the wake lock Android holds for it) ends
//   while the link stays up in this process.
// - While the service runs it sends a beat about every 30 s, and one when the network comes
//   back or the screen turns on. JS timers do not run in the background, so linkManager.tick()
//   retries or drops a dead link by the clock.
// - A notice that arrives while the app is not on screen becomes a system notification.
// It must run when the bundle loads, also for a headless start, so index.ts imports it first.
import { AppRegistry } from 'react-native'
import { GodbotNative } from '../../modules/godbot-native/index.ts'
import { readPrefs } from '../store.ts'
import { setLang, t } from '../ui/i18n.ts'
import { holdKeepAliveLink } from './keepalive.ts'
import { linkManager } from './link.ts'
import type { TickReason } from './link-manager.ts'
import { showLocal } from './notify.ts'
import { noticeContent } from './push-payload.ts'

export const KEEP_ALIVE_TASK = 'GodbotKeepAlive'
const REASONS = new Set<string>(['beat', 'start', 'network', 'screen'])

linkManager.setNotifier((notice, host) => {
  const content = noticeContent((notice ?? {}) as Record<string, unknown>, { finished: t('Finished'), newReply: t('New reply'), approval: t('Approval needed'), question: t('Has a question') })
  if (content === null) return
  void showLocal({ ...content, data: { ...content.data, host } }).catch(() => {})
})

async function start(reason: TickReason): Promise<void> {
  // With no screen up, nothing has applied the language setting yet.
  const prefs = await readPrefs()
  setLang(prefs.lang === 'zh' || prefs.lang === 'en' ? prefs.lang : 'system')
  if (await holdKeepAliveLink()) linkManager.tick(reason)
}

AppRegistry.registerHeadlessTask(KEEP_ALIVE_TASK, () => async () => { await start('start').catch(() => {}) })

GodbotNative?.addListener('onKeepAliveTick', (event: { reason?: string }) => {
  const reason = (REASONS.has(event?.reason ?? '') ? event.reason : 'beat') as TickReason
  if (linkManager.keepsAlive()) linkManager.tick(reason)
  else void start(reason).catch(() => {})
})
