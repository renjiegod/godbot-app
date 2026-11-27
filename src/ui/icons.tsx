import { createElement as h } from 'react'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { useTheme } from './tokens.ts'

// The same icons as ds-bot/src/client/icons.js, ported to react-native-svg:
// viewBox 0 0 20 20, stroke currentColor-equivalent (the `color` prop), round caps.
interface IconProps { size?: number; color?: string }
const use = (color: string | undefined, fallback: string) => color ?? fallback

export function ChevronLeftIcon({ size = 20, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: use(color, p.ink2), strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h(Path, { d: 'M12.5 4.5L7 10l5.5 5.5' }))
}
export function ChevronRightIcon({ size = 20, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: use(color, p.ink2), strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h(Path, { d: 'M7.5 4.5L13 10l-5.5 5.5' }))
}
export function SidebarIcon({ size = 20, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: use(color, p.ink2), strokeWidth: 1.6 },
    h(Rect, { x: 3, y: 4, width: 14, height: 12, rx: 2.5 }), h(Path, { d: 'M8 4v12' }))
}
export function FolderIcon({ size = 20, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: use(color, p.ink2), strokeWidth: 1.5, strokeLinejoin: 'round' },
    h(Path, { d: 'M2.5 6a2 2 0 0 1 2-2H8l2 2h5.5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z' }))
}
export function ClockIcon({ size = 20, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: use(color, p.ink2), strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h(Circle, { cx: 10, cy: 10, r: 7 }), h(Path, { d: 'M10 6v4l2.5 1.5' }))
}
export function SearchIcon({ size = 16, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20' },
    h(Circle, { cx: 8.5, cy: 8.5, r: 5.5, stroke: use(color, p.ink2), strokeWidth: 1.6, fill: 'none' }),
    h(Path, { d: 'M13 13l4 4', stroke: use(color, p.ink2), strokeWidth: 1.6, strokeLinecap: 'round' }))
}
export function PlusIcon({ size = 16, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20' },
    h(Path, { d: 'M10 4v12M4 10h12', stroke: use(color, p.ink2), strokeWidth: 1.6, strokeLinecap: 'round' }))
}
export function ArrowUpIcon({ size = 16, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20' },
    h(Path, { d: 'M10 16V4M5 9l5-5 5 5', stroke: use(color, p.accentInk), strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }))
}
export function ArrowDownIcon({ size = 16, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20' },
    h(Path, { d: 'M10 4v12M5 11l5 5 5-5', stroke: use(color, p.ink2), strokeWidth: 1.6, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }))
}
export function GearIcon({ size = 20, color }: IconProps) {
  const { p } = useTheme()
  const c = use(color, p.ink2)
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: c, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h(Path, { d: 'M10 7.4a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2z' }),
    h(Path, { d: 'M7.85 4.4l.29-1.87a7.7 7.7 0 0 1 3.72 0l.29 1.87a6 6 0 0 1 1.63.94l1.76-.69a7.7 7.7 0 0 1 1.86 3.23l-1.47 1.18a6 6 0 0 1 0 1.88l1.47 1.18a7.7 7.7 0 0 1-1.86 3.23l-1.76-.69a6 6 0 0 1-1.63.94l-.29 1.87a7.7 7.7 0 0 1-3.72 0l-.29-1.87a6 6 0 0 1-1.63-.94l-1.76.69a7.7 7.7 0 0 1-1.86-3.23l1.47-1.18a6 6 0 0 1 0-1.88L2.6 7.88a7.7 7.7 0 0 1 1.86-3.23l1.76.69a6 6 0 0 1 1.63-.94z' }))
}
export function PeopleIcon({ size = 20, color }: IconProps) {
  const { p } = useTheme()
  const c = use(color, p.ink2)
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: c, strokeWidth: 1.5, strokeLinecap: 'round' },
    h(Circle, { cx: 7.5, cy: 7, r: 3 }),
    h(Path, { d: 'M2 16.5c.6-2.8 2.8-4.5 5.5-4.5s4.9 1.7 5.5 4.5' }),
    h(Path, { d: 'M13 4.3a3 3 0 0 1 0 5.4M15 12.4c1.6.6 2.6 2 3 4.1' }))
}
export function UnreadIcon({ size = 20, color }: IconProps) {
  const { p } = useTheme()
  const c = use(color, p.ink2)
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: c, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h(Path, { d: 'M10 3.5a4.5 4.5 0 0 0-4.5 4.5v3L4 13.5h12L14.5 11V8' }),
    h(Path, { d: 'M8.3 16a1.8 1.8 0 0 0 3.4 0' }),
    h(Path, { d: 'M15.5 3.2a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z' }))
}
export function PinMarkIcon({ size = 12, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: use(color, p.ink3) },
    h(Path, { d: 'M8 2.5h4a.9.9 0 0 1 0 1.8h-.4v4.1c0 1.4 1.1 2.6 2.6 3.1l.7.3v1.5H5.1v-1.5l.7-.3c1.5-.5 2.6-1.7 2.6-3.1V4.3H8a.9.9 0 0 1 0-1.8z', transform: 'rotate(45 10 10)' }),
    h(Path, { d: 'M9.35 13.3h1.3v3.6L10 18l-.65-1.1z', transform: 'rotate(45 10 10)' }))
}
export function MainStarIcon({ size = 16, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: use(color, p.star) },
    h(Path, { d: 'M10 2.4l2.29 5.04 5.51.63-4.09 3.74 1.11 5.42L10 14.5l-4.82 2.73 1.11-5.42L2.2 8.07l5.51-.63z' }))
}
export function StopIcon({ size = 14, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: use(color, p.accentInk) },
    h(Rect, { x: 5, y: 5, width: 10, height: 10, rx: 2 }))
}
export function DotsIcon({ size = 20, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: use(color, p.ink2), strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h(Path, { d: 'M5 10h.01M10 10h.01M15 10h.01' }))
}
// Two overlapping sheets, as on the desktop (team-ui/icons.js CopyIcon).
export function CopyIcon({ size = 16, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: use(color, p.ink3), strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h(Path, { d: 'M8.5 7h6A1.5 1.5 0 0 1 16 8.5v6a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 7 14.5v-6A1.5 1.5 0 0 1 8.5 7z' }),
    h(Path, { d: 'M4 12.5V5.5A1.5 1.5 0 0 1 5.5 4H13' }))
}
export function CheckIcon({ size = 15, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: use(color, p.accent), strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h(Path, { d: 'M4.5 10.5l3.5 3.5 7.5-8' }))
}

