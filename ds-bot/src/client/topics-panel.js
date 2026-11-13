// The right column's topic entry and the list it opens in place. Stateless: the page owns
// which room is open and what a click does, so the markup is checked without a browser.
import { createElement as h } from 'react'
import { t } from './i18n.js'
import { entryLabel, shortTitle } from './topics-view.js'

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
export function TopicList({ book, onOpen, onReopen, onCancelReopen, reopening = [], archivedOpen = false, onToggleArchived }) {
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
    onClick: () => { if (typeof onOpen === 'function') onOpen({ num: item.num }) },
  },
  h('span', { className: 'bt-topics-card-bar', 'data-state': item.state, 'aria-hidden': true }),
  h('span', { className: 'bt-topics-card-body' },
    h('span', { className: 'bt-topics-card-title' }, `#${item.num} ${shortTitle(item.title)}`),
    h('span', { className: 'bt-topics-card-meta' }, extra)),
  h('span', { className: 'bt-topics-chev', 'aria-hidden': true }, '›'))
  return h('div', { className: 'bt-topics-panel' },
    section(t('Active'), active.map(item => row(item, meta(item)))),
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
        const waiting = reopening.includes(item.num)
        return h('div', { key: `a${item.num}`, className: 'bt-topics-archived' },
          row(item, waiting ? t('Reopen queued') : t('Archived')),
          h('button', {
            type: 'button', className: 'bt-soft bt-soft-sm',
            onClick: () => { if (waiting) { if (typeof onCancelReopen === 'function') onCancelReopen(item.num) } else if (typeof onReopen === 'function') onReopen(item.num) },
          }, waiting ? t('Cancel') : t('Reopen')))
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
        h('span', { className: 'bt-topics-card-title' }, '#Other'),
        h('span', { className: 'bt-topics-card-meta' }, `${t('unclassified')} · ${other.length}`)),
      h('span', { className: 'bt-topics-chev', 'aria-hidden': true }, '›'))])
      : null)
}

const counts = (book) => {
  const items = Object.values(book?.items ?? {})
  return {
    active: items.filter(item => item.state === 'active').length,
    pending: items.filter(item => item.state === 'pending').length,
    archived: items.filter(item => item.state === 'archived').length,
  }
}

const meta = (item) => {
  const subs = Object.values(item.subs ?? {}).filter(sub => sub.state !== 'archived').length
  return subs === 0 ? '' : `${subs}`
}

const section = (title, rows) => h('div', { className: 'bt-topics-section' },
  h('div', { className: 'bt-topics-section-head' }, title),
  ...rows)

export const TOPICS_PANEL_CSS = `
.bt-topics-entry{display:flex;align-items:center;gap:8px;width:100%;height:36px;padding:0 12px;border:0;background:none;color:var(--bt-ink);font:inherit;font-size:12.5px;cursor:pointer;text-align:left}
.bt-topics-entry:hover{background:var(--bt-hover)}
.bt-topics-dots{display:inline-flex;gap:3px;flex:none}
.bt-topics-dots i{display:block;width:8px;height:8px;border-radius:50%;background:var(--bt-accent)}
.bt-topics-entry-label{flex:none}
.bt-topics-entry-count{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bt-ink-2);font-size:11px}
.bt-topics-chev{flex:none;color:var(--bt-ink-3)}
.bt-topics-panel{display:flex;flex-direction:column;gap:8px;padding:8px 12px 12px;max-height:320px;overflow-y:auto}
.bt-topics-section{display:flex;flex-direction:column;gap:4px}
.bt-topics-section-head{font-size:11px;line-height:16px;color:var(--bt-ink-3)}
.bt-topics-card{display:flex;align-items:center;gap:8px;min-height:48px;padding:0 8px;border:0;background:none;color:var(--bt-ink);font:inherit;cursor:pointer;text-align:left;border-radius:10px}
.bt-topics-card:hover{background:var(--bt-hover)}
.bt-topics-card-bar{flex:none;width:3px;align-self:stretch;margin:6px 0;border-radius:999px;background:var(--bt-line-2)}
.bt-topics-card-bar[data-state=active]{background:var(--bt-accent)}
.bt-topics-card-bar[data-state=pending]{background:var(--bt-star)}
.bt-topics-card-bar[data-state=other]{background:var(--bt-ink-3)}
.bt-topics-card-body{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.bt-topics-card-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.bt-topics-card-meta{font-size:11px;color:var(--bt-ink-2)}
.bt-topics-archived{display:flex;align-items:center;gap:6px}
.bt-topics-archived .bt-topics-card{flex:1 1 auto}
.bt-topics-empty{padding:16px 12px;font-size:12px;color:var(--bt-ink-2)}
`

// One topic's messages, drawn where the list was: oldest first, a day separator when the
// date changes, the subtopic tag on messages that belong to one, and a row to load what is
// older. The host pages it (topic-thread: before / hasMore), so this only draws.
export function TopicThread({ title, items = [], hasMore = false, onEarlier, onBack }) {
  const rows = []
  let day = ''
  for (const item of items) {
    const label = dayLabel(item.ts)
    if (label !== '' && label !== day) {
      day = label
      rows.push(h('div', { key: `d${label}${item.seq}`, className: 'bt-topics-day' }, label))
    }
    rows.push(h('div', { key: `m${item.seq}`, className: 'bt-topics-msg', 'data-seq': item.seq },
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
      h('span', { className: 'bt-topics-thread-title' }, title ?? '')),
    hasMore
      ? h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => { if (typeof onEarlier === 'function') onEarlier() } }, t('Load earlier'))
      : null,
    rows.length === 0 ? h('div', { className: 'bt-topics-empty' }, t('No messages in this topic')) : rows)
}

// A message with no time (a line the room log dropped) gets no separator rather than a wrong one.
const dayLabel = (ts) => {
  if (!Number.isFinite(ts)) return ''
  const at = new Date(ts)
  const today = new Date()
  const same = at.toDateString() === today.toDateString()
  return same ? t('Today') : `${at.getMonth() + 1}/${at.getDate()}`
}
