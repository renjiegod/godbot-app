// Godbot: one push key per computer. The phone makes it, keeps it here and gives it to
// that computer over the encrypted link (RPC `push.key`); the computer seals its push
// notifications with it, so the relay and FCM only carry ciphertext.
import * as SecureStore from 'expo-secure-store'
import { generatePushKey, isPushKey } from '../../godbot/link/push.ts'

const KEY = 'godbot.pushKeys'
const LOCAL = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }

let cache: Record<string, string> | null = null

async function readAll(): Promise<Record<string, string>> {
  if (cache !== null) return cache
  const text = await SecureStore.getItemAsync(KEY, LOCAL)
  let saved: unknown
  try { saved = text === null ? {} : JSON.parse(text) } catch { saved = {} }
  const keys: Record<string, string> = {}
  if (saved !== null && typeof saved === 'object') {
    for (const [host, key] of Object.entries(saved as Record<string, unknown>)) if (isPushKey(key)) keys[host] = key
  }
  cache = keys
  return keys
}

async function writeAll(keys: Record<string, string>): Promise<void> {
  cache = keys
  await SecureStore.setItemAsync(KEY, JSON.stringify(keys), LOCAL)
}

/** Every computer's push key, by its device id. */
export async function pushKeys(): Promise<Record<string, string>> {
  return { ...(await readAll()) }
}

/** This computer's push key, made on first use. */
export async function ensurePushKey(hostDeviceId: string): Promise<string> {
  const keys = await readAll()
  const known = keys[hostDeviceId]
  if (known !== undefined) return known
  const key = generatePushKey()
  await writeAll({ ...keys, [hostDeviceId]: key })
  return key
}

/** Forgetting a computer forgets its key: its pushes can no longer be opened here. */
export async function forgetPushKey(hostDeviceId: string): Promise<void> {
  const keys = await readAll()
  if (!Object.hasOwn(keys, hostDeviceId)) return
  const { [hostDeviceId]: _gone, ...rest } = keys
  await writeAll(rest)
}
