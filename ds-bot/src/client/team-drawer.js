import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, DotsIcon, SearchIcon } from './icons.js'
import { useEscape } from './overlay-hooks.js'
import { BotAvatar, BotMark, botState } from './mark.js'
import { currentPart } from './text.js'
import { t } from './i18n.js'

// Departments the host has not sent yet (an older host, or none) leave the drawer as a
// flat list of people rather than an empty tree.
export const orgGroupsOf = roster => (Array.isArray(roster.departments) && roster.departments.length > 0 ? roster.departments : null)

// The people at work anywhere: their own chat, or a group of theirs.
export function busyIds(work = {}) {
  const ids = new Set(Object.keys(work.bots ?? {}))
  for (const list of Object.values(work.rooms ?? {})) for (const entry of Array.isArray(list) ? list : []) if (entry.botId !== undefined) ids.add(entry.botId)
  return ids
}

// Where a Bot is right now, from the same sources the rows use: a card or an approval
// waiting on the user, the group it works in, its own chat, or nothing at all.
export function placeOf(bot, { work, questions, roster }) {
  const part = currentPart(bot)
  if (questions?.[part] !== undefined) return { kind: 'need', text: t('waits for your answer') }
  if ((work.approvals ?? []).some(entry => entry.botId === bot.id)) return { kind: 'need', text: t('waits for your approval') }
  const running = Object.entries(work.rooms ?? {}).find(([, list]) => Array.isArray(list) && list.some(entry => entry.botId === bot.id))
  if (running !== undefined) return { kind: 'working', text: t('In {room}', { room: roster.roomsById?.[running[0]]?.name ?? t('a group chat') }) }
  if (work.bots?.[bot.id] !== undefined) return { kind: 'working', text: t('In its own chat') }
  return { kind: 'idle', text: t('Idle') }
}

// The drawer's tree: the departments in their own order, the ones with people first and
// the empty ones after them (greyed), and 未分组 last. `null` means the host sent no
// departments: the drawer then lists people flat.
export function orgTree(roster, work = {}) {
  const departments = orgGroupsOf(roster)
  if (departments === null) return null
  const busy = busyIds(work)
  const groups = departments.map(entry => ({ id: entry.id, name: entry.name, builtin: entry.builtin === true, people: [] }))
  const byId = new Map(groups.map(group => [group.id, group]))
  const loose = []
  for (const bot of roster.bots) {
    const group = byId.get(bot.department)
    if (group === undefined) loose.push(bot)
    else group.people.push(bot)
  }
  const count = people => ({ total: people.length, busy: people.filter(bot => busy.has(bot.id)).length })
  const filled = groups.filter(group => group.people.length > 0).map(group => ({ ...group, ...count(group.people) }))
  const empty = groups.filter(group => group.people.length === 0).map(group => ({ ...group, ...count(group.people) }))
  return {
    groups: [...filled, ...empty],
    ungrouped: loose.length === 0 ? null : { id: 'ungrouped', name: t('Ungrouped'), ungrouped: true, people: loose, ...count(loose) },
  }
}

// One person in the team drawer: the mark, the name and role, where it is now, and a
// dot that reads the same as the sidebar's. A row opens the Bot's chat.
function PersonRow({ bot, place, department, actions, onClose }) {
  const label = [bot.name, bot.role, department, place.text].filter(Boolean).join(', ')
  return h('button', {
    type: 'button', className: 'bt-team-row', 'data-bot-id': bot.id, 'data-state': place.kind, 'aria-label': label,
    onClick: () => { onClose(); actions.openSession(bot.id) },
    onContextMenu: (event) => { event.preventDefault(); actions.openMenu({ kind: 'bot', id: bot.id, x: event.clientX, y: event.clientY }) },
  },
  h(BotAvatar, { bot, size: 34, state: botState(place.kind === 'working', undefined, place.kind === 'need') }),
  h('span', { className: 'bt-team-row-body' },
    h('span', { className: 'bt-team-row-name' }, bot.name),
    bot.role ? h('span', { className: 'bt-team-row-role' }, bot.role) : null),
  department ? h('span', { className: 'bt-team-row-dept' }, department) : null,
  h('span', { className: 'bt-team-row-place' }, place.text),
  h('span', { className: 'bt-team-row-dot', 'aria-hidden': true }))
}

