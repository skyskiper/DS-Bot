// The floating topic tray: the chips in the conversation's bottom right corner, the card
// stack they open, and the 420x320 window a card opens. All of it reads `room.topics`; the
// card window asks `topic-thread` for the messages, because the room's own log never
// reaches the client. Layout numbers are the design's (design/float-proto/pill-d-spec).
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import { call } from './api.js'
import { useEscape } from './overlay-hooks.js'
import { t } from './i18n.js'
import { TRAY_MAX, cardMeta, chipsHeight, chipsOf, landedIn, shortTitle, threadTitle } from './topics-view.js'

const TOPIC_COLORS = ['var(--bt-topic-1)', 'var(--bt-topic-2)', 'var(--bt-topic-3)']
export const topicColor = num => TOPIC_COLORS[(Math.max(1, Number(num) || 1) - 1) % TOPIC_COLORS.length]

// Where the composer's top edge and right edge are: the tray hangs above it, 14 away, and
// follows it when the window resizes or the composer grows with a long message.
const useComposerAnchor = () => {
  const [anchor, setAnchor] = useState(null)
  useEffect(() => {
    const place = () => {
      const card = document.querySelector('[data-composer-card]')
      if (!card) return setAnchor(null)
      const rect = card.getBoundingClientRect()
      if (rect.width === 0) return setAnchor(null)
      setAnchor({ right: Math.round(window.innerWidth - rect.right), bottom: Math.round(window.innerHeight - rect.top) + 14 })
    }
    place()
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null
    const card = document.querySelector('[data-composer-card]')
    if (watch && card) watch.observe(card)
    window.addEventListener('resize', place)
    const timer = setInterval(place, 1500)
    return () => { watch?.disconnect(); window.removeEventListener('resize', place); clearInterval(timer) }
  }, [])
  return anchor
}

const Dot = ({ num, sub }) => h('span', {
  className: 'bt-topic-dot', 'aria-hidden': true,
  style: { background: topicColor(num), opacity: sub === undefined ? 1 : 0.62 },
})

// The collapsed column: one chip per live topic and per subtopic, the active one 180x40 at
// the bottom. Nothing is hidden and nothing folds into a count, so the number of things in
// flight is readable at a glance.
export function TopicsTray({ chips, landing, onActivate, onExpand, anchor }) {
  if (chips.length === 0 || anchor === null) return null
  const height = chipsHeight(chips)
  return h('div', {
    className: 'bt-topics-tray', style: { right: anchor.right, bottom: anchor.bottom, maxHeight: TRAY_MAX },
    'data-over': height > TRAY_MAX ? '' : undefined,
  },
  h('div', { className: 'bt-topics-tray-col' },
    // The capsule opens the stack, but only once the eye is on it; this handle is the same
    // action for the times it is not, and the one a window can click without guessing.
    h('button', {
      type: 'button', className: 'bt-topics-open', 'aria-label': t('Expand'), title: t('Expand'),
      style: { marginBottom: 8 }, onClick: () => { if (typeof onExpand === 'function') onExpand() },
    }, '⌃'),
    chips.map((chip, index) => h('button', {
      key: chip.key, type: 'button',
      className: 'bt-topic-chip', 'data-kind': chip.kind, 'data-key': chip.key,
      'data-active': chip.active ? '' : undefined,
      'data-state': chip.state,
      'data-landed': landing?.key === chip.key ? '' : undefined,
      style: { marginTop: chip.gapBefore === 0 ? undefined : chip.gapBefore, '--bt-chip-delay': `${index * 60}ms` },
      title: `${chip.kind === 'sub' ? chip.label : `#${chip.num}`} ${chip.title}`,
      onClick: () => (chip.active ? onExpand() : onActivate(chip.num)),
    },
    h(Dot, { num: chip.num, sub: chip.sub }),
    h('span', { className: 'bt-topic-num' }, chip.kind === 'sub' ? chip.label : `#${chip.num}`),
    h('span', { className: 'bt-topic-label' }, chip.title)))),
    landing !== null && landing !== undefined
      ? h('span', { key: `landing${landing.seq}`, className: 'bt-topics-landing', 'data-num': landing.num },
        landing.sub === undefined ? `#${landing.num}` : `#${landing.num} › ${landing.subTitle ?? landing.sub}`)
      : null)
}


