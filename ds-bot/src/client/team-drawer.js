import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import { CloseIcon, SearchIcon } from './icons.js'
import { useEscape } from './overlay-hooks.js'
import { BotAvatar, botState } from './mark.js'
import { currentPart } from './text.js'
import { t } from './i18n.js'

// Where a Bot is right now, from the same sources the rows use: a card or an approval
// waiting on the user, the group it works in, its own chat, or nothing at all.
function placeOf(bot, { work, questions, roster }) {
  const part = currentPart(bot)
  if (questions?.[part] !== undefined) return { kind: 'need', text: t('waits for your answer') }
  if ((work.approvals ?? []).some(entry => entry.botId === bot.id)) return { kind: 'need', text: t('waits for your approval') }
  const running = Object.entries(work.rooms ?? {}).find(([, list]) => Array.isArray(list) && list.some(entry => entry.botId === bot.id))
  if (running !== undefined) return { kind: 'working', text: t('In {room}', { room: roster.roomsById?.[running[0]]?.name ?? t('a group chat') }) }
  if (work.bots?.[bot.id] !== undefined) return { kind: 'working', text: t('In its own chat') }
  return { kind: 'idle', text: t('Idle') }
}

// One person in the team drawer: the mark, the name and role, where it is now, and a
// dot that reads the same as the sidebar's. A row opens the Bot's chat.
function PersonRow({ bot, place, actions, onClose }) {
  const label = [bot.name, bot.role, place.text].filter(Boolean).join(', ')
  return h('button', {
    type: 'button', className: 'bt-team-row', 'data-bot-id': bot.id, 'data-state': place.kind, 'aria-label': label,
    onClick: () => { onClose(); actions.openSession(bot.id) },
    onContextMenu: (event) => { event.preventDefault(); actions.openMenu({ kind: 'bot', id: bot.id, x: event.clientX, y: event.clientY }) },
  },
  h(BotAvatar, { bot, size: 34, state: botState(place.kind === 'working', undefined, place.kind === 'need') }),
  h('span', { className: 'bt-team-row-body' },
    h('span', { className: 'bt-team-row-name' }, bot.name),
    bot.role ? h('span', { className: 'bt-team-row-role' }, bot.role) : null),
  h('span', { className: 'bt-team-row-place' }, place.text),
  h('span', { className: 'bt-team-row-dot', 'aria-hidden': true }))
}

// The team behind the sidebar's foot: everyone on it, searchable by name or role.
// One row per person, where they are now, and the way into their chat.
export function TeamDrawer({ roster, actions, useWork, leaving = false }) {
  const close = () => actions.closeTeam()
  useEscape(close)
  const [query, setQuery] = useState('')
  const search = useRef(null)
  useEffect(() => { search.current?.focus() }, [])
  const workRaw = useWork
    ? useWork(value => JSON.stringify({ bots: value.bots ?? {}, rooms: value.rooms ?? {}, approvals: value.approvals ?? [] }))
    : '{}'
  const work = useMemo(() => {
    const raw = JSON.parse(workRaw)
    return { bots: raw.bots ?? {}, rooms: raw.rooms ?? {}, approvals: raw.approvals ?? [] }
  }, [workRaw])
  const busy = useMemo(() => {
    const ids = new Set(Object.keys(work.bots))
    for (const list of Object.values(work.rooms)) for (const entry of Array.isArray(list) ? list : []) if (entry.botId !== undefined) ids.add(entry.botId)
    return ids
  }, [work])
  const find = query.trim().toLowerCase()
  const people = roster.bots.filter(bot => find === '' || bot.name.toLowerCase().includes(find) || (bot.role ?? '').toLowerCase().includes(find))
  const places = new Map(people.map(bot => [bot.id, placeOf(bot, { work, questions: roster.questions, roster })]))
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
      h('div', { className: 'bt-team-list', role: 'list' },
        people.length === 0
          ? h('div', { className: 'bt-team-empty' }, t('Nobody matches “{query}”.', { query }))
          : people.map(bot => h(PersonRow, { key: bot.id, bot, place: places.get(bot.id), actions, onClose: close })))))
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
.bt-team-list{overflow-y:auto;padding:4px 8px 12px;display:flex;flex-direction:column;gap:2px}
.bt-team-row{display:flex;align-items:center;gap:10px;width:100%;padding:8px;border:0;border-radius:10px;background:transparent;color:var(--bt-ink);text-align:left;cursor:pointer;font-family:inherit}
.bt-team-row:hover{background:var(--bt-hover)}
.bt-team-row-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.bt-team-row-name{font-size:13px;line-height:18px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-team-row-role{font-size:12px;line-height:16px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-team-row-place{font-size:12px;line-height:16px;color:var(--bt-ink-2);max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-team-row[data-state=need] .bt-team-row-place{color:var(--bt-star)}
.bt-team-row-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--bt-ink-3)}
.bt-team-row[data-state=working] .bt-team-row-dot{background:var(--bt-green)}
.bt-team-row[data-state=need] .bt-team-row-dot{background:var(--bt-star)}
.bt-team-empty{padding:18px 8px;color:var(--bt-ink-3);font-size:13px;text-align:center}
`
