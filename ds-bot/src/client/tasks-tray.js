// The task list of a group chat, and the chips that pick one: what is in hand, what
// finished lately, and — when a task is picked — only that task's messages.
import { createElement as h, useEffect, useState } from 'react'
import { filterLabel, taskList, taskTitle } from './annotations-view.js'
import { useRoomReads, useTaskFilter, setTaskFilter } from './annotations-ui.js'
import { t } from './i18n.js'

const RECENT_DONE = 3

// The list stays folded only where the user folded it; a group with work in hand opens
// with the list showing, since the tasks are the point.
const closed = new Map()
const watchers = new Map()
const announce = (roomId) => { for (const fn of watchers.get(roomId) ?? []) fn() }
const usePanelOpen = (roomId) => {
  const [, bump] = useState(0)
  useEffect(() => {
    if (roomId === undefined) return undefined
    const fn = () => bump(n => n + 1)
    const set = watchers.get(roomId) ?? new Set()
    set.add(fn)
    watchers.set(roomId, set)
    return () => { set.delete(fn) }
  }, [roomId])
  return roomId !== undefined && closed.get(roomId) !== true
}
const setPanelOpen = (roomId, open) => {
  if (open) closed.delete(roomId)
  else closed.set(roomId, true)
  announce(roomId)
}

const countOf = (reads, num) => Object.values(reads ?? {}).filter(read => read?.task?.num === num).length

const chip = (task, active, onClick, key) => h('button', {
  key,
  type: 'button',
  className: 'bt-task-chip',
  'data-on': active || undefined,
  title: taskTitle(task),
  onClick,
}, taskTitle(task))

// The chips above the input, and the line that says what they are filtering to.
export function TaskDock({ sessionId }) {
  // A Session that is no group has no tasks, and the host answers an empty read set for
  // it, so the dock asks every conversation and draws only where there is something.
  const roomId = sessionId
  const view = useRoomReads(roomId)
  const chosen = useTaskFilter(roomId)
  const list = taskList(view?.reads ?? {}, { recent: RECENT_DONE })
  if (list.live.length === 0 && chosen === undefined) return null
  const picked = chosen === undefined ? undefined : taskList(view?.reads ?? {}, { recent: 999 }).done.concat(list.live).find(task => task.num === chosen)
  return h('div', { className: 'bt-tasks-dock' },
    chosen === undefined ? null : h('div', { className: 'bt-tasks-bar' },
      h('span', { className: 'bt-tasks-bar-text' }, filterLabel(picked ?? { num: chosen }, countOf(view?.reads, chosen))),
      h('span', { className: 'bt-tasks-bar-rule', 'aria-hidden': true }, '｜'),
      h('button', { type: 'button', className: 'bt-tasks-exit', onClick: () => setTaskFilter(roomId, undefined) }, t('Exit filter'), h('span', { 'aria-hidden': true }, ' ×'))),
    h('div', { className: 'bt-tasks-chips' },
      list.live.map(task => chip(task, chosen === task.num, () => setTaskFilter(roomId, chosen === task.num ? undefined : task.num), `chip-${task.num}`)),
      h('button', {
        type: 'button', className: 'bt-task-chip bt-tasks-toggle', title: t('Tasks'),
        onClick: () => setPanelOpen(roomId, !(closed.get(roomId) === true)),
      }, `${t('Tasks')} · ${list.live.length}`)))
}

const row = (task, active, onPick, key) => h('button', {
  key, type: 'button', className: 'bt-task-row', 'data-on': active || undefined, onClick: onPick,
},
h('span', { className: 'bt-task-num' }, `#${task.num}`),
h('span', { className: 'bt-task-body' },
  h('span', { className: 'bt-task-name' }, task.name ?? task.progress ?? task.say ?? ''),
  h('span', { className: 'bt-task-note' }, [task.progress && task.name ? task.progress : undefined, task.say].filter(Boolean).join(' · ') || t('Queued'))))

