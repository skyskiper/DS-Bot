// The right column's topic entry and the list it opens in place. Stateless: the page owns
// which room is open and what a click does, so the markup is checked without a browser.
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { call } from './api.js'
import { t } from './i18n.js'
import { cardLine, entryLabel, moveTargets, promotedAtOf, shortTitle, threadTitle } from './topics-view.js'

// D2/D23: one 36px row under the group's name — up to three dots for the active topics, the
// counts, and a chevron. #Other is not counted here; it is a row of the list.
export function TopicEntry({ book, onOpen }) {
  const { active, pending, archived } = counts(book)
  if (active + pending + archived === 0) return null
  return h('button', {
    type: 'button', className: 'bt-topics-entry', 'aria-label': entryLabel(book),
    onClick: () => { if (typeof onOpen === 'function') onOpen() },
  },
  h('span', { className: 'bt-topics-dots', 'aria-hidden': true },
    Array.from({ length: Math.min(active, 3) }, (_, i) => h('i', { key: i }))),
  h('span', { className: 'bt-topics-entry-label' }, t('Topics')),
  h('span', { className: 'bt-topics-entry-count' }, entryLabel(book).split(' · ').slice(1).join(' · ')),
  h('span', { className: 'bt-topics-chev', 'aria-hidden': true }, '›'))
}

// The list inside the column: active (newest first), queued, archived (recent first), and
// #Other last. An archived row asks to reopen; a full house leaves it waiting, not lost.
export function TopicList({ book, onOpen, onReopen, onCancelReopen, reopening = [], archivedOpen = false, onToggleArchived, seenAt = {} }) {
  const items = Object.values(book?.items ?? {})
  const active = items.filter(item => item.state === 'active').sort((a, b) => b.num - a.num)
  const queued = items.filter(item => item.state === 'pending').sort((a, b) => a.num - b.num)
  const archived = items.filter(item => item.state === 'archived').sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
  const other = book?.other?.msgs ?? []
  if (active.length + queued.length + archived.length + other.length === 0) {
    return h('div', { className: 'bt-topics-empty' }, t('No topics yet'))
  }
  const row = (item, extra) => h('button', {
    key: `n${item.num}`, type: 'button', className: 'bt-topics-card', 'data-state': item.state,
    // Two stamps a window can read: when the host promoted it, and when this window first
    // drew it active. The difference is the delay the "a free seat is taken at once" check wants.
    ...(promotedAtOf(item) === undefined ? {} : { 'data-promoted-at': promotedAtOf(item) }),
    ...(item.state !== 'active' || seenAt[item.num] === undefined ? {} : { 'data-active-seen-at': seenAt[item.num] }),
    onClick: () => { if (typeof onOpen === 'function') onOpen({ num: item.num }) },
  },
  h('span', { className: 'bt-topics-card-bar', 'data-state': item.state, 'aria-hidden': true }),
  h('span', { className: 'bt-topics-card-body' },
    h('span', { className: 'bt-topics-card-title' }, h('span', { className: 'bt-topics-card-num' }, `#${item.num}`), shortTitle(item.title)),
    h('span', { className: 'bt-topics-card-meta' }, extra)),
  h('span', { className: 'bt-topics-chev', 'aria-hidden': true }, '›'))
  return h('div', { className: 'bt-topics-panel' },
    // A reopen asked with every seat taken says so at the top, in the design's two lines,
    // instead of looking like a quiet queue entry.
    reopenOf(reopening) !== undefined && active.length >= 3 && reopenOf(reopening).state === 'full'
      ? h('div', { className: 'bt-topics-warn', role: 'status' },
        h('div', { className: 'bt-topics-warn-line' }, t('{count} topics are already active. Reopen it once a seat frees.', { count: active.length })),
        h('div', { className: 'bt-topics-warn-line' }, t('Nothing is lost; the number stays.')))
      : null,
    section(t('Active'), active.map(item => row(item, cardLine(item, Date.now(), book?.primary)))),
    queued.length > 0 ? section(t('Queued'), queued.map(item => row(item, t('Queued')))) : null,
    // Twelve archived rows pushed the active ones off the screen — the fault the strip was
    // meant to fix — so they fold into one line that opens in place.
    archived.length > 0 && !archivedOpen
      ? h('button', {
        type: 'button', className: 'bt-topics-fold',
        onClick: () => { if (typeof onToggleArchived === 'function') onToggleArchived() },
      }, `${t('Archived')} ${archived.length} ›`)
      : null,
    archived.length > 0 && archivedOpen
      ? section(t('Archived'), archived.map((item) => {
        // A reopen the user asked for says what is actually true: still asking, asked and
        // waiting for nothing, or refused because the house is full — and once a seat
        // frees it turns into a button, so one click is enough instead of leaving the
        // column and coming back.
        const entry = reopenOf(reopening, item.num)
        const free = active.length < 3
        const label = entry === undefined ? t('Archived')
          : entry.state === 'asking' ? t('Requesting…')
          : entry.state === 'asked' ? t('Reopen requested')
          : free ? t('A seat is free') : t('Full · waiting for {count} to end', { count: active.length - 2 })
        const action = entry === undefined || (entry.state === 'full' && free) ? 'reopen' : 'cancel'
        return h('div', { key: `a${item.num}`, className: 'bt-topics-archived', 'data-reopen': entry?.state },
          row(item, label),
          h('button', {
            type: 'button', className: 'bt-soft bt-soft-sm', 'data-action': action,
            onClick: () => {
              if (action === 'reopen') { if (typeof onReopen === 'function') onReopen(item.num) }
              else if (typeof onCancelReopen === 'function') onCancelReopen(item.num)
            },
          }, action === 'reopen' && entry !== undefined ? t('Reopen now ▸') : action === 'reopen' ? t('Reopen') : t('Cancel')))
      }).concat([h('button', {
        key: 'fold', type: 'button', className: 'bt-topics-fold',
        onClick: () => { if (typeof onToggleArchived === 'function') onToggleArchived() },
      }, `${t('Archived')} ${archived.length} ‹`)]))
      : null,
    other.length > 0
      ? section(t('Unclassified'), [h('button', {
        key: 'other', type: 'button', className: 'bt-topics-card', 'data-state': 'other',
        onClick: () => { if (typeof onOpen === 'function') onOpen({ other: true }) },
      },
      h('span', { className: 'bt-topics-card-bar', 'data-state': 'other', 'aria-hidden': true }),
      h('span', { className: 'bt-topics-card-body' },
        h('span', { className: 'bt-topics-card-title' }, `#Other · ${t('unclassified')} · ${other.length}`)),
      h('span', { className: 'bt-topics-chev', 'aria-hidden': true }, '›'))])
      : null)
}

