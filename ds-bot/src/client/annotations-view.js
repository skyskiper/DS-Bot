// What the annotation UI shows, worked out from the room's reads alone: the task list the
// right column draws, the line under a message, and what a filter keeps. No React here, so
// the rules are tested without a page.
import { t } from './i18n.js'

export const TASK_STATES = ['pending', 'in_progress', 'completed']

// The newest annotation that carries a status is the task's current state; a think-only read
// never moves it. Mirrors the host's projection so the page can draw without a second call.
export const tasksOf = (reads = {}) => {
  const byNum = new Map()
  for (const [key, read] of Object.entries(reads ?? {})) {
    const task = read?.task
    if (task === undefined || task.status === undefined) continue
    const at = Number(read.at) || 0
    const seq = Number(key) || 0
    const held = byNum.get(task.num)
    if (held !== undefined && (held.at > at || (held.at === at && held.seq > seq))) continue
    byNum.set(task.num, { ...task, at, seq })
  }
  return [...byNum.values()].sort((a, b) => a.num - b.num)
}

// The right column lists what is under way, then the last few finished ones; the rest fold
// into one line. Pending sits with the work in hand, not with what is done.
export const taskList = (reads, { recent = 3 } = {}) => {
  const tasks = tasksOf(reads)
  const live = tasks.filter(task => task.status !== 'completed')
  const done = tasks.filter(task => task.status === 'completed').sort((a, b) => b.at - a.at)
  return { live, done: done.slice(0, recent), more: Math.max(0, done.length - recent) }
}

export const stateLabel = (status) => (status === 'completed' ? t('Done') : status === 'pending' ? t('Queued') : t('In progress'))

// One line under a message: `#4 · 1/3` and the reasoning after it. `undefined` when the
// message carries no annotation, so nothing is drawn at all.
export const annotationLine = (read) => {
  if (read === undefined || read === null) return undefined
  const think = typeof read.think === 'string' ? read.think.trim() : ''
  const task = read.task
  if (think === '' && task === undefined) return undefined
  return {
    ...(think === '' ? {} : { think }),
    ...(task === undefined || task.num === undefined ? {} : { num: task.num, name: task.name, status: task.status, progress: task.progress, say: task.say }),
  }
}

// A filter keeps the messages whose annotation names that task; a message in no task is
// hidden while a task is selected, because it belongs to none of them.
export const keeps = (read, num) => (num === undefined ? true : read?.task?.num === num)

// `#4 补话题动效` — the number always, the name when the admin gave one.
export const taskTitle = (task) => (task === undefined || task.num === undefined
  ? ''
  : typeof task.name === 'string' && task.name !== '' ? `#${task.num} ${task.name}` : `#${task.num}`)

export const filterLabel = (task, count) => (task === undefined
  ? ''
  : `${t('Filtered')}: #${task.num} ${task.progress ?? task.say ?? ''} · ${t('{count} messages', { count })}`.replace('  ', ' '))
