import { createElement as h, useState } from 'react'
import { CloseIcon } from './icons.js'
import { relativeShort } from './text.js'
import { useEscape } from './overlay-hooks.js'
import { t } from './i18n.js'
import { sessionSections } from './session-map-data.js'

// A Session id is long and shared with DSH; the row shows its tail and keeps the
// whole one on the copy button's title.
const shortId = (id) => {
  if (typeof id !== 'string') return ''
  return id.length > 18 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id
}

function MapRow({ row, state, at, copied, onCopy, onOpen }) {
  return h('div', { className: 'bt-map-row', 'data-state': state },
    h('div', { className: 'bt-map-copy' },
      h('span', { className: 'bt-map-name' }, row.label),
      h('span', { className: 'bt-map-meta' },
        row.note ? h('span', { className: 'bt-map-note' }, row.note) : null,
        h('code', { className: 'bt-map-id', title: row.sessionId }, shortId(row.sessionId)),
        row.parts > 1 ? h('span', { className: 'bt-map-parts' }, t('{count} parts', { count: row.parts })) : null,
        at > 0 ? h('span', { className: 'bt-map-time' }, relativeShort(at)) : null)),
    h('span', { className: 'bt-map-state' }, h('span', { className: 'bt-map-dot', 'aria-hidden': true }), t(state === 'running' ? 'Running' : state === 'idle' ? 'Idle' : 'Archived')),
    h('div', { className: 'bt-map-actions' },
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => onOpen(row.sessionId) }, t('Open in DSH')),
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm bt-map-copyid', onClick: () => onCopy(row.sessionId) }, copied === row.sessionId ? t('Copied') : t('Copy id'))))
}

// Every Session behind one Bot or one group: a row opens in the shell's own Session
// view, which is what DSH shows for any Session; the Bot skin comes back with Back to Bot.
export function SessionMapDialog({ target, roster, actions, useSessions, useSessionStatus, leaving = false }) {
  const close = () => actions.closeMap()
  useEscape(close)
  const list = useSessions(state => state)
  const statuses = useSessionStatus ? useSessionStatus(map => map) : null
  const [copied, setCopied] = useState('')
  const sections = sessionSections(target, roster)
  if (sections === null) return null
  const rowOf = id => list?.byId?.[id]
  const isListed = id => (Array.isArray(list?.ids) ? list.ids.includes(id) : rowOf(id) !== undefined)
  const stateOf = (id) => {
    if (statuses?.get?.(id)?.running === true || rowOf(id)?.running === true) return 'running'
    return isListed(id) ? 'idle' : 'archived'
  }
  const atOf = id => rowOf(id)?.updatedAt ?? 0
  const copy = (id) => {
    const done = navigator.clipboard?.writeText(id)
    if (!done) return
    void done.then(() => {
      setCopied(id)
      setTimeout(() => setCopied(current => (current === id ? '' : current)), 1200)
    }).catch(() => {})
  }
  const open = id => actions.openRawSession(id)
  const bot = roster.byId?.[target]
  const room = roster.roomsById?.[target]
  const title = bot?.name ?? room?.name ?? ''
  const rows = sections.reduce((sum, section) => sum + section.rows.length, 0)
  const body = sections.map(section => h('section', { key: section.key, className: 'bt-map-section' },
    h('h3', null, section.title),
    section.rows.map(row => h(MapRow, {
      key: row.sessionId, row, state: stateOf(row.sessionId), at: atOf(row.sessionId),
      copied, onCopy: copy, onOpen: open,
    }))))
  return h('div', { className: 'bt-map-layer', 'data-leaving': leaving || undefined },
    h('div', { className: 'bt-scrim', onMouseDown: close }),
    h('div', { className: 'bt-map', role: 'dialog', 'aria-modal': true, 'aria-label': t('Session map') },
      h('div', { className: 'bt-map-head' },
        h('div', { className: 'bt-map-heading' },
          h('span', { className: 'bt-map-kicker' }, t('Session map')),
          h('h2', null, title),
          h('span', { className: 'bt-map-sub' }, rows === 1 ? t('1 session') : t('{count} sessions', { count: rows }))),
        h('button', { type: 'button', className: 'bt-icon-btn', 'aria-label': t('Close'), title: t('Close'), onClick: close }, h(CloseIcon))),
      h('div', { className: 'bt-map-body' }, body),
      h('p', { className: 'bt-map-foot' }, t('Opening a session shows the DeepSeek Harness view. Use Back to Bot to return.'))))
}