// A reopen entry is either a bare number (an older caller) or `{ num, state }`.
const reopenOf = (list, num) => {
  const entries = (list ?? []).map(entry => (typeof entry === 'number' ? { num: entry, state: 'full' } : entry))
  return (num === undefined ? entries[0] : entries.find(entry => entry.num === num))
}

const counts = (book) => {
  const items = Object.values(book?.items ?? {})
  return {
    active: items.filter(item => item.state === 'active').length,
    pending: items.filter(item => item.state === 'pending').length,
    archived: items.filter(item => item.state === 'archived').length,
  }
}

const section = (title, rows) => h('div', { className: 'bt-topics-section' },
  h('div', { className: 'bt-topics-section-head' }, title),
  ...rows)


// The right column's topic view. It swaps the column's own body — the group's overview, or
// the list — in place: nothing outside the column moves, and no second page or drawer opens.
export function TopicView({ room, book, target = null, onBack, onOpen, onRefresh, reopening = [], onReopen, onCancelReopen, archivedOpen = false, onToggleArchived }) {
  const { active } = counts(book)
  // When this window first drew each topic as active: half of the promotion delay, read
  // beside the host's own stamp on the row.
  const seen = useRef(new Map())
  for (const item of Object.values(book?.items ?? {})) {
    if (item.state === 'active' && !seen.current.has(item.num)) seen.current.set(item.num, Date.now())
    if (item.state !== 'active') seen.current.delete(item.num)
  }
  const seenAt = Object.fromEntries(seen.current)
  // The column is the place the user watches a seat free itself, so while it is open it
  // reads the book back at the visible poll's pace instead of the hidden window's slower one.
  const refresh = useRef(onRefresh)
  refresh.current = onRefresh
  useEffect(() => {
    const timer = setInterval(() => refresh.current?.(), 1500)
    return () => clearInterval(timer)
  }, [])
  const head = (title, count, back) => h('div', { className: 'bt-topics-view-head' },
    h('button', { type: 'button', className: 'bt-topics-back', 'aria-label': t('Back'), onClick: back }, '‹'),
    h('span', { className: 'bt-topics-view-title' }, title),
    Number.isFinite(count) ? h('span', { className: 'bt-topics-view-count' }, t('{count} active', { count })) : null)
  if (target === null) {
    return h('div', { className: 'bt-topics-view' },
      head(t('Topics'), active, onBack),
      h(TopicList, { book, onOpen, onReopen, onCancelReopen, reopening, archivedOpen, onToggleArchived, seenAt }))
  }
  return h(TopicThreadView, { room, book, target, onBack, onRefresh })
}

