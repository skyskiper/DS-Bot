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

// The receipt under a message the admin recorded, and the badge on a reply: both name the
// same number, so the user can tell which of their sentences a decision belongs to.
export const recordedLabel = (num, replaces) => (replaces === undefined
  ? t('→ Recorded as #{num}', { num })
  : t('→ #{num} replaces #{old}', { num, old: replaces }))

export const badgeLabel = num => `#${num}`