// The message flying into its topic (design: 900ms, a quadratic arc, 4 trail dots at
// 45/90/135/180ms, scale .86 → 1, rotate −4° → +4°). It starts where the message really
// sits on screen, so the slip comes out of the bubble the reader just saw.
export function FlySlip({ from, to, name, text, num, onArrived }) {
  const box = useRef(null)
  const arrived = useRef(onArrived)
  arrived.current = onArrived
  useEffect(() => {
    if (box.current === null) return undefined
    const dur = 900
    const lags = [0, 45, 90, 135, 180]
    const control = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 110 }
    const anims = []
    for (let i = 0; i < lags.length; i += 1) {
      const el = box.current.children[i]
      if (el === undefined || typeof el.animate !== 'function') continue
      const frames = []
      for (let step = 0; step <= 30; step += 1) {
        const t = step / 30
        const at = easeInOutCubic(Math.max(0, Math.min(1, (t * dur - lags[i]) / dur)))
        const x = bezier(from.x, control.x, to.x, at)
        const y = bezier(from.y, control.y, to.y, at)
        frames.push({
          offset: t,
          transform: i === 0
            ? `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${0.86 + 0.14 * at}) rotate(${-4 + 8 * at}deg)`
            : `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${(8 - 4.5 * at) / 8})`,
          opacity: i === 0
            ? (t < 0.08 ? t / 0.08 : t > 0.86 ? Math.max(0, (1 - t) / 0.14) : 1)
            : 0.34 * (1 - at),
        })
      }
      // Web Animations, not a requestAnimationFrame loop: the duration stays readable from
      // outside (`getAnimations({subtree: true})`), which is how a window measures it.
      anims.push(el.animate(frames, { duration: dur, fill: 'forwards' }))
    }
    const main = anims[0]
    if (main !== undefined) main.finished.then(() => arrived.current?.()).catch(() => {})
    return () => { for (const anim of anims) anim.cancel() }
  }, [])
  const head = Array.from(String(text ?? '')).slice(0, 6).join('')
  return h('div', {
    ref: box, className: 'bt-topics-fly-layer', 'aria-hidden': true,
    'data-anim': 'fly', 'data-duration': '900', 'data-trails': '45,90,135,180',
  },
  h('div', { className: 'bt-topics-fly', style: { borderColor: topicColor(num) } },
    h('span', { className: 'bt-topics-fly-ava', style: { background: topicColor(num) } }, String(name ?? '?').slice(0, 1)),
    h('span', { className: 'bt-topics-fly-name' }, name ?? ''),
    h('span', { className: 'bt-topics-fly-text' }, head)),
  ...[1, 2, 3, 4].map(index => h('span', { key: index, className: 'bt-topics-fly-trail', style: { background: topicColor(num) } })))
}