// One topic's messages in the column: the newest page first, older pages on demand, and the
// long press that moves a message out of #Other and into a topic.
function TopicThreadView({ room, book, target, onBack, onRefresh }) {
  const [page, setPage] = useState({ items: [], hasMore: false, loading: true, error: '' })
  const [moving, setMoving] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const key = target?.other === true ? 'other' : String(target?.num ?? '')
  const count = page.items.length
  const fetchPage = useCallback(async (before) => {
    try {
      const value = await call('topic-thread', {
        roomId: room.id,
        ...(target?.other === true ? { other: true } : { num: target?.num }),
        limit: 50,
        ...(before === undefined ? {} : { before }),
      })
      setPage(previous => {
        const older = before === undefined ? [] : previous.items
        const seen = new Set()
        const items = [...(value.items ?? []), ...older].filter(item => (seen.has(item.seq) ? false : seen.add(item.seq)))
        return { items, hasMore: before === undefined ? value.hasMore === true : previous.hasMore, loading: false, error: '' }
      })
    } catch (error) {
      setPage(previous => ({ ...previous, loading: false, error: error?.message ?? String(error) }))
    }
  }, [room.id, key])
  useEffect(() => {
    setPage({ items: [], hasMore: false, loading: true, error: '' })
    void fetchPage()
  }, [fetchPage])
  const pick = async (num) => {
    setBusy(true)
    try {
      await call('topic-move', { roomId: room.id, seq: moving?.seq, num })
      setMoving(undefined)
      await fetchPage()
      // #Other's count and the topic's own meta both changed; read the book back now.
      if (typeof onRefresh === 'function') onRefresh()
    } catch (error) {
      setPage(previous => ({ ...previous, error: error?.message ?? String(error) }))
    } finally {
      setBusy(false)
    }
  }
  const targets = moveTargets(book)
  return h('div', { className: 'bt-topics-view' },
    h('div', { className: 'bt-topics-view-head' },
      h('button', { type: 'button', className: 'bt-topics-back', 'aria-label': t('Back'), onClick: onBack }, '‹'),
      h('span', { className: 'bt-topics-view-title' }, threadTitle(book, target)),
      h('span', { className: 'bt-topics-view-count' }, t('{count} messages', { count }))),
    page.loading && count === 0 ? h('div', { className: 'bt-topics-empty' }, '…') : null,
    h(TopicThread, {
      title: threadTitle(book, target), items: page.items, hasMore: page.hasMore, count,
      onEarlier: () => { void fetchPage(page.items[0]?.seq) },
      onMove: target?.other === true ? (item) => setMoving(item) : undefined,
    }),
    moving === undefined ? null : h(TopicMoveMenu, {
      item: moving, targets, busy,
      onPick: (num) => { if (!busy) void pick(num) },
      onKeep: () => setMoving(undefined),
      onClose: () => setMoving(undefined),
    }),
    page.error !== '' ? h('div', { className: 'bt-error', role: 'alert' }, page.error) : null)
}