// The list itself, at the right edge of the window: what is in hand, then the last few
// finished ones, then the rest folded into one line that opens in place.
export function TaskPanel({ useSessions }) {
  const current = useSessions(list => Object.values(list.byId).find(session => (session?.retainedBy?.mainView ?? 0) > 0)?.id ?? null)
  const roomId = current ?? undefined
  const view = useRoomReads(roomId)
  const chosen = useTaskFilter(roomId)
  const open = usePanelOpen(roomId)
  const [all, setAll] = useState(false)
  if (!open) return null
  const list = taskList(view?.reads ?? {}, { recent: RECENT_DONE })
  const everyDone = taskList(view?.reads ?? {}, { recent: 999 }).done
  const shownDone = all ? everyDone : list.done
  if (list.live.length === 0 && shownDone.length === 0) return null
  const pick = task => setTaskFilter(roomId, chosen === task.num ? undefined : task.num)
  return h('div', { className: 'bt-tasks-panel' },
    h('div', { className: 'bt-tasks-head' },
      h('span', null, t('Tasks')),
      h('button', { type: 'button', className: 'bt-tasks-close', 'aria-label': t('Hide'), onClick: () => setPanelOpen(roomId, false) }, '×')),
    h('div', { className: 'bt-tasks-list' },
      list.live.map(task => row(task, chosen === task.num, () => pick(task), `live-${task.num}`)),
      shownDone.length === 0 ? null : h('div', { className: 'bt-tasks-sep' }, t('Done')),
      shownDone.map(task => row(task, chosen === task.num, () => pick(task), `done-${task.num}`)),
      everyDone.length > shownDone.length
        ? h('button', { type: 'button', className: 'bt-tasks-more', onClick: () => setAll(true) }, `${t('Done')} ${everyDone.length - shownDone.length} ›`)
        : null))
}

export const TASKS_CSS = `
.bt-tasks-dock{display:flex;flex-direction:column;gap:6px;padding:6px 12px 0}
.bt-tasks-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.bt-task-chip{display:inline-flex;align-items:center;gap:4px;height:22px;max-width:220px;padding:0 9px;border:0;border-radius:6px;background:color-mix(in srgb,var(--bt-ink) 4.5%,transparent);color:var(--bt-ink-2);font:inherit;font-size:11px;line-height:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.bt-task-chip:hover{background:color-mix(in srgb,var(--bt-ink) 8.5%,transparent);color:var(--bt-ink)}
.bt-task-chip[data-on]{background:var(--bt-accent-soft);color:var(--bt-accent)}
.bt-tasks-toggle{margin-left:auto}
.bt-tasks-bar{display:flex;align-items:center;gap:8px;min-width:0;font-size:11px;line-height:16px;color:var(--bt-ink-2)}
.bt-tasks-bar-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-tasks-bar-rule{flex:none;color:var(--bt-ink-3)}
.bt-tasks-exit{flex:none;display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border:0;border-radius:6px;background:color-mix(in srgb,var(--bt-ink) 6%,transparent);color:var(--bt-ink-2);font:inherit;font-size:11px;cursor:pointer}
.bt-tasks-exit:hover{background:color-mix(in srgb,var(--bt-ink) 10%,transparent);color:var(--bt-ink)}
.bt-tasks-panel{position:fixed;right:8px;top:72px;bottom:112px;width:232px;z-index:6;display:flex;flex-direction:column;box-sizing:border-box;padding:8px;border-radius:12px;background:var(--bt-glass-bg);border:1px solid var(--bt-glass-rim);box-shadow:var(--bt-glass-shadow);backdrop-filter:blur(18px)}
.bt-tasks-head{display:flex;align-items:center;justify-content:space-between;padding:2px 4px 8px;font-size:12px;line-height:16px;font-weight:600;color:var(--bt-ink)}
.bt-tasks-close{width:20px;height:20px;border:0;border-radius:6px;background:none;color:var(--bt-ink-3);font:inherit;font-size:14px;line-height:20px;cursor:pointer}
.bt-tasks-close:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-tasks-list{display:flex;flex-direction:column;gap:2px;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
.bt-task-row{display:flex;align-items:flex-start;gap:7px;box-sizing:border-box;width:100%;padding:7px 8px;border:0;border-radius:8px;background:none;color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer}
.bt-task-row:hover{background:var(--bt-hover)}
.bt-task-row[data-on]{background:var(--bt-accent-soft)}
.bt-task-num{flex:none;font-size:10px;line-height:16px;color:var(--bt-ink-3);font-variant-numeric:tabular-nums}
.bt-task-body{display:flex;flex-direction:column;min-width:0;gap:1px}
.bt-task-name{font-size:12px;line-height:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-task-note{font-size:10.5px;line-height:14px;color:var(--bt-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-tasks-sep{padding:6px 8px 2px;font-size:10px;line-height:14px;color:var(--bt-ink-3)}
.bt-tasks-more{align-self:flex-start;margin:2px 0 0;padding:4px 8px;border:0;border-radius:6px;background:none;color:var(--bt-ink-2);font:inherit;font-size:11px;line-height:16px;cursor:pointer}
.bt-tasks-more:hover{background:var(--bt-hover);color:var(--bt-ink)}
`
