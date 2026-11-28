// Both clients render the host's observations. A quiet command keeps the same
// timestamp until a tool changes state or the worker records a milestone.
export function delegatedProgressLabels(work, t, formatTime) {
  return {
    activity: work.tool ? t('Delegated work · {tool}', { tool: work.tool }) : t('Working on the request'),
    detail: [t('{count} tool calls', { count: work.count }),
      t('Last activity {time}', { time: formatTime(work.lastActivityAt) })].join(' · '),
    milestone: work.progress?.blocked ? t('Blocked · {text}', { text: work.progress.text }) : work.progress?.text,
  }
}
