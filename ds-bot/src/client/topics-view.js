// What the topic strip and its labels show, worked out from `room.topics` alone: the counts
// the entry line prints, the order the list keeps, and the short titles the design fixes.
// No React here, so the rules are tested without a page.
import { t } from './i18n.js'

export const TITLE_CHARS = 8

// D1: active topics only. Pending gets its own segment and is left out when empty; #Other
// is never counted and always sits last in the list.
export const topicCounts = (book) => {
  const items = Object.values(book?.items ?? {})
  return {
    active: items.filter(item => item.state === 'active').length,
    pending: items.filter(item => item.state === 'pending').length,
    archived: items.filter(item => item.state === 'archived').length,
    other: (book?.other?.msgs ?? []).length,
  }
}

// `话题 · 3 活跃 · 1 待排 · 12 归档` — the pending segment disappears at zero.
export const entryLabel = (book) => {
  const { active, pending, archived } = topicCounts(book)
  const parts = [t('{count} active', { count: active })]
  if (pending > 0) parts.push(t('{count} queued', { count: pending }))
  parts.push(t('{count} archived', { count: archived }))
  return `${t('Topics')} · ${parts.join(' · ')}`
}

// D7: cut by code point (not bytes), mark the cut with an ellipsis, and never put a `#` in
// a title — the number is drawn beside it.
export const shortTitle = (text) => {
  const whole = Array.from(String(text ?? '').replace(/#/g, '').trim())
  if (whole.length <= TITLE_CHARS) return whole.join('')
  return `${whole.slice(0, TITLE_CHARS).join('')}…`
}

// D12: the subtopic label carries the same `#` as the topic number.
export const subLabel = (num, sub, title) => (title === undefined || title === ''
  ? `#${num}.${sub}`
  : `#${num}.${sub} ${shortTitle(title)}`)

// The list the entry opens: active first (newest number first, as the design orders them),
// then archived, and #Other last. '#Other' has no number and never appears in the counts.
export const topicRows = (book) => {
  const items = Object.values(book?.items ?? {})
  const byNum = (a, b) => b.num - a.num
  const rows = [
    ...items.filter(item => item.state === 'active').sort(byNum).map(item => rowOf(item)),
    ...items.filter(item => item.state === 'pending').sort((a, b) => a.num - b.num).map(item => ({ ...rowOf(item), queued: true })),
    ...items.filter(item => item.state === 'archived').sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)).map(item => rowOf(item)),
  ]
  const other = (book?.other?.msgs ?? []).length
  return rows.concat(other === 0 ? [] : [{
    key: 'other', num: null, label: '#Other', title: t('Unclassified'), count: other, other: true,
  }])
}

const rowOf = (item) => {
  const subs = Object.values(item.subs ?? {}).filter(sub => sub.state !== 'archived')
  return {
    key: `n${item.num}`,
    num: item.num,
    label: `#${item.num}`,
    title: shortTitle(item.title),
    state: item.state,
    subs: subs.length,
    ...(item.archivedAt === undefined ? {} : { archivedAt: item.archivedAt }),
    ...(item.replacedBy === undefined ? {} : { replacedBy: item.replacedBy }),
  }
}

// --- A1 tray (design/float-proto/pill-d-spec §1b/§1c) ---------------------------------
// The chips the floating column shows: every live topic, its subtopics under it, the
// active one pinned at the bottom. Sizes are the design's, so the column's height is a
// number the window can check (three topics, one with three subtopics: 186).
export const CHIP_HEIGHT = { active: 40, topic: 26, sub: 22 }
export const CHIP_GAP = { topic: 8, sub: 4 }
export const TRAY_MAX = 320

// The last thing that happened in a topic: its opening, an event, or a subtopic's message.
export const lastAtOf = (item) => Math.max(
  item?.createdAt ?? 0,
  item?.lastAt ?? 0,
  ...(item?.events ?? []).map(event => event?.at ?? 0),
  ...Object.values(item?.subs ?? {}).map(sub => Math.max(sub?.lastAt ?? 0, sub?.createdAt ?? 0)),
)

// What the column shows: the topics that hold a seat. A queued topic has no seat yet, so
// it waits in the right column instead of widening the column's six chips.
const trayTopics = book => Object.values(book?.items ?? {}).filter(item => item.state === 'active' || item.state === 'blocked')
const liveTopics = book => Object.values(book?.items ?? {}).filter(item => item.state === 'active' || item.state === 'blocked' || item.state === 'pending')

