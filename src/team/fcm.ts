// Godbot: this phone's FCM registration token, when the build has Firebase.
// Without a google-services.json (or Google Play services) there is none, and the
// computer cannot push to this phone; the rest of the app is unaffected.
import * as Notifications from 'expo-notifications'

let pending: Promise<string | null> | null = null
let missingAt = 0
const RETRY_MISSING_MS = 10 * 60_000

export function fcmToken(): Promise<string | null> {
  if (pending !== null) return pending
  if (missingAt !== 0 && Date.now() - missingAt < RETRY_MISSING_MS) return Promise.resolve(null)
  pending = Notifications.getDevicePushTokenAsync()
    .then(token => (token.type === 'android' && typeof token.data === 'string' && token.data !== '' ? token.data : null))
    .catch(() => null)
    .then((token) => {
      pending = null
      missingAt = token === null ? Date.now() : 0
      if (token !== null) pending = Promise.resolve(token)
      return token
    })
  return pending
}