export const SESSION_MAP_CSS = `
.bt-map-layer{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;animation:bt-veil-in .18s ease-out both}
.bt-map-layer[data-leaving]{pointer-events:none}
.bt-map{position:relative;display:flex;flex-direction:column;width:min(680px,94vw);max-height:min(76vh,640px);background:var(--bt-card);color:var(--bt-ink);border:1px solid var(--bt-line);border-radius:18px;box-shadow:var(--bt-glass-shadow);overflow:hidden;animation:bt-map-in .22s cubic-bezier(.2,.8,.2,1) both}
.bt-map-layer[data-leaving] .bt-map{animation:bt-map-out .16s ease-in both}
@keyframes bt-map-in{from{opacity:0;transform:translateY(10px) scale(.985)}}
@keyframes bt-map-out{to{opacity:0;transform:translateY(6px) scale(.99)}}
.bt-map-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 18px 12px;border-bottom:1px solid var(--bt-line)}
.bt-map-heading{display:flex;flex-direction:column;gap:2px;min-width:0}
.bt-map-kicker{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--bt-ink-3)}
.bt-map-heading h2{margin:0;font-size:17px;line-height:24px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-map-sub{font-size:12px;color:var(--bt-ink-2)}
.bt-map-body{flex:1;min-height:0;overflow-y:auto;padding:8px 18px 16px}
.bt-map-section{margin-top:12px}
.bt-map-section h3{margin:0 0 6px;font-size:12px;font-weight:600;color:var(--bt-ink-2)}
.bt-map-row{display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:12px}
.bt-map-row:hover{background:var(--bt-hover)}
.bt-map-copy{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.bt-map-name{font-size:14px;line-height:20px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-map-meta{display:flex;align-items:center;gap:8px;min-width:0;font-size:12px;color:var(--bt-ink-2);overflow:hidden;white-space:nowrap}
.bt-map-id{font-family:var(--bt-mono, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:11px;padding:1px 5px;border-radius:6px;background:var(--bt-tag-bg)}
.bt-map-state{display:inline-flex;align-items:center;gap:5px;flex:none;font-size:12px;color:var(--bt-ink-2)}
.bt-map-dot{width:6px;height:6px;border-radius:50%;background:var(--bt-ink-3)}
.bt-map-row[data-state=running] .bt-map-dot{background:var(--bt-accent);box-shadow:0 0 0 3px var(--bt-accent-soft)}
.bt-map-row[data-state=archived] .bt-map-dot{background:transparent;border:1px solid var(--bt-ink-3)}
.bt-map-actions{display:flex;gap:6px;flex:none}
.bt-map-foot{margin:0;padding:10px 18px 14px;border-top:1px solid var(--bt-line);font-size:12px;line-height:18px;color:var(--bt-ink-2)}
@media (max-width:560px){.bt-map-state{display:none}.bt-map-actions{flex-direction:column}}
.bt-map-open{position:absolute;right:0;pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:0;border-radius:999px;background:var(--bt-glass-bg);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);border:.5px solid var(--bt-glass-rim);box-shadow:var(--bt-glass-shadow);color:var(--bt-ink-2);cursor:pointer;transition:background-color .12s ease,color .12s ease,transform .12s ease}
.bt-map-open:hover{color:var(--bt-ink);background:var(--bt-hover)}
.bt-map-open:active{transform:scale(.94)}
.bt-map-return-ico{flex:none;line-height:0}
`