// A topic counts a message it was opened from, the messages it took in, and its subtopics'.
export const messageCountOf = (item) => (item?.messages?.length ?? 0)
  + (Number.isInteger(item?.fromSeq) ? 1 : 0)
  + Object.values(item?.subs ?? {}).reduce((sum, sub) => sum + (sub?.messages?.length ?? 0), 0)

// Chips top to bottom: oldest activity first, so the active one ends at the column's
// bottom, nearest the composer. `gapBefore` is what separates a chip from the one above.
export const chipsOf = (book, activeNum) => {
  const live = trayTopics(book)
  if (live.length === 0) return []
  const ordered = live.slice().sort((a, b) => (lastAtOf(a) - lastAtOf(b)) || (a.num - b.num))
  const active = ordered.find(item => item.num === activeNum) ?? ordered.at(-1)
  const rest = ordered.filter(item => item !== active)
  const chips = []
  for (const item of [...rest, active]) {
    const on = item === active
    chips.push({ kind: 'topic', key: `n${item.num}`, num: item.num, state: item.state, title: shortTitle(item.title), active: on, gapBefore: chips.length === 0 ? 0 : CHIP_GAP.topic })
    for (const [key, sub] of Object.entries(item.subs ?? {})) {
      if (sub.state === 'archived') continue
      chips.push({ kind: 'sub', key: `n${item.num}.${key}`, num: item.num, sub: Number(key), label: `#${item.num}.${key}`, title: shortTitle(sub.title), state: sub.state, active: on, gapBefore: CHIP_GAP.sub })
    }
  }
  return chips
}

export const chipsHeight = chips => chips.reduce((sum, chip) => sum + (chip.kind === 'sub' ? CHIP_HEIGHT.sub : chip.active ? CHIP_HEIGHT.active : CHIP_HEIGHT.topic) + chip.gapBefore, 0)

// The topic a newly arriving message belongs to, given the book before and after: the one
// whose count grew. Returns the topic number and the subtopic, or undefined.
export const landedIn = (before, after) => {
  for (const item of Object.values(after?.items ?? {})) {
    const was = before?.items?.[item.num]
    if (was !== undefined && lastAtOf(item) <= lastAtOf(was)) continue
    if (was === undefined || messageCountOf(item) > messageCountOf(was) || Object.keys(item.subs ?? {}).length > Object.keys(was.subs ?? {}).length) {
      const growing = Object.entries(item.subs ?? {}).filter(([key, sub]) => {
        const old = was?.subs?.[key]
        return old === undefined || (sub?.lastAt ?? 0) > (old?.lastAt ?? 0)
      }).at(-1)
      return { num: item.num, sub: growing === undefined ? undefined : Number(growing[0]), title: shortTitle(item.title) }
    }
  }
  return undefined
}

// `3 subtopics · 12 messages · just now`, or `No messages yet` for a topic with nothing in it.
export const cardMeta = (item, now = Date.now()) => {
  const subs = Object.values(item?.subs ?? {}).filter(sub => sub.state !== 'archived').length
  const messages = messageCountOf(item)
  const when = timeAgo(lastAtOf(item), now)
  if (messages === 0) return [subs === 0 ? '' : t('{count} subtopics', { count: subs }), t('No messages yet')].filter(Boolean).join(' · ')
  return [subs === 0 ? '' : t('{count} subtopics', { count: subs }), t('{count} messages', { count: messages }), when].filter(Boolean).join(' · ')
}

export const timeAgo = (ts, now = Date.now()) => {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const seconds = Math.max(0, Math.round((now - ts) / 1000))
  if (seconds < 10) return t('just now')
  if (seconds < 60) return t('{count}s ago', { count: seconds })
  if (seconds < 3600) return t('{count}m ago', { count: Math.round(seconds / 60) })
  return t('{count}h ago', { count: Math.round(seconds / 3600) })
}

// Where an #Other message can go: every live topic. The list is what the long press offers.
export const moveTargets = (book) => liveTopics(book)
  .sort((a, b) => b.num - a.num)
  .map(item => ({ num: item.num, label: `#${item.num}`, title: shortTitle(item.title), state: item.state }))

export const threadTitle = (book, target) => {
  if (target?.other === true) return '#Other'
  const item = book?.items?.[target?.num]
  return item === undefined ? `#${target?.num ?? ''}` : `#${item.num} ${shortTitle(item.title)}`
}

// The receipt under a message the admin recorded, and the badge on a reply: both name the
// same number, so the user can tell which of their sentences a decision belongs to.
export const recordedLabel = (num, replaces) => (replaces === undefined
  ? t('→ Recorded as #{num}', { num })
  : t('→ #{num} replaces #{old}', { num, old: replaces }))

export const badgeLabel = num => `#${num}`
