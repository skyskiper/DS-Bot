// A temporary probe for the composer takeover: while a question waits, the conversation
// replaces the resident composer, and a takeover that flips on and off makes the input
// vanish for a frame. This records when the selector's answer changes and when the
// takeover component mounts or unmounts; it changes no behavior and stays off until asked
// for: localStorage["ds-bot:composer-debug"] = "1", or ?bt-composer-debug in the URL.
import { createElement as h, useEffect } from 'react'

const KEY = 'ds-bot:composer-debug'
const MAX = 400
const state = { on: false, since: 0, last: null, flaps: [], mounts: [] }

function wanted() {
  try {
    return window.localStorage.getItem(KEY) === '1' || new URLSearchParams(window.location.search).has('bt-composer-debug')
  } catch {
    return false
  }
}

function record(list, entry) {
  list.push(entry)
  if (list.length > MAX) list.shift()
  ship(entry)
}

// The host appends these to ~/.ds-bot/bot/composer-flaps.jsonl, so whoever asked for the
// probe reads them without a console. Sent in small batches while the switch is on.
let pending = []
let timer = 0
function flush() {
  timer = 0
  if (pending.length === 0) return
  const events = pending.splice(0, pending.length)
  void fetch('api/bot', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-ds-bot-composer-debug': '1' },
    body: JSON.stringify({ endpoint: 'debug-composer', payload: { events } }),
  }).catch(() => {})
}
function ship(entry) {
  if (!state.on) return
  pending.push(entry)
  if (timer === 0) timer = setTimeout(flush, 250)
}

export function installComposerProbe() {
  state.on = wanted()
  state.since = Date.now()
  state.last = null
  const dump = () => JSON.stringify({ on: state.on, since: state.since, flaps: state.flaps, mounts: state.mounts }, null, 1)
  window.__btComposer = {
    state,
    dump,
    // The switch Chief asked to keep: on writes the flag and reloads nothing.
    on: () => { try { window.localStorage.setItem(KEY, '1') } catch {} state.on = true },
    off: () => { try { window.localStorage.removeItem(KEY) } catch {} state.on = false },
    clear: () => { state.flaps.length = 0; state.mounts.length = 0 },
  }
  window.dumpComposerFlaps = () => { console.info('[ds-bot] composer probe', dump()); return dump() }
  console.info(`[ds-bot] composer probe ${state.on ? 'on' : 'off'} (turn on: localStorage["ds-bot:composer-debug"]="1" then reload, or ?bt-composer-debug in the URL)`)
}

/** What the composer slot's selector answered, once per change. */
export function noteComposerSelect(matched) {
  if (!state.on) return
  const hit = matched !== null && matched !== undefined
  if (state.last === hit) return
  state.last = hit
  const at = Date.now()
  const entry = {
    at,
    ms: at - state.since,
    takeover: hit,
    kind: hit ? matched.kind ?? matched.type ?? null : null,
    id: hit ? matched.id ?? matched.callId ?? matched.questionId ?? null : null,
  }
  record(state.flaps, entry)
  console.info('[ds-bot] composer select', JSON.stringify(entry))
}

/** Wraps the takeover component so its mount and unmount are recorded too. */
export function probeComposerTakeover(Component) {
  return function ProbedComposerTakeover(props) {
    useEffect(() => {
      if (!state.on) return undefined
      const at = Date.now()
      record(state.mounts, { at, ms: at - state.since, event: 'mount' })
      console.info('[ds-bot] composer takeover mounted', JSON.stringify({ at, ms: at - state.since }))
      return () => {
        const gone = Date.now()
        record(state.mounts, { at: gone, ms: gone - state.since, event: 'unmount' })
        console.info('[ds-bot] composer takeover unmounted', JSON.stringify({ at: gone, ms: gone - state.since }))
      }
    }, [])
    return h(Component, props)
  }
}
