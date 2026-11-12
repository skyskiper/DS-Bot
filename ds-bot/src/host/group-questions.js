// A group member's Session is hidden, so a question it asks has nowhere to render on its own
// and the call waits. Give the group a way in: a card in the room's book that opens that
// Bot's own chat, where DSH's own card is, and settle it once the question is gone.
//
// The one host-side record of a pending question is `UserQuestionService.waits`, which is
// TS-private in DSH and has no public accessor; the dispatch on `user-questions/request`
// never reaches this plugin (see docs/handoff.md). Read it defensively: a different shape
// upstream means no group card, never a broken state request.
const seen = new Map()

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

  // The event carries the asker, so the card goes in the room the moment the question is
  // raised rather than on the next state poll. Observe only: the answer still belongs to
  // DSH, so the listener passes the request on untouched.
  rt.noteGroupQuestionRequest = (request) => {
    try {
      const sessionId = request?.agent?.session?.id ?? request?.agent?.id
      const owner = sessionId === undefined ? undefined : rt.groupOwners.get(sessionId)
      const room = rt.roomOf(owner?.roomId)
      if (owner === undefined || room === undefined) return
      const member = rt.botOf(owner.botId)
      const questionId = request?.questions?.[0]?.id ?? request?.callId ?? `${sessionId}:${Date.now()}`
      const waits = probeWaits(rt)
      rt.warn?.(`ds-bot: group question observed session=${sessionId} waits=${waits?.size ?? 'n/a'} callIds=${[...(waits?.values?.() ?? [])].map(inner => [...(inner?.keys?.() ?? [])].join(',')).join('|')}`)
      rt.logRoom?.(room, {
        who: member?.name ?? 'Bot', botId: owner.botId, kind: 'group-question',
        sessionId, questionId, at: Date.now(), time: Date.now(),
      })
      void rt.save?.().catch?.(() => {})
    } catch (error) {
      warnOnce(`ds-bot: a group question could not be recorded: ${error?.message ?? error}`)
    }
  }
  rt.ctx.on('user-questions/request', function observeGroupQuestion(request, next) {
    rt.noteGroupQuestionRequest?.(request)
    return typeof next === 'function' ? next() : undefined
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
        const room = rt.roomOf(owner.roomId)
        const member = rt.botOf(owner.botId)
        if (room === undefined) continue
        for (const callId of calls.keys()) {
          const questionId = questionOf(callId)
          if (questionId === undefined) continue
          const key = `${sessionId}\u0000${questionId}`
          open.set(key, true)
          if (seen.has(key)) continue
          seen.set(key, { sessionId, questionId, roomId: owner.roomId })
          rt.logRoom?.(room, {
            who: member?.name ?? 'Bot', botId: owner.botId, kind: 'group-question',
            sessionId, questionId, at: Date.now(), time: Date.now(),
          })
        }
      }
      // A question that is gone settles its card: the user answered it in the Bot's chat.
      for (const [key, record] of [...seen]) {
        if (open.has(key)) continue
        seen.delete(key)
        const owner = rt.groupOwners.get(record.sessionId)
        const room = rt.roomOf(owner?.roomId ?? record.roomId)
        if (room === undefined) continue
        rt.logRoom?.(room, {
          who: 'User', kind: 'group-question-answer', sessionId: record.sessionId,
          questionId: record.questionId, at: Date.now(), time: Date.now(),
        })
      }
      void rt.save?.().catch?.(() => {})
    } catch (error) {
      warnOnce(`ds-bot: the pending questions could not be read: ${error?.message ?? error}`)
    }
  }
}
