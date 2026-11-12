// A group member's Session is hidden, so a question it asks has nowhere to render on its own
// and the call waits. Give the group a way in: a card in the room's book that opens that
// Bot's own chat, where DSH's own card is, and settle it once the question is gone.
//
// The question is observed on `user-questions/request`. The plugin's Context is a sibling of
// the asking agent's scope, so only a `global` listener sees the dispatch; it must call
// `next()` or the answer never runs. The event covers cua's untimed ask as well as timed asks.
//
// The pending set is still read as a fallback for a DSH whose dispatch shape changes: it only
// ever holds timed asks, so a shape change costs the untimed card, not the state request.
import { randomUUID } from 'node:crypto'

const seen = new Map()
const settled = new Map()
const SETTLED_KEPT = 500

const keyOf = (sessionId, questionId) => `${sessionId}\u0000${questionId}`
const rememberSettled = (key) => {
  settled.set(key, true)
  if (settled.size > SETTLED_KEPT) settled.delete(settled.keys().next().value)
}

const probeWaits = (rt) => {
  const service = rt.ctx.get?.('userQuestions')
  const waits = service?.waits
  if (!(waits instanceof Map)) return undefined
  return waits
}

// The inner map is keyed by callId; its value is a TimedQuestionWait, which has no id.
const questionOf = (id) => (typeof id === 'string' && id !== '' ? id : undefined)

export function install(rt) {
  let warned = false
  const warnOnce = (message) => {
    if (warned) return
    warned = true
    rt.warn?.(message)
  }

  // Both paths name a card the same way, so one question never becomes two cards.
  const raise = (sessionId, owner, questionId) => {
    const key = keyOf(sessionId, questionId)
    if (settled.has(key) || seen.has(key)) return undefined
    const room = rt.roomOf(owner.roomId)
    if (room === undefined) return undefined
    const member = rt.botOf(owner.botId)
    const record = { key, sessionId, questionId, roomId: owner.roomId }
    seen.set(key, record)
    rt.logRoom?.(room, {
      who: member?.name ?? 'Bot', botId: owner.botId, kind: 'group-question',
      sessionId, questionId, requestId: questionId, at: Date.now(), time: Date.now(),
    })
    return record
  }

  const settle = (record, outcome) => {
    if (record === undefined || settled.has(record.key)) return
    rememberSettled(record.key)
    seen.delete(record.key)
    const room = rt.roomOf(rt.groupOwners.get(record.sessionId)?.roomId ?? record.roomId)
    if (room === undefined) return
    rt.logRoom?.(room, {
      who: 'User', kind: 'group-question-answer', sessionId: record.sessionId,
      questionId: record.questionId, requestId: record.questionId, outcome,
      at: Date.now(), time: Date.now(),
    })
    void rt.save?.().catch?.(() => {})
  }

  // The event carries the asker, so the card goes in the room the moment the question is
  // raised rather than on the next state poll. The answer still belongs to DSH: the listener
  // passes the request through, then settles the card when that answer arrives or is closed.
  rt.noteGroupQuestionRequest = (request) => {
    try {
      const sessionId = request?.agent?.session?.id ?? request?.agent?.id
      const owner = sessionId === undefined ? undefined : rt.groupOwners.get(sessionId)
      if (owner === undefined) return undefined
      // A timed ask knows its callId; an untimed one (cua's) gets an identity of its own.
      const questionId = request?.wait?.callId ?? request?.callId ?? request?.questions?.[0]?.id ?? randomUUID()
      return raise(sessionId, owner, questionId)
    } catch (error) {
      warnOnce(`ds-bot: a group question could not be recorded: ${error?.message ?? error}`)
      return undefined
    }
  }
  rt.ctx.on('user-questions/request', function observeGroupQuestion(request, next) {
    const record = rt.noteGroupQuestionRequest?.(request)
    if (typeof next !== 'function') return undefined
    const answer = next()
    if (record === undefined || typeof answer?.then !== 'function') return answer
    answer.then(
      result => {
        try { settle(record, { answered: true, ...(Array.isArray(result?.answers) ? { answers: result.answers } : {}) }) } catch { /* the state request must not break */ }
      },
      failure => {
        try { settle(record, { aborted: true, reason: String(failure?.code ?? failure?.message ?? failure) }) } catch { /* same */ }
      },
    )
    return answer
  }, { prepend: true, global: true })

  // Called while the team state is built; it must never throw into that path.
  rt.groupQuestionsSync = () => {
    try {
      const waits = probeWaits(rt)
      if (waits === undefined) return
      const open = new Map()
      for (const [agent, calls] of waits) {
        const sessionId = agent?.session?.id
        const owner = sessionId === undefined ? undefined : rt.groupOwners.get(sessionId)
        if (owner === undefined || !(calls instanceof Map)) continue
        for (const callId of calls.keys()) {
          const questionId = questionOf(callId)
          if (questionId === undefined) continue
          open.set(keyOf(sessionId, questionId), true)
          raise(sessionId, owner, questionId)
        }
      }
      // A question that is gone settles its card: the user answered it in the Bot's chat.
      for (const record of [...seen.values()]) {
        if (open.has(record.key)) continue
        settle(record, { answered: true })
      }
      void rt.save?.().catch?.(() => {})
    } catch (error) {
      warnOnce(`ds-bot: the pending questions could not be read: ${error?.message ?? error}`)
    }
  }
}
