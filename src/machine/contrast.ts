import { luminance } from '../../godbot/client/team-ui/inks.js'
import type { Palette } from '../ui/tokens.ts'

export function contrastRatio(first: string, second: string) {
  const a = luminance(first),
    b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

// Render an opaque tone so translucent parent surfaces cannot lower measured contrast.
function readableTone(surface: string, preferred: string, weight: number, minimum: number) {
  let ink = preferred
  if (contrastRatio(ink, surface) < minimum)
    ink = contrastRatio('#000000', surface) > contrastRatio('#ffffff', surface) ? '#000000' : '#ffffff'
  const mixed =
    '#' +
    [1, 3, 5]
      .map((i) => {
        const bg = parseInt(surface.slice(i, i + 2), 16)
        const fg = parseInt(ink.slice(i, i + 2), 16)
        return Math.round(bg + (fg - bg) * weight)
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  return contrastRatio(mixed, surface) >= minimum ? mixed : ink
}

export function machinePalette<T extends Pick<Palette, 'main' | 'card' | 'sidebar' | 'ink' | 'accent' | 'accentInk'>>(
  p: T,
) {
  return {
    ...p,
    ink: readableTone(p.main, p.ink, 1, 4.5),
    ink2: readableTone(p.main, p.ink, 0.76, 4.5),
    cardInk: readableTone(p.card, p.ink, 1, 4.5),
    cardSecondary: readableTone(p.card, p.ink, 0.76, 4.5),
    cardAccent: readableTone(p.card, p.accent, 1, 3),
    line2: readableTone(p.card, p.ink, 0.62, 3),
    padLine: readableTone(p.sidebar, p.ink, 0.62, 3),
    accentInk: readableTone(p.accent, p.accentInk, 1, 4.5),
  }
}
