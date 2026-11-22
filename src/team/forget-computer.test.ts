import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, before, test } from 'node:test'

// store.ts and push-keys.ts keep everything in expo-secure-store; here it is a Map.
const disk = new Map<string, string>()
let hooks: ReturnType<typeof registerHooks> | undefined
let store: typeof import('../store.ts')
let keys: typeof import('./push-keys.ts')

before(async () => {
  ;(globalThis as any).__secureDisk = disk
  hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'expo-secure-store') return { url: 'mock:expo-secure-store', shortCircuit: true }
      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (url === 'mock:expo-secure-store') {
        return {
          format: 'module',
          shortCircuit: true,
          source: `
            const disk = globalThis.__secureDisk
            export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'local'
            export const getItemAsync = async (key) => disk.get(key) ?? null
            export const setItemAsync = async (key, value) => { disk.set(key, value) }
            export const deleteItemAsync = async (key) => { disk.delete(key) }
          `,
        }
      }
      return nextLoad(url, context)
    },
  })
  store = await import('../store.ts')
  keys = await import('./push-keys.ts')
})

after(() => {
  hooks?.deregister()
  delete (globalThis as any).__secureDisk
})

const offer = (hostDeviceId: string, name: string) => ({ server: 'wss://relay.example.org/v1/link', hostDeviceId, hostKey: `${hostDeviceId}-key`, code: 'c', name })

test('forgetting a computer forgets its push key and keeps the others', async () => {
  await store.addComputer(offer('d-host-a', 'Studio'))
  await store.addComputer(offer('d-host-b', 'Laptop'))
  const keyA = await keys.ensurePushKey('d-host-a')
  const keyB = await keys.ensurePushKey('d-host-b')
  assert.notEqual(keyA, keyB)
  assert.deepEqual(Object.keys(await keys.pushKeys()).sort(), ['d-host-a', 'd-host-b'])

  const left = await store.removeComputer('d-host-a')
  assert.deepEqual(left.map(item => item.hostDeviceId), ['d-host-b'])
  assert.deepEqual(await keys.pushKeys(), { 'd-host-b': keyB })
  // What is on disk agrees, not only the in-memory cache.
  assert.deepEqual(Object.keys(JSON.parse(disk.get('godbot.pushKeys') ?? '{}')), ['d-host-b'])
  // Pairing again with the same computer later makes a new key.
  const again = await keys.ensurePushKey('d-host-a')
  assert.notEqual(again, keyA)
})

test('machine enrollment preserves the active team and excludes the one-use offer code', async () => {
  const team = await store.addComputer(offer('d-team', 'Test team'))
  const machineOffer = { ...offer('d-machine', 'Headless server'), code: 'ephemeral-machine-offer' }
  const hello = { version: 1 as const, kind: 'computer' as const, name: machineOffer.name, os: 'Linux',
    account: 'test', terminal: true, desktop: false, control: false }
  const machine = await store.rememberMachine(machineOffer, hello)
  assert.equal((await store.loadComputer())?.hostDeviceId, team.hostDeviceId)
  assert.equal((await store.listMachines())[0].hostDeviceId, machine.hostDeviceId)
  assert.ok(![...disk.values()].some(value => value.includes(machineOffer.code)))
  await store.forgetMachine(machine.hostDeviceId)
  await store.markMachineConnected(machine.hostDeviceId, hello)
  assert.deepEqual(await store.listMachines(), [])
  assert.equal((await store.loadComputer())?.hostDeviceId, team.hostDeviceId)
})
