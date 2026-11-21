// Godbot: notifications the phone shows itself. Three Android channels, so the person can
// silence Bot chatter and still hear what waits for them:
//   needs-you   approvals, questions and cards (high importance)
//   messages    Bot replies and finished group work
//   connection  the ongoing notification of "Keep connected in background" (low)
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { t } from '../ui/i18n.ts'
import type { LocalNotice } from './push-payload.ts'

let channels: Promise<void> | null = null

export function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve()
  channels ??= Promise.all([
    Notifications.setNotificationChannelAsync('needs-you', {
      name: t('Needs you'), importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 120, 200],
    }),
    Notifications.setNotificationChannelAsync('messages', {
      name: t('Bot messages'), importance: Notifications.AndroidImportance.DEFAULT,
    }),
    Notifications.setNotificationChannelAsync('connection', {
      name: t('Connection status'), importance: Notifications.AndroidImportance.LOW, showBadge: false, enableVibrate: false,
    }),
  ]).then(() => undefined, (error: unknown) => { channels = null; throw error })
  return channels
}

// A notification posted while the app is open still shows as a heads-up banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
})

export async function showLocal(notice: LocalNotice): Promise<string> {
  await ensureChannels()
  return Notifications.scheduleNotificationAsync({
    content: { title: notice.title, body: notice.body, data: notice.data },
    trigger: { channelId: notice.channelId },
  })
}
