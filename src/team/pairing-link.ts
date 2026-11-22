// Godbot: pairing links. Godbot computers from this version on show `godbot://pair?…`;
// older ones show the DS Bot scheme `dsbot://pair?…`, which the app still accepts.
import { parseMachinePairingUri, parsePairingUri, type PairingOffer } from '../../godbot/link/index.ts'

export const PAIRING_PREFIXES = ['godbot://pair?', 'dsbot://pair?', 'godbot://computer-pair?']

/** Whether a URL that opened the app is a pairing link. */
export function isPairingLink(url: unknown): url is string {
  return typeof url === 'string' && PAIRING_PREFIXES.some(prefix => url.startsWith(prefix))
}

/** What the confirmation shows before anything is sent: the computer and its Server. */
export interface PairingPreview { offer: PairingOffer; kind: 'machine' | 'team'; server: string; name: string }

export function previewPairing(uri: string, machineOnly = false): PairingPreview {
  const text = uri.trim()
  const machine = text.startsWith('godbot://computer-pair?')
  const offer = machine ? parseMachinePairingUri(text) : parsePairingUri(text)
  if (machineOnly && !machine) {
    throw new Error('This code pairs a Godbot team. Create a pairing offer in Godbot Computer Host to pair a remote computer.')
  }
  return { offer, kind: machine ? 'machine' : 'team', server: serverLabel(offer.server), name: offer.name }
}

/** The relay address as a person reads it: host and port, and whether it is encrypted. */
export function serverLabel(server: string): string {
  const match = /^(wss?):\/\/([^/?#]+)/i.exec(server)
  if (match === null) return server
  return match[1].toLowerCase() === 'wss' ? match[2] : `${match[2]} (ws)`
}
