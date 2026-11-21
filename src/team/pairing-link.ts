// Godbot: pairing links. Godbot computers from this version on show `godbot://pair?…`;
// older ones show the DS Bot scheme `dsbot://pair?…`, which the app still accepts.
import { parsePairingUri, type PairingOffer } from '../../godbot/link/index.ts'

export const PAIRING_PREFIXES = ['godbot://pair', 'dsbot://pair']

/** Whether a URL that opened the app is a pairing link. */
export function isPairingLink(url: unknown): url is string {
  return typeof url === 'string' && PAIRING_PREFIXES.some(prefix => url.startsWith(prefix))
}

/** What the confirmation shows before anything is sent: the computer and its Server. */
export interface PairingPreview { offer: PairingOffer; server: string; name: string }

export function previewPairing(uri: string): PairingPreview {
  const offer = parsePairingUri(uri.trim())
  return { offer, server: serverLabel(offer.server), name: offer.name }
}

/** The relay address as a person reads it: host and port, and whether it is encrypted. */
export function serverLabel(server: string): string {
  const match = /^(wss?):\/\/([^/?#]+)/i.exec(server)
  if (match === null) return server
  return match[1].toLowerCase() === 'wss' ? match[2] : `${match[2]} (ws)`
}