export const TOPICS_PANEL_CSS = `
/* The column's own inset is 12 a side: the drawer body pads 16, so pull 4 back out. */
.bt-topics-body{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;gap:8px;margin:0 -4px}
.bt-topics-view{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;animation:bt-topics-view-in 160ms ease both}
@keyframes bt-topics-view-in{from{opacity:0;transform:translateY(4px)}}
.bt-topics-view-head{display:flex;align-items:center;gap:8px;height:36px;flex:none;padding:0 2px;border-bottom:1px solid var(--bt-line)}
.bt-topics-back{flex:none;width:20px;height:20px;border:0;border-radius:6px;background:none;color:var(--bt-ink-2);font:inherit;font-size:15px;line-height:1;cursor:pointer}
.bt-topics-back:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-topics-view-title{flex:1 1 auto;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-topics-view-count{flex:none;font-size:11px;color:var(--bt-ink-3)}
.bt-topics-thread{display:flex;flex-direction:column;gap:8px;min-height:0;flex:1 1 auto;overflow-y:auto;padding:8px 0}
.bt-topics-thread-head{display:flex;align-items:center;gap:8px}
.bt-topics-thread-title{flex:1 1 auto;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-topics-thread-count{flex:none;font-size:11px;color:var(--bt-ink-3)}
.bt-topics-day{display:flex;align-items:center;gap:8px;font-size:9.5px;color:var(--bt-ink-3)}
.bt-topics-day::after{content:"";flex:1 1 auto;height:1px;background:var(--bt-line)}
.bt-topics-msg{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 8px;font-size:11.5px;line-height:16px;border-radius:6px;padding:2px 4px;margin:0 -4px}
.bt-topics-msg:hover{background:var(--bt-hover)}
.bt-topics-msg-name{flex:none;font-size:10.5px;font-weight:600;color:var(--bt-ink-2)}
.bt-topics-msg-text{flex:1 1 auto;min-width:0;color:var(--bt-ink-2);white-space:pre-wrap;word-break:break-word}
.bt-topics-end{align-self:center;font-size:9.5px;color:var(--bt-ink-3);margin:2px 0}
.bt-topics-move{position:absolute;z-index:60;display:flex;flex-direction:column;gap:2px;min-width:200px;padding:6px;border-radius:12px;background:var(--bt-card);border:1px solid var(--bt-line-2);box-shadow:0 18px 40px -20px rgba(0,0,0,.8)}
.bt-topics-move-head{padding:2px 8px 6px;font-size:11px;color:var(--bt-ink-3)}
.bt-topics-move-row{display:flex;align-items:center;gap:8px;height:28px;padding:0 8px;border:0;border-radius:8px;background:none;color:var(--bt-ink);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.bt-topics-move-row:hover{background:var(--bt-hover)}
.bt-topics-move-num{flex:none;color:var(--bt-accent);font-variant-numeric:tabular-nums}
.bt-topics-move-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-topics-entry{display:flex;align-items:center;gap:8px;width:100%;height:36px;padding:0 12px;border:0;background:none;color:var(--bt-ink);font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
.bt-topics-entry:hover{background:var(--bt-hover)}
.bt-topics-dots{display:inline-flex;gap:3px;flex:none}
.bt-topics-dots i{display:block;width:8px;height:8px;border-radius:50%;background:var(--bt-accent)}
.bt-topics-entry-label{flex:none}
.bt-topics-entry-count{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bt-ink-2);font-size:11px}
.bt-topics-chev{flex:none;color:var(--bt-ink-3)}
.bt-topics-panel{display:flex;flex-direction:column;gap:8px;padding:8px 12px 12px;max-height:320px;overflow-y:auto}
.bt-topics-section{display:flex;flex-direction:column;gap:8px}
.bt-topics-section-head{font-size:11px;line-height:16px;color:var(--bt-ink-3)}
.bt-topics-card{display:flex;align-items:center;gap:8px;width:100%;min-height:64px;padding:9px 10px 9px 8px;box-sizing:border-box;border:0;background:none;color:var(--bt-ink);font:inherit;cursor:pointer;text-align:left;border-radius:12px}
.bt-topics-warn{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,var(--bt-star) 12%,transparent);color:var(--bt-star);font-size:11px;line-height:16px;margin-bottom:4px}
.bt-topics-card:hover{background:var(--bt-hover)}
.bt-topics-card-bar{flex:none;width:3px;align-self:stretch;margin:6px 0;border-radius:999px;background:var(--bt-line-2)}
.bt-topics-card-bar[data-state=active]{background:var(--bt-accent)}
.bt-topics-card-bar[data-state=pending]{background:var(--bt-star)}
.bt-topics-card-bar[data-state=other]{background:var(--bt-ink-3)}
.bt-topics-card-body{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1 1 auto}
.bt-topics-card-title{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:650}
.bt-topics-card-num{flex:none;font-size:10.5px;font-weight:400;color:var(--bt-ink-3)}
.bt-topics-card-meta{font-size:10.5px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-topics-archived{display:flex;align-items:center;gap:6px}
.bt-topics-card[data-state=archived]{min-height:58px;border-radius:12px;background:var(--bt-hover)}
.bt-topics-card[data-state=archived] .bt-topics-card-bar{filter:saturate(.7)}
.bt-topics-archived .bt-topics-card{flex:1 1 auto}
.bt-topics-empty{padding:16px 12px;font-size:12px;color:var(--bt-ink-2)}
`