// A department's row in the tree: the switch that folds its subtree, its name, how many
// people it has and how many are at work. The `⋯` menu renames it, and removes a
// department the user made; a built-in one can only be renamed.
function DepartmentRow({ group, open, onToggle, onRename, onDelete, busy }) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(group.name)
  const [confirming, setConfirming] = useState(false)
  const input = useRef(null)
  useEffect(() => { if (renaming) { input.current?.focus(); input.current?.select() } }, [renaming])
  const commit = () => {
    const name = draft.trim()
    setRenaming(false)
    setMenu(false)
    if (name !== '' && name !== group.name) onRename(name)
    else setDraft(group.name)
  }
  const counts = [t('{count} people', { count: group.total }), busy > 0 ? t('{count} working', { count: busy }) : ''].filter(Boolean).join(' · ')
  return h('div', { className: 'bt-org-dept', 'data-dept': group.id, 'data-empty': group.total === 0 || undefined, 'data-open': open || undefined },
    h('div', { className: 'bt-org-dept-line' },
      h('button', {
        type: 'button', className: 'bt-org-dept-main', 'aria-expanded': open, 'aria-label': `${group.name}, ${counts}`,
        onClick: onToggle,
      },
      h('span', { className: 'bt-org-caret', 'aria-hidden': true }, open ? h(ChevronDownIcon) : h(ChevronRightIcon)),
      renaming
        ? h('input', {
          ref: input, className: 'bt-org-rename', value: draft, maxLength: 24, 'aria-label': t('Rename'),
          onClick: event => event.stopPropagation(),
          onChange: event => setDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.nativeEvent.isComposing) return
            event.stopPropagation()
            if (event.key === 'Enter') commit()
            else if (event.key === 'Escape') { setDraft(group.name); setRenaming(false); setMenu(false) }
          },
          onBlur: commit,
        })
        : h('span', { className: 'bt-org-name' }, group.name),
      h('span', { className: 'bt-org-counts' }, counts)),
      h('button', {
        type: 'button', className: 'bt-org-more', 'aria-label': t('Department settings for {name}', { name: group.name }), title: t('More'),
        'aria-expanded': menu, onClick: () => { setMenu(value => !value); setConfirming(false) },
      }, h(DotsIcon)),
      menu ? h('div', { className: 'bt-org-menu', role: 'menu' },
        h('button', { type: 'button', role: 'menuitem', onClick: () => { setDraft(group.name); setRenaming(true); setMenu(false) } }, t('Rename')),
        group.builtin
          ? h('span', { className: 'bt-org-menu-note' }, t('Built-in: rename only'))
          : confirming
            ? h('button', { type: 'button', role: 'menuitem', className: 'bt-org-danger', onClick: () => { setMenu(false); setConfirming(false); onDelete() } }, t('Delete this department? Its members go back to ungrouped.'))
            : h('button', { type: 'button', role: 'menuitem', className: 'bt-org-danger', onClick: () => setConfirming(true) }, t('Delete'))) : null),
    // Folded, the department still shows who is in it.
    open || group.stack.length === 0 ? null : h('div', { className: 'bt-org-stack', 'aria-hidden': true },
      group.stack.map(bot => h(BotMark, { key: bot.id, bot, size: 18 }))))
}

// The people of one department, drawn on the tree's guide: a vertical line down the
// group, an elbow to each person's row, and the last one's line stopping there.
function Branch({ people, places, actions, onClose, department }) {
  return h('div', { className: 'bt-org-kids' },
    people.map((bot, index) => h('div', { key: bot.id, className: 'bt-org-kid', 'data-last': index === people.length - 1 || undefined },
      h(PersonRow, { bot, place: places.get(bot.id), department, actions, onClose }))))
}

