export type ChatLayout = 'conversation' | 'bubble' | 'flat'

// Match the Web setting: Conversation is the default for one-to-one Bot chats.
export function chatLayout(preference: string | undefined, direct: boolean): ChatLayout {
  if (preference === 'flat' || preference === 'bubble') return preference
  return direct ? 'conversation' : 'bubble'
}

export const CONVERSATION_INSET = 16
export const CONVERSATION_WIDTH = 920
