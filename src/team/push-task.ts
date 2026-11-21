// Godbot: FCM data messages run this task, also when the app is in the background or
// was swiped away (a headless start). It must be defined when the bundle loads, so
// index.ts imports this file first.
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { handlePushPayload } from './push-receive.ts'

export const PUSH_TASK = 'godbot-push'

TaskManager.defineTask<Notifications.NotificationTaskPayload>(PUSH_TASK, async ({ data, error }) => {
  if (error !== null && error !== undefined) return
  // A tap on a notification also lands here on Android; that is handled in the app.
  if (data !== null && typeof data === 'object' && 'actionIdentifier' in data) return
  await handlePushPayload(data).catch(() => false)
})

void Notifications.registerTaskAsync(PUSH_TASK).catch(() => {})