// The team behind the sidebar's foot: the departments as a tree, searchable by name or
// role, and each person's row opening their chat. A host that sends no departments keeps
// the flat list.
export function TeamDrawer({ roster, actions, useWork, leaving = false }) {
  const close = () => actions.closeTeam()
  useEscape(close)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState({})
  const search = useRef(null)
  useEffect(() => { search.current?.focus() }, [])
  const workRaw = useWork
    ? useWork(value => JSON.stringify({ bots: value.bots ?? {}, rooms: value.rooms ?? {}, approvals: value.approvals ?? [] }))
    : '{}'
  const work = useMemo(() => {
    const raw = JSON.parse(workRaw)
    return { bots: raw.bots ?? {}, rooms: raw.rooms ?? {}, approvals: raw.approvals ?? [] }
  }, [workRaw])
  const busy = useMemo(() => busyIds(work), [work])
  const tree = useMemo(() => orgTree(roster, work), [roster, work])
  const places = useMemo(() => new Map(roster.bots.map(bot => [bot.id, placeOf(bot, { work, questions: roster.questions, roster })])), [roster, work])
  const find = query.trim().toLowerCase()
  const matches = bot => find === '' || bot.name.toLowerCase().includes(find) || (bot.role ?? '').toLowerCase().includes(find)
  const toggle = id => setExpanded(current => ({ ...current, [id]: current[id] !== true }))
  const groups = tree === null ? null : [
    ...tree.groups.map(group => ({
      ...group,
      // A folded department still shows a few marks, so the row is not just a number.
      stack: group.people.slice(0, 3),
      open: expanded[group.id] === true,
    })),
    ...(tree.ungrouped === null ? [] : [{ ...tree.ungrouped, stack: tree.ungrouped.people.slice(0, 3), open: expanded.ungrouped === true }]),
  ]
  const body = (() => {
    if (groups !== null) {
      // Searching reaches people wherever they are: the tree flattens, each row says
      // which department it belongs to.
      if (find !== '') {
        const hits = roster.bots.filter(matches)
        return hits.length === 0
          ? h('div', { className: 'bt-team-empty' }, t('Nobody matches “{query}”.', { query }))
          : hits.map(bot => h(PersonRow, {
            key: bot.id, bot, place: places.get(bot.id), department: departmentNameOf(bot, groups), actions, onClose: close,
          }))
      }
      return groups.map(group => h('div', { key: group.id, className: 'bt-org-group', 'data-group': group.id },
        h(DepartmentRow, {
          group, open: group.open, busy: group.busy,
          onToggle: () => toggle(group.id),
          onRename: name => void actions.renameDepartment?.(group.id, name).catch(error => actions.reportError?.(error, 'department-rename')),
          onDelete: () => void actions.deleteDepartment?.(group.id).catch(error => actions.reportError?.(error, 'department-delete')),
        }),
        group.open ? h(Branch, { people: group.people, places, actions, onClose: close }) : null))
    }
    // No departments from the host: the flat list of people, as before.
    const people = roster.bots.filter(matches)
    return people.length === 0
      ? h('div', { className: 'bt-team-empty' }, t('Nobody matches “{query}”.', { query }))
      : people.map(bot => h(PersonRow, { key: bot.id, bot, place: places.get(bot.id), actions, onClose: close }))
  })()
  return h('div', { className: 'bt-team-layer', 'data-leaving': leaving || undefined },
    h('div', { className: 'bt-scrim', onMouseDown: close }),
    h('div', { className: 'bt-team', role: 'dialog', 'aria-modal': true, 'aria-label': t('Team') },
      h('div', { className: 'bt-team-head' },
        h('span', { className: 'bt-team-h' }, t('Team')),
        h('span', { className: 'bt-team-count' }, t('{count} people · {busy} working', { count: roster.bots.length, busy: busy.size })),
        h('button', { type: 'button', className: 'bt-round bt-team-x', 'aria-label': t('Close'), title: t('Close'), onClick: close }, h(CloseIcon))),
      h('label', { className: 'bt-team-search' },
        h(SearchIcon),
        h('input', {
          ref: search, type: 'search', value: query, placeholder: t('Search people or roles…'),
          'aria-label': t('Search people or roles…'),
          onChange: event => setQuery(event.target.value),
          onKeyDown: (event) => { if (event.key === 'Escape' && query !== '') { event.stopPropagation(); setQuery('') } },
        })),
      h('div', { className: 'bt-team-list', role: groups !== null && find === '' ? 'tree' : 'list' }, body)))
}

// The department a person's row names while searching.
function departmentNameOf(bot, groups) {
  const found = groups.find(group => group.people.some(person => person.id === bot.id))
  return found === undefined || found.ungrouped === true ? t('Ungrouped') : found.name
}