export function CloseIcon({ size = 18, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round">
      <Path d="M5 5l10 10M15 5L5 15" />
    </Svg>
  )
}

// The desktop's ChatsIcon and NewSessionIcon (icons.js): a Bot's sessions, and a fresh one.
export function ChatsIcon({ size = 20, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: use(color, p.ink2), strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h(Path, { d: 'M3.5 5.5A1.5 1.5 0 0 1 5 4h7a1.5 1.5 0 0 1 1.5 1.5V10A1.5 1.5 0 0 1 12 11.5H8L5 14v-2.5A1.5 1.5 0 0 1 3.5 10z' }),
    h(Path, { d: 'M13.5 7.5H15A1.5 1.5 0 0 1 16.5 9v4.5A1.5 1.5 0 0 1 15 15v2l-2.5-2h-3A1.5 1.5 0 0 1 8 13.5V13' }))
}
export function NewSessionIcon({ size = 20, color }: IconProps) {
  const { p } = useTheme()
  return h(Svg, { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', stroke: use(color, p.ink2), strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h(Path, { d: 'M4 5.5A2 2 0 0 1 6 3.5h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9.5L6 16.5v-3A2 2 0 0 1 4 11.5z' }),
    h(Path, { d: 'M10 6.3v4.4' }), h(Path, { d: 'M7.8 8.5h4.4' }))
}
export function SideIcon({ size = 20, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M17 11.5a6.5 6.5 0 0 1-6.5 6.5H4l2-2.6A6.5 6.5 0 1 1 17 11.5Z" />
      <Path d="M8.5 8.5 12 12M12 8.5 8.5 12" />
    </Svg>
  )
}
