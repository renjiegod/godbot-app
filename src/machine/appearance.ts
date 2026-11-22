import { useMemo } from 'react'
import { useTheme } from '../ui/tokens.ts'
import { machinePalette } from './contrast.ts'

export function useMachinePalette() {
  const { p } = useTheme()
  return useMemo(() => machinePalette(p), [p])
}