// A message's own menu, opened by a long press: where it goes instead of #Other. Stateless,
// so the choice is tested without a page — the caller does the move.
export function TopicMoveMenu({ item, targets = [], onPick, onKeep, onClose }) {
  if (item === undefined) return null
  return h('div', { className: 'bt-topics-move', role: 'menu' },
    h('div', { className: 'bt-topics-move-head' }, t('Move to a topic')),
    ...targets.map(target => h('button', {
      key: target.num, type: 'button', role: 'menuitem', className: 'bt-topics-move-row',
      'data-num': target.num, onClick: () => onPick(target.num),
    },
    h('span', { className: 'bt-topics-move-num' }, target.label),
    h('span', { className: 'bt-topics-move-title' }, target.title))),
    h('button', { type: 'button', role: 'menuitem', className: 'bt-topics-move-row', onClick: () => onKeep() }, t('Keep in #Other')),
    h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => onClose() }, t('Cancel')))
}

const LONG_PRESS_MS = 550

// A long press asks where a message should go instead. The press is cancelled by any
// movement, so scrolling a topic never opens the menu.
const pressProps = (item, onMove) => {
  if (typeof onMove !== 'function') return {}
  let timer = 0
  let from = null
  return {
    onPointerDown: (event) => {
      if (event.button === 2) return
      from = { x: event.clientX, y: event.clientY }
      clearTimeout(timer)
      timer = setTimeout(() => onMove(item), LONG_PRESS_MS)
    },
    onPointerMove: (event) => {
      if (from !== null && (Math.abs(event.clientX - from.x) > 6 || Math.abs(event.clientY - from.y) > 6)) clearTimeout(timer)
    },
    onPointerUp: () => clearTimeout(timer),
    onPointerLeave: () => clearTimeout(timer),
    onPointerCancel: () => clearTimeout(timer),
    onContextMenu: (event) => { event.preventDefault(); onMove(item) },
  }
}

// One topic's messages, drawn where the list was: oldest first, a day separator when the
// date changes, the subtopic tag on messages that belong to one, and a row to load what is
// older. The host pages it (topic-thread: before / hasMore), so this only draws.
export function TopicThread({ title, items = [], hasMore = false, onEarlier, onBack, onMove, count }) {
  const rows = []
  let day = ''
  for (const item of items) {
    const label = dayLabel(item.ts)
    if (label !== '' && label !== day) {
      day = label
      rows.push(h('div', { key: `d${label}${item.seq}`, className: 'bt-topics-day' }, label))
    }
    rows.push(h('div', {
      key: `m${item.seq}`, className: 'bt-topics-msg', 'data-seq': item.seq, ...pressProps(item, onMove),
    },
    h('span', { className: 'bt-topics-msg-name' }, item.name ?? ''),
    item.text === null || item.text === undefined
      ? h('span', { className: 'bt-topics-msg-text bt-topics-msg-gone', 'aria-label': t('text unavailable') }, '—')
      : h('span', { className: 'bt-topics-msg-text' }, item.text),
    item.sub === undefined ? null : h('span', { className: 'bt-topic-subtag', 'data-sub': item.sub },
      item.subTitle === undefined ? `#${item.sub}` : `#${item.sub} ${shortTitle(item.subTitle)}`)))
  }
  return h('div', { className: 'bt-topics-thread' },
    h('div', { className: 'bt-topics-thread-head' },
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => { if (typeof onBack === 'function') onBack() } }, '‹'),
      h('span', { className: 'bt-topics-thread-title' }, title ?? ''),
      Number.isFinite(count) ? h('span', { className: 'bt-topics-thread-count' }, t('{count} messages', { count })) : null),
    hasMore
      ? h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => { if (typeof onEarlier === 'function') onEarlier() } }, t('Load earlier'))
      : null,
    rows.length === 0
      ? h('div', { className: 'bt-topics-empty' }, t('No messages in this topic'))
      : rows.concat([h('div', { key: 'end', className: 'bt-topics-end' }, t('· End ·'))]))
}

// A message with no time (a line the room log dropped) gets no separator rather than a wrong one.
const dayLabel = (ts) => {
  if (!Number.isFinite(ts)) return ''
  const at = new Date(ts)
  const today = new Date()
  const same = at.toDateString() === today.toDateString()
  return same ? t('Today') : `${at.getMonth() + 1}/${at.getDate()}`
}