export const TEAM_DRAWER_CSS = `
.bt-team-layer{position:fixed;inset:0;z-index:60;display:flex;align-items:flex-start;justify-content:flex-end}
.bt-team-layer .bt-scrim{position:absolute;inset:0;background:color-mix(in srgb,var(--bt-ink) 22%,transparent)}
.bt-team{position:relative;margin:48px 32px 32px 0;width:min(460px,calc(100vw - 64px));max-height:min(720px,calc(100vh - 80px));display:flex;flex-direction:column;background:var(--bt-card);border:1px solid var(--bt-line);border-radius:16px;box-shadow:var(--bt-glass-shadow);overflow:hidden;color:var(--bt-ink)}
.bt-team-head{display:flex;align-items:center;gap:8px;padding:16px 16px 10px}
.bt-team-h{font-size:16px;line-height:22px;font-weight:600}
.bt-team-count{font-size:12px;line-height:18px;color:var(--bt-ink-3)}
.bt-team-x{margin-left:auto}
.bt-team-search{display:flex;align-items:center;gap:8px;margin:0 16px 8px;padding:8px 10px;border:1px solid var(--bt-line);border-radius:10px;background:var(--bt-main);color:var(--bt-ink-3)}
.bt-team-search input{flex:1 1 auto;min-width:0;border:0;background:transparent;color:var(--bt-ink);font:inherit;font-size:13px;outline:none}
.bt-team-list{overflow-y:auto;padding:2px 8px 12px;display:flex;flex-direction:column;gap:1px}
.bt-team-row{display:flex;align-items:center;gap:10px;width:100%;padding:8px;border:0;border-radius:10px;background:transparent;color:var(--bt-ink);text-align:left;cursor:pointer;font-family:inherit}
.bt-team-row:hover{background:var(--bt-hover)}
.bt-team-row-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.bt-team-row-name{font-size:13px;line-height:18px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-team-row-role{font-size:12px;line-height:16px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-team-row-dept{flex:none;max-width:30%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--bt-tag-bg);color:var(--bt-tag-ink)}
.bt-team-row-place{font-size:12px;line-height:16px;color:var(--bt-ink-2);max-width:42%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-team-row[data-state=need] .bt-team-row-place{color:var(--bt-star)}
.bt-team-row-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--bt-ink-3)}
.bt-team-row[data-state=working] .bt-team-row-dot{background:var(--bt-green)}
.bt-team-row[data-state=need] .bt-team-row-dot{background:var(--bt-star)}
.bt-team-empty{padding:18px 8px;color:var(--bt-ink-3);font-size:13px;text-align:center}
/* The org tree: a department row, then its people on a guide with an elbow each. */
.bt-org-group{display:flex;flex-direction:column}
.bt-org-dept-line{position:relative;display:flex;align-items:center;gap:2px;padding:6px 8px 6px 4px;border-radius:10px}
.bt-org-dept-line:hover{background:var(--bt-hover)}
.bt-org-dept-main{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;padding:0;border:0;background:transparent;color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer}
.bt-org-caret{display:inline-flex;color:var(--bt-ink-3)}
.bt-org-name{font-size:13px;line-height:18px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-org-counts{flex:none;font-size:11px;line-height:16px;color:var(--bt-ink-3)}
.bt-org-dept[data-empty] .bt-org-name,.bt-org-dept[data-empty] .bt-org-counts{color:var(--bt-ink-3)}
.bt-org-dept[data-empty] .bt-org-main{opacity:.7}
.bt-org-more{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--bt-ink-3);cursor:pointer;opacity:0}
.bt-org-dept-line:hover .bt-org-more,.bt-org-more[aria-expanded=true],.bt-org-more:focus-visible{opacity:1}
.bt-org-more:hover{background:var(--bt-active);color:var(--bt-ink)}
.bt-org-menu{position:absolute;right:4px;top:calc(100% - 2px);z-index:2;min-width:200px;padding:4px;display:flex;flex-direction:column;gap:1px;background:var(--bt-card);border:1px solid var(--bt-line-2);border-radius:10px;box-shadow:var(--bt-glass-shadow)}
.bt-org-menu button{display:block;width:100%;padding:7px 9px;border:0;border-radius:6px;background:transparent;color:var(--bt-ink);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}
.bt-org-menu button:hover{background:var(--bt-hover)}
.bt-org-menu .bt-org-danger{color:var(--bt-danger)}
.bt-org-menu-note{padding:7px 9px;font-size:11px;line-height:16px;color:var(--bt-ink-3)}
.bt-org-rename{flex:1 1 auto;min-width:0;border:0;border-radius:6px;background:var(--bt-hover);color:var(--bt-ink);font:inherit;font-size:13px;font-weight:600;line-height:20px;padding:1px 6px;outline:none;box-shadow:inset 0 0 0 .5px var(--bt-line-2)}
.bt-org-stack{display:flex;align-items:center;gap:4px;padding:0 0 6px 28px}
.bt-org-kids{display:flex;flex-direction:column;padding-left:20px}
.bt-org-kid{position:relative;padding-left:14px}
.bt-org-kid::before{content:'';position:absolute;left:0;top:0;bottom:0;border-left:1px solid var(--bt-line-2)}
.bt-org-kid[data-last]::before{bottom:calc(100% - 18px)}
.bt-org-kid::after{content:'';position:absolute;left:0;top:18px;width:10px;border-top:1px solid var(--bt-line-2)}
.bt-org-kid .bt-team-row{padding:6px 8px}
`