const bezier = (a, b, c, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

// The expanded stack: one card per live topic, the way the design draws them. The stack is
// anchored to the same corner and only grows upwards, so nothing under it moves.
export function TopicsStack({ activeNum, onPick, onCollapse, cards = [], primary }) {
  return h('div', { className: 'bt-topics-stack', role: 'dialog', 'aria-label': t('Topics') },
    h('div', { className: 'bt-topics-stack-cards' }, cards.map(item => {
      const active = item.num === activeNum
      return h('button', {
        key: item.num, type: 'button', className: 'bt-topics-tcard',
        'data-active': active ? '' : undefined, 'data-num': item.num,
        onClick: (event) => onPick(item.num, event.currentTarget.getBoundingClientRect()),
      },
      h('span', { className: 'bt-topics-tcard-bar', style: { background: topicColor(item.num) } }),
      h('span', { className: 'bt-topics-tcard-body' },
        h('span', { className: 'bt-topics-tcard-head' },
          h('span', { className: 'bt-topics-tcard-num' }, `#${item.num}`),
          h('span', { className: 'bt-topics-tcard-title' }, shortTitle(item.title))),
        h('span', { className: 'bt-topics-tcard-meta' }, cardMeta(item, Date.now(), primary))))
    })),
    h('div', { className: 'bt-topics-stack-foot' },
      h('span', { className: 'bt-topics-stack-count' }, t('{count} in flight', { count: cards.length })),
      h('button', { type: 'button', className: 'bt-topics-stack-close', onClick: onCollapse }, `${t('Collapse')} ↓`)))
}

// A topic's recent messages, floating beside the card that opened it. Live: the newest page
// is re-read while it is open, and it only scrolls itself when the user is already at the
// bottom. Older pages come from the same endpoint with `before`.
export function TopicPopover({ roomId, target, anchor, onClose }) {
  const [page, setPage] = useState({ items: [], hasMore: false, loading: true, error: '' })
  const [atBottom, setAtBottom] = useState(true)
  const [fresh, setFresh] = useState(false)
  const body = useRef(null)
  const targetKey = target?.other === true ? 'other' : String(target?.num ?? '')

  const fetchPage = useCallback(async (before) => {
    try {
      const value = await call('topic-thread', {
        roomId,
        ...(target?.other === true ? { other: true } : { num: target?.num }),
        limit: 50,
        ...(before === undefined ? {} : { before }),
      })
      setPage(previous => {
        const older = before === undefined ? [] : previous.items
        const merged = [...(value.items ?? []), ...older]
        const seen = new Set()
        const items = merged.filter(item => (seen.has(item.seq) ? false : seen.add(item.seq)))
        return { items, hasMore: before === undefined ? value.hasMore === true : previous.hasMore, loading: false, error: '' }
      })
    } catch (error) {
      setPage(previous => ({ ...previous, loading: false, error: error?.message ?? String(error) }))
    }
  }, [roomId, targetKey])

  useEffect(() => {
    setPage({ items: [], hasMore: false, loading: true, error: '' })
    void fetchPage()
    const timer = setInterval(() => { void fetchPage() }, 2000)
    return () => clearInterval(timer)
  }, [fetchPage])

  // Follow the newest message only when the reader is at the bottom; an up-scrolled reader
  // keeps their place and gets the `new messages` pill instead.
  useEffect(() => {
    const node = body.current
    if (node === null) return
    if (atBottom) node.scrollTop = node.scrollHeight
    else setFresh(true)
  }, [page.items.length])

  const onScroll = () => {
    const node = body.current
    if (node === null) return
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
    setAtBottom(bottom)
    if (bottom) setFresh(false)
  }

  // 12 to the card's left edge, centred on the card, clamped away from the top and the composer.
  const top = Math.max(60, Math.min(Math.round(anchor.top + anchor.height / 2 - 160), window.innerHeight - 60 - 320))
  const left = Math.max(12, Math.round(anchor.left - 12 - 420))
  const rows = []
  let day = ''
  for (const item of page.items) {
    const label = dayOf(item.ts)
    if (label !== '' && label !== day) {
      day = label
      rows.push(h('div', { key: `d${item.seq}`, className: 'bt-topics-pop-day' }, label))
    }
    rows.push(h('div', { key: `m${item.seq}`, className: 'bt-topics-pop-row', 'data-seq': item.seq },
      h('span', { className: 'bt-topics-pop-ava' }, String(item.name ?? '?').slice(0, 1)),
      h('span', { className: 'bt-topics-pop-main' },
        h('span', { className: 'bt-topics-pop-head' },
          h('span', { className: 'bt-topics-pop-name' }, item.name ?? ''),
          h('span', { className: 'bt-topics-pop-time' }, timeOf(item.ts)),
          item.sub === undefined ? null : h('span', { className: 'bt-topic-subtag', 'data-sub': item.sub },
            item.subTitle === undefined ? `#${item.sub}` : `#${item.sub} ${shortTitle(item.subTitle)}`),
          ...(Array.isArray(item.elsewhere) && item.elsewhere.length > 0
            ? [h('span', { key: 'else', className: 'bt-topics-else' }, `${t('also in')} ${item.elsewhere.map(num => `#${num}`).join(', ')}`)]
            : [])),
        item.text === null || item.text === undefined
          ? h('span', { className: 'bt-topics-pop-text bt-topics-msg-gone' }, '—')
          : h('span', { className: 'bt-topics-pop-text' }, item.text))))
  }
  return h('div', {
    className: 'bt-topics-pop', role: 'dialog', 'aria-label': threadTitle(undefined, target),
    style: { top, left },
  },
  h('div', { className: 'bt-topics-pop-head-bar' },
    h(Dot, { num: target?.num }),
    h('span', { className: 'bt-topics-pop-title' }, threadTitle(undefined, target)),
    h('span', { className: 'bt-topics-pop-meta' }, t('{count} messages', { count: page.items.length })),
    h('button', { type: 'button', className: 'bt-topics-pop-x', 'aria-label': t('Close'), title: t('Close'), onClick: onClose }, '×')),
  page.hasMore
    ? h('button', { type: 'button', className: 'bt-soft bt-soft-sm bt-topics-pop-more', onClick: () => { void fetchPage(page.items[0]?.seq) } }, t('Load earlier'))
    : null,
  h('div', { ref: body, className: 'bt-topics-pop-body', onScroll },
    page.loading && page.items.length === 0
      ? h('div', { className: 'bt-topics-empty' }, '…')
      : rows.length === 0
        ? h('div', { className: 'bt-topics-empty' }, t('No messages in this topic'))
        : rows),
  fresh
    ? h('button', { type: 'button', className: 'bt-topics-pop-new', onClick: () => { setAtBottom(true); setFresh(false); if (body.current) body.current.scrollTop = body.current.scrollHeight } }, `↓ ${t('New messages')}`)
    : null,
  page.error !== '' ? h('div', { className: 'bt-topics-pop-error', role: 'alert' }, page.error) : null,
  h('div', { className: 'bt-topics-pop-foot' }, h('span', { className: 'bt-topics-pop-live' }), t('Live · follows the newest')))
}

// A message's own time, `14:02`, or nothing when the line it came from is gone.
const timeOf = (ts) => {
  if (!Number.isFinite(ts)) return ''
  const at = new Date(ts)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

const dayOf = (ts) => {
  if (!Number.isFinite(ts)) return ''
  const at = new Date(ts)
  return at.toDateString() === new Date().toDateString() ? t('Today') : `${at.getMonth() + 1}/${at.getDate()}`
}

// Where the last message sits on screen, and where the chip a message belongs to sits.
const bubbleRect = () => {
  const rows = document.querySelectorAll('.bt-msg')
  const last = rows[rows.length - 1]
  const rect = last?.getBoundingClientRect()
  if (rect === undefined || rect.width === 0) return undefined
  return { x: rect.right, y: rect.top + rect.height / 2 }
}

const chipRect = (key) => {
  const chip = document.querySelector(`.bt-topic-chip[data-key="${key}"]`)
  const rect = chip?.getBoundingClientRect()
  if (rect === undefined) return undefined
  return { x: rect.left + 26, y: rect.top + 22 }
}

// The tray as the page mounts it: it follows the main view, reads the room's own `topics`,
// and keeps only what a click needs (which chip is active, which card is open). The data
// itself is never copied out of the roster, so a pull with new topics shows at once.
export function TopicsDock({ useRoster, useSessions }) {
  const roster = useRoster(value => value)
  const sessionId = useSessions(list => Object.values(list.byId ?? {}).find(session => (session?.retainedBy?.mainView ?? 0) > 0)?.id)
  const room = sessionId === undefined ? undefined : roster.roomsById?.[sessionId]
  const book = room?.topics
  const anchor = useComposerAnchor()
  const [activeNum, setActiveNum] = useState(undefined)
  const [expanded, setExpanded] = useState(false)
  const [cardNum, setCardNum] = useState(undefined)
  const [cardAnchor, setCardAnchor] = useState(null)
  const [landing, setLanding] = useState(null)
  const [fly, setFly] = useState(null)
  const previous = useRef(undefined)
  const items = Object.values(book?.items ?? {})
  const live = items.filter(item => item.state === 'active' || item.state === 'blocked' || item.state === 'pending')
  const chips = chipsOf(book, activeNum)
  const liveKey = live.map(item => item.num).join(',')

  // The first topic that appears becomes the active one; after that the user's choice stands.
  useEffect(() => {
    if (live.length === 0) { setActiveNum(undefined); setExpanded(false); setCardNum(undefined); return }
    if (activeNum !== undefined && live.some(item => item.num === activeNum)) return
    const newest = live.slice().sort((a, b) => b.num - a.num)[0]
    setActiveNum(newest.num)
  }, [liveKey, activeNum])

  // A message landing: a slip flies from the bubble it was said in to the chip it belongs
  // to (900ms), then the chip pulses and a label names where it landed for another 900ms.
  useEffect(() => {
    const before = previous.current
    previous.current = book
    if (before === undefined || before === book || room === undefined) return
    const land = landedIn(before, book)
    if (land === undefined) return
    setActiveNum(land.num)
    const key = land.sub === undefined ? `n${land.num}` : `n${land.num}.${land.sub}`
    // Who spoke, and what they said, come from the topic's own newest line.
    void call('topic-thread', { roomId: room.id, num: land.num, limit: 1 })
      .then((value) => {
        const last = value.items?.at(-1)
        const from = bubbleRect()
        const to = chipRect(key)
        if (from !== undefined && to !== undefined) {
          setFly({ id: Date.now(), from, to, name: last?.name ?? '', text: last?.text ?? '', num: land.num, sub: land.sub, key })
        } else setLanding({ ...land, key, seq: Date.now() })
      })
      .catch(() => setLanding({ ...land, key, seq: Date.now() }))
  }, [book])

  const arrive = () => {
    const slip = fly
    setFly(null)
    if (slip === undefined || slip === null) return
    setLanding({ key: slip.key, num: slip.num, sub: slip.sub, seq: Date.now() })
  }

  // The slip and the chip's pulse last 900ms. Their timer belongs to the slip, not to the
  // book: a state read arriving meanwhile used to cancel it, so the chip kept the class.
  useEffect(() => {
    if (landing === null || landing === undefined) return undefined
    const timer = setTimeout(() => setLanding(null), 900)
    return () => clearTimeout(timer)
  }, [landing])

  // Escape takes one layer at a time: the card window first (and with it the stack that
  // opened it), so the column underneath stays open until the next press.
  useEscape(() => {
    if (cardNum !== undefined) { setCardNum(undefined); setExpanded(false) }
    else setExpanded(false)
  }, expanded || cardNum !== undefined)

  useEffect(() => {
    if (cardNum === undefined) setCardAnchor(null)
  }, [cardNum])

  if (anchor === null || chips.length === 0) return null
  return h('div', { className: 'bt-topics-dock' },
    expanded
      ? h('div', { className: 'bt-topics-stack-wrap', style: { right: anchor.right, bottom: anchor.bottom } },
        h(TopicsStack, {
          activeNum, primary: book?.primary, cards: live.slice().sort((a, b) => b.num - a.num),
          onPick: (num, rect) => { setCardNum(num); setCardAnchor(rect) },
          onCollapse: () => { setExpanded(false); setCardNum(undefined) },
        }))
      : h(TopicsTray, {
        chips, landing, anchor,
        onActivate: (num) => setActiveNum(num),
        onExpand: () => setExpanded(true),
      }),
    fly !== null && fly !== undefined ? h(FlySlip, { key: fly.id, from: fly.from, to: fly.to, name: fly.name, text: fly.text, num: fly.num, onArrived: arrive }) : null,
    cardNum !== undefined && cardAnchor !== null
      ? h(TopicPopover, { roomId: room.id, target: { num: cardNum }, anchor: cardAnchor, onClose: () => setCardNum(undefined) })
      : null)
}

export const TOPICS_TRAY_CSS = `
.bt-topics-dock{position:fixed;inset:0;pointer-events:none;z-index:45}
.bt-topics-tray{position:fixed;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-end;overflow-y:auto;overflow-x:visible;scrollbar-width:thin;pointer-events:auto;padding-left:6px}
.bt-topics-tray[data-over]{mask-image:linear-gradient(to bottom,transparent,#000 14px,#000 calc(100% - 14px),transparent)}
.bt-topics-tray-col{display:flex;flex-direction:column;align-items:flex-end;width:100%}
.bt-topics-open{flex:none;width:22px;height:22px;border:1px solid var(--bt-tray-line);border-radius:999px;background:var(--bt-tray-chip);color:var(--bt-tray-num);font:inherit;font-size:11px;line-height:1;cursor:pointer}
.bt-topics-open:hover{color:var(--bt-tray-ink);border-color:var(--bt-tray-line-hover)}
.bt-topic-chip{position:relative;display:flex;align-items:center;gap:0;flex:none;border:1px solid var(--bt-tray-line);border-radius:999px;background:var(--bt-tray-chip);color:var(--bt-tray-ink);font:inherit;cursor:pointer;text-align:left;padding:0 12px 0 10px;box-sizing:border-box;transition:width .32s cubic-bezier(.16,1,.3,1) var(--bt-chip-delay,0ms),height .32s cubic-bezier(.16,1,.3,1) var(--bt-chip-delay,0ms),border-color .16s ease,box-shadow .16s ease}
.bt-topic-chip[data-kind=topic]{width:156px;height:26px;font-size:12px;line-height:16px;font-weight:500}
.bt-topic-chip[data-kind=topic][data-active]{width:180px;height:40px;font-size:13px;line-height:18px;font-weight:600;border-color:var(--bt-tray-line-strong)}
.bt-topic-chip[data-kind=sub]{width:142px;height:22px;font-size:10.5px;line-height:15px;padding-left:14px}
.bt-topic-chip[data-active][data-kind=sub]{border-color:var(--bt-tray-line-strong)}
.bt-topic-chip:hover{border-color:var(--bt-tray-line-hover)}
/* A subtopic chip pops when a message lands in it (1.10 → 1, 220ms); a parent chip only
   glows for 240ms and keeps its size. */
.bt-topic-chip[data-kind=sub][data-landed]{animation:bt-sub-land .22s cubic-bezier(.34,1.56,.64,1)}
@keyframes bt-sub-land{from{transform:scale(1.1)}to{transform:scale(1)}}
.bt-topic-chip[data-kind=topic][data-landed]{animation:bt-topic-glow .24s ease}
@keyframes bt-topic-glow{from{box-shadow:0 0 0 2px color-mix(in srgb,var(--bt-topic-1) 24%,transparent)}to{box-shadow:0 0 0 0 transparent}}
/* The speaker dot blinks twice in 500ms: opacity = .3 + .7·|sin(2πt/.5)|. */
.bt-topic-chip[data-landed] .bt-topic-dot{animation:bt-topic-blink .5s linear}
@keyframes bt-topic-blink{0%{opacity:.3}25%{opacity:1}50%{opacity:.3}75%{opacity:1}100%{opacity:1}}
.bt-topic-dot{flex:none;width:6px;height:6px;border-radius:50%;margin-right:7px}
.bt-topic-num{flex:none;color:var(--bt-tray-num);font-size:10.5px;margin-right:6px;font-variant-numeric:tabular-nums}
.bt-topic-label{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-topics-fly-layer{position:fixed;inset:0;pointer-events:none;z-index:60}
.bt-topics-fly{position:fixed;top:0;left:0;display:flex;align-items:center;gap:6px;height:26px;padding:0 10px 0 5px;border-radius:10px;border:1.5px solid;background:var(--bt-tray-fly);color:var(--bt-ink);font-size:11px;font-weight:600;white-space:nowrap;will-change:transform,opacity}
.bt-topics-fly-ava{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;color:var(--bt-tray-on);font-size:9px;font-weight:700}
.bt-topics-fly-name{color:var(--bt-ink-2);font-weight:500}
.bt-topics-fly-text{color:var(--bt-ink)}
.bt-topics-fly-trail{position:fixed;top:0;left:0;width:8px;height:8px;border-radius:50%;pointer-events:none}
.bt-topics-landing{position:absolute;right:calc(100% + 8px);bottom:8px;display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:8px;background:var(--bt-tray-fly);border:1px solid color-mix(in srgb,var(--bt-topic-1) 45%,transparent);color:var(--bt-ink);font-size:11px;font-weight:600;white-space:nowrap;animation:bt-topics-landing 900ms ease both;pointer-events:none}
@keyframes bt-topics-landing{0%{opacity:0;transform:translateX(6px)}13.3%{opacity:1;transform:none}91%{opacity:1}100%{opacity:0;transform:translateX(4px)}}
.bt-topics-stack-wrap{position:fixed;pointer-events:auto;animation:bt-topics-stack-in 160ms ease both}
@keyframes bt-topics-stack-in{from{opacity:0;transform:translateY(4px)}}
.bt-topics-stack{display:flex;flex-direction:column;width:380px;max-height:min(580px,60vh);padding:8px;box-sizing:border-box;border-radius:22px;background:var(--bt-tray-bg);border:1px solid var(--bt-tray-edge);box-shadow:0 24px 48px -28px rgba(0,0,0,.85)}
.bt-topics-stack-cards{display:flex;flex-direction:column;gap:8px;overflow-y:auto;scrollbar-width:thin;padding-right:2px}
.bt-topics-tcard{display:flex;gap:10px;width:364px;min-height:64px;padding:13px 14px 9px;box-sizing:border-box;border-radius:18px;background:var(--bt-tray-card);border:1px solid var(--bt-tray-card-line);color:var(--bt-ink);font:inherit;text-align:left;cursor:pointer}
.bt-topics-tcard:hover{background:var(--bt-tray-card-hover);border-color:var(--bt-tray-card-line-hover)}
.bt-topics-tcard[data-active]{border-color:var(--bt-tray-line-strong)}
.bt-topics-tcard-bar{flex:none;width:3px;margin:4px 0;border-radius:999px;align-self:stretch}
.bt-topics-tcard-body{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.bt-topics-tcard-head{display:flex;align-items:center;gap:6px;min-width:0}
.bt-topics-tcard-num{flex:none;font-size:10.5px;color:var(--bt-ink-3)}
.bt-topics-tcard-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:650}
.bt-topics-tcard-meta{font-size:11.5px;color:var(--bt-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-topics-stack-foot{display:flex;align-items:center;justify-content:space-between;height:24px;margin-top:8px;padding:0 6px}
.bt-topics-stack-count{font-size:10.5px;color:var(--bt-ink-3)}
.bt-topics-stack-close{border:0;background:none;color:var(--bt-ink-3);font:inherit;font-size:10.5px;cursor:pointer}
.bt-topics-stack-close:hover{color:var(--bt-ink)}
.bt-topics-pop{position:fixed;display:flex;flex-direction:column;width:420px;height:320px;border-radius:16px;background:var(--bt-tray-pop);border:1px solid var(--bt-tray-pop-line);box-shadow:0 24px 48px -28px rgba(0,0,0,.85);pointer-events:auto;z-index:46;animation:bt-topics-pop-in 160ms ease both}
@keyframes bt-topics-pop-in{from{opacity:0;transform:translateY(4px)}}
.bt-topics-pop-head-bar{display:flex;align-items:center;gap:6px;height:44px;flex:none;padding:0 12px;border-bottom:1px solid var(--bt-tray-divider)}
.bt-topics-pop-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--bt-ink)}
.bt-topics-pop-meta{flex:none;font-size:10px;color:var(--bt-ink-3);margin-left:auto}
.bt-topics-pop-x{flex:none;width:24px;height:24px;border:0;border-radius:6px;background:none;color:var(--bt-ink-3);font-size:14px;line-height:1;cursor:pointer}
.bt-topics-pop-x:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-topics-pop-more{margin:6px 12px 0;align-self:flex-start}
.bt-topics-pop-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 14px;display:flex;flex-direction:column;gap:8px;scrollbar-width:thin}
.bt-topics-pop-day{font-size:9.5px;color:var(--bt-ink-3);border-top:1px solid var(--bt-line);padding-top:4px}
.bt-topics-pop-row{display:flex;gap:8px;min-width:0}
.bt-topics-pop-ava{flex:none;width:20px;height:20px;border-radius:6px;background:var(--bt-tag-bg);color:var(--bt-ink-2);font-size:10px;display:inline-flex;align-items:center;justify-content:center}
.bt-topics-pop-row>.bt-topics-pop-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}
.bt-topics-pop-head{display:flex;align-items:center;gap:6px;min-width:0}
.bt-topics-pop-name{font-size:10.5px;font-weight:600;color:var(--bt-ink-2)}
.bt-topics-pop-time{font-size:9.5px;color:var(--bt-ink-3)}
.bt-topics-else{font-size:9px;color:var(--bt-tray-num);border:1px solid var(--bt-tray-line);border-radius:999px;padding:0 5px;line-height:14px;white-space:nowrap}
.bt-topics-pop-text{font-size:12px;line-height:17px;color:var(--bt-ink-2);white-space:pre-wrap;word-break:break-word;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.bt-topics-msg-gone{color:var(--bt-ink-3)}
.bt-topics-pop-new{position:absolute;left:50%;transform:translateX(-50%);bottom:34px;height:24px;padding:0 10px;border:0;border-radius:999px;background:var(--bt-tray-card-line);color:var(--bt-ink);font:inherit;font-size:10px;cursor:pointer}
.bt-topics-pop-foot{display:flex;align-items:center;gap:6px;height:26px;flex:none;padding:0 14px;border-top:1px solid var(--bt-tray-divider);font-size:9.5px;color:var(--bt-ink-3)}
.bt-topics-pop-live{width:6px;height:6px;border-radius:50%;background:var(--bt-green)}
.bt-topics-pop-error{padding:4px 14px;font-size:11px;color:var(--bt-danger)}
`
