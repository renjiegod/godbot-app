export type AutomationKind = 'message' | 'task' | 'workflow'
export type AutomationSource = 'message' | 'routine' | 'webhook' | 'github'
export type AutomationStatus = 'active' | 'scheduled' | 'overdue' | 'paused' | 'finished'
export type ScheduleKind = 'once' | 'interval' | 'daily' | 'weekly' | 'cron' | 'rrule'
type TimeValue = string | number

export interface AutomationTiming {
  kind: ScheduleKind
  at?: TimeValue
  minutes?: number
  seconds?: number
  time?: string
  timeZone?: string
  weekdays?: number[]
  expression?: string
  rrule?: string
}

export type AutomationTrigger =
  | { kind: 'schedule'; when?: AutomationTiming }
  | { kind: 'webhook'; url?: string }
  | { kind: 'github'; repo: string; eventType?: string; includeLatest?: boolean }

export interface AutomationTarget {
  kind: AutomationKind
  id: string
  name?: string
  revision?: number
}

export interface AutomationItem {
  source: AutomationSource
  id: string
  title: string
  target: AutomationTarget
  status: AutomationStatus
  trigger: AutomationTrigger
  nextAt?: TimeValue | null
  sessionId?: string
  updatedAt?: string | null
  revision?: number
  instructions?: string
  checkOnly?: boolean
  executionActive?: boolean
  deliveryFloorEndsAt?: string
  issue?: string
  lastChecked?: TimeValue
  lastRunId?: string
}

export interface AutomationView {
  available: boolean
  items: AutomationItem[]
  workflows: { id: string; name: string; revision: number }[]
}

export interface AutomationHistory {
  items: {
    id: string; at: TimeValue; state: string; trigger?: string; sessionId?: string; prompt?: string;
    workflowRevision?: number; reason?: string; nodes?: { nodeId: string; title: string; status: string }[]
  }[]
  nextBefore?: string
  earlierRecordsUnavailable?: boolean
  earlierRecordsPruned?: boolean
}

export interface AutomationInput {
  title: string
  instructions?: string
  target?: AutomationTarget
  trigger?: AutomationTrigger
  when?: AutomationTiming
  checkOnly?: boolean
}

type LegacyTask = Omit<AutomationTiming, 'kind'> & {
  id: string; title: string; botId?: string; roomId?: string; sessionId: string; prompt?: string;
  kind: string; state?: AutomationStatus; status: string; scheduledAt?: TimeValue; everySeconds?: number
}

export function legacyAutomationView(view: { available?: boolean; tasks?: LegacyTask[] }): AutomationView {
  return {
    available: view.available !== false,
    workflows: [],
    items: (view.tasks ?? []).map(task => {
      const { kind, scheduledAt, everySeconds, time, timeZone, weekdays, expression, rrule } = task
      let when: AutomationTiming | undefined
      if (kind === 'at' || kind === 'after') when = { kind: 'once', at: scheduledAt }
      else if (kind === 'every') when = { kind: 'interval', minutes: (everySeconds ?? 0) / 60, seconds: everySeconds }
      else if (kind === 'daily' || kind === 'weekly') when = { kind, time, timeZone, weekdays }
      else if (kind === 'cron') when = { kind, expression, timeZone }
      else if (kind === 'rrule') when = { kind, rrule }
      return {
        id: task.id, title: task.title, sessionId: task.sessionId, source: 'message',
        target: { kind: 'message', id: task.roomId ?? task.botId ?? task.sessionId },
        trigger: { kind: 'schedule', when }, instructions: task.prompt,
        status: task.state ?? (task.status === 'active' || task.status === 'paused' ? task.status : 'finished'),
        nextAt: task.status === 'active' ? scheduledAt : null,
      }
    }),
  }
}
