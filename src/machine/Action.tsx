import { Pressable, Text } from 'react-native'
import { t } from '../ui/i18n.ts'
import { useMachinePalette } from './appearance.ts'

export function Action({
  label,
  onPress,
  primary = false,
  disabled = false,
}: {
  label: string
  onPress: () => void
  primary?: boolean
  disabled?: boolean
}) {
  const p = useMachinePalette()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(label)}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        paddingHorizontal: 13,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        borderWidth: 1,
        backgroundColor: primary ? p.accent : p.card,
        borderColor: p.line2,
        opacity: disabled ? 0.45 : 1,
        transform: [{ scale: pressed && !disabled ? 0.98 : 1 }],
      })}
    >
      <Text style={{ fontSize: 14, fontWeight: '600', color: primary ? p.accentInk : p.cardInk }}>{t(label)}</Text>
    </Pressable>
  )
}
