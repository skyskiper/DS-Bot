// The topic strip in the conversation, and the two labels that tie a message to a topic.
// Stateless: the page decides whether it is open and what a click does, so the markup is
// tested without a browser. English copy comes from the shared dictionary.
import { createElement as h } from 'react'
import { t } from './i18n.js'
import { badgeLabel, entryLabel, recordedLabel, topicRows } from './topics-view.js'

// D4/D5: one 32px row, 24px collapsed to a bare `#n`; nothing renders while no topic exists.
export function TopicStrip({ book, open = false, working = null, onToggle, onOpen }) {
  const rows = topicRows(book)
  if (rows.length === 0) return null
  const current = working ?? rows.find(row => row.state === 'active') ?? rows[0]
  const openRow = (row) => { if (typeof onOpen === 'function') onOpen(row) }
  return h('div', { className: 'bt-topics', 'data-open': open ? '' : undefined },
    h('button', {
      type: 'button', className: 'bt-topics-bar', 'aria-expanded': open,
      onClick: () => { if (typeof onToggle === 'function') onToggle(!open) },
    },
    h('span', { className: 'bt-topics-now' },
      h('span', { className: 'bt-topics-num' }, current.label),
      h('span', { className: 'bt-topics-title' }, current.title)),
    h('span', { className: 'bt-topics-count' }, entryLabel(book)),
    h('span', { className: 'bt-topics-chev', 'aria-hidden': true }, t(open ? 'Collapse' : 'Expand'))),
    open
      ? h('div', { className: 'bt-topics-list' },
        rows.map(row => h('button', {
          key: row.key, type: 'button', className: 'bt-topics-row', 'data-state': row.state ?? 'other',
          onClick: () => openRow(row),
        },
        h('span', { className: 'bt-topics-row-num' }, row.label),
        h('span', { className: 'bt-topics-row-title' }, row.title),
        row.subs > 0 ? h('span', { className: 'bt-topics-row-subs' }, `${row.subs}`) : null,
        row.queued ? h('span', { className: 'bt-topics-row-queued' }, t('Queued')) : null)))
      : null)
}

// The receipt under a message the admin recorded, and the badge on a reply that belongs to
// a topic. Both name one number, which is what lets the user match a decision to a sentence.
export function RecordedLine({ num, replaces }) {
  if (!Number.isFinite(num)) return null
  return h('span', { className: 'bt-topic-receipt', 'data-num': num }, recordedLabel(num, replaces))
}

export function TopicBadge({ num }) {
  if (!Number.isFinite(num)) return null
  return h('span', { className: 'bt-topic-badge', 'data-num': num, title: t('Topics') }, badgeLabel(num))
}

// A subtopic tag on a message inside one: `#1.3 回退用例`, drawn from the bare value the
// host sends plus its optional title — never a second `#`.
export function SubtopicTag({ sub, title }) {
  if (typeof sub !== 'string' || sub === '') return null
  const [parent, own] = sub.split('.')
  const text = title === undefined || title === '' ? `#${sub}` : `#${parent}.${own} ${title}`
  return h('span', { className: 'bt-topic-subtag', 'data-sub': sub }, text)
}

export const TOPICS_STRIP_CSS = `
.bt-topics{display:flex;flex-direction:column;min-width:0;background:var(--bt-card);border-top:.5px solid var(--bt-line)}
.bt-topics-bar{display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;border:0;background:none;color:var(--bt-ink);font:inherit;font-size:12px;line-height:16px;cursor:pointer;text-align:left}
.bt-topics-bar:hover{background:var(--bt-hover)}
.bt-topics[data-open] .bt-topics-bar{border-bottom:.5px solid var(--bt-line)}
.bt-topics:not([data-open]) .bt-topics-bar{height:24px}
.bt-topics-now{display:flex;align-items:center;gap:6px;min-width:0;flex:1 1 auto}
.bt-topics-num{flex:none;font-variant-numeric:tabular-nums;color:var(--bt-accent)}
.bt-topics-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-topics-count{flex:none;color:var(--bt-ink-2);font-size:11px}
.bt-topics-chev{flex:none;color:var(--bt-ink-3);font-size:11px}
.bt-topics-list{display:flex;flex-direction:column;max-height:320px;overflow-y:auto;padding:4px 0}
.bt-topics-row{display:flex;align-items:center;gap:8px;height:28px;padding:0 12px;border:0;background:none;color:var(--bt-ink);font:inherit;font-size:12px;cursor:pointer;text-align:left}
.bt-topics-row:hover{background:var(--bt-hover)}
.bt-topics-row-num{flex:none;font-variant-numeric:tabular-nums;color:var(--bt-accent)}
.bt-topics-row-title{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-topics-row-subs{flex:none;color:var(--bt-ink-2);font-size:11px}
.bt-topics-row-queued{flex:none;color:var(--bt-star);font-size:11px}
.bt-topic-receipt{display:inline-block;margin-top:4px;padding:1px 6px;border-radius:999px;background:var(--bt-accent-soft);color:var(--bt-accent);font-size:11px;line-height:16px}
.bt-topic-badge{display:inline-flex;align-items:center;height:16px;padding:0 5px;border-radius:999px;background:var(--bt-tag-bg);color:var(--bt-ink-2);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.bt-topic-subtag{display:inline-flex;align-items:center;height:16px;margin-left:6px;padding:0 5px;border-radius:999px;background:var(--bt-tag-bg);color:var(--bt-ink-3);font-size:11px}
`
