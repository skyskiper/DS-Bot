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
import { defineTool } from '@deepseek-ai/dsh-tools'
import { output } from './tools.js'

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
  // `source` keeps them apart where it matters: a card raised from the pending set is
  // settled by that set losing the question, while a card raised from an ask follows
  // that ask's own answer — the pending set never holds an untimed ask, so reading it
  // as "gone" would settle a card the user has not answered.
  const raise = (sessionId, owner, questionId, source, extra) => {
    const key = keyOf(sessionId, questionId)
    if (settled.has(key) || seen.has(key)) return undefined
    const room = rt.roomOf(owner.roomId)
    if (room === undefined) return undefined
    const member = rt.botOf(owner.botId)
    const record = { key, sessionId, questionId, roomId: owner.roomId, source }
    seen.set(key, record)
    rt.logRoom?.(room, {
      who: member?.name ?? 'Bot', botId: owner.botId, kind: 'group-question',
      sessionId, questionId, requestId: questionId, ...extra, at: Date.now(), time: Date.now(),
    })
    return record
  }

  const settle = (record, outcome) => {
    if (record === undefined || settled.has(record.key)) return
    rememberSettled(record.key)
    seen.delete(record.key)
    const owner = rt.groupOwners.get(record.sessionId)
    const room = rt.roomOf(owner?.roomId ?? record.roomId)
    if (room === undefined) return
    const member = owner === undefined ? undefined : rt.botOf(owner.botId)
    // Named, not owned: the answer is the user's line, so every member reads it,
    // the one that asked included.
    rt.logRoom?.(room, {
      who: member?.name ?? 'Bot', kind: 'group-question-answer', sessionId: record.sessionId,
      questionId: record.questionId, requestId: record.questionId, outcome,
      // An admin's answer says so, with the reason it gave, so the user can undo it.
      ...(record.answeredBy === undefined ? {} : { by: record.answeredBy.by, reason: record.answeredBy.reason }),
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
      // A timed ask knows its callId; an untimed one (cua's) gets an identity of its own,
      // because its question id names the kind of question and repeats ask after ask.
      const questionId = request?.wait?.callId ?? request?.callId
        ?? `${request?.questions?.[0]?.id ?? 'question'}-${randomUUID()}`
      return raise(sessionId, owner, questionId, 'ask')
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

  // DS Bot asks for an app itself, in the member's own chat, and answers that question
  // before the group's observer can see the provider's request; a gate decision asks
  // with no provider request at all. So the card is taken from the ask itself, and the
  // ask's own identity is what settles it.
  rt.noteAppAccessAsk = ({ sessionId, questionId, appName }) => {
    try {
      const owner = sessionId === undefined ? undefined : rt.groupOwners.get(sessionId)
      if (owner === undefined || typeof questionId !== 'string') return undefined
      // The app rides on the card's line, so the group can say what is being asked.
      return raise(sessionId, owner, questionId, 'ask', appName === undefined ? undefined : { app: appName })
    } catch (error) {
      warnOnce(`ds-bot: a group question could not be recorded: ${error?.message ?? error}`)
      return undefined
    }
  }
  // The group's own buttons answer the card in place: resolve the same ask, so the
  // session decision and any "always" grant land as if it were clicked in the Bot's
  // chat. False once that ask is gone, and the caller then writes nothing.
  rt.answerGroupQuestion = (questionId, decision, answeredBy) => {
    if (typeof questionId !== 'string' || !['deny', 'once', 'always'].includes(decision)) return false
    const record = [...seen.values()].find(item => item.questionId === questionId)
    if (record === undefined || record.source !== 'ask') return false
    // Set before the ask resolves: the settle runs inside that call and reads it.
    record.answeredBy = answeredBy
    const asked = rt.answerAppAccessAsk?.(questionId, decision) === true
    if (!asked) delete record.answeredBy
    return asked
  }

  rt.noteAppAccessDone = ({ sessionId, questionId, answer }) => {
    try {
      const record = typeof sessionId === 'string' && typeof questionId === 'string'
        ? seen.get(keyOf(sessionId, questionId))
        : undefined
      settle(record, { answered: true, ...(answer === undefined ? {} : { choice: answer }) })
    } catch { /* the card's own answer must not break */ }
  }

  // An admin answers on the user's behalf when nobody is at the card: the same resolve,
  // so the same decision and the same row. True only while that ask still waits.
  const answerAsAdmin = ({ sessionId, questionId, decision, reason }) => {
    if (decision === 'always') return { error: 'Always is the user\'s own answer; an admin may deny or allow this time only.' }
    if (decision !== 'deny' && decision !== 'once') return { error: 'decision must be "deny" or "once".' }
    if (typeof questionId !== 'string' || questionId === '') return { error: 'questionId is required.' }
    const said = typeof reason === 'string' ? reason.trim() : ''
    if (said === '') return { error: 'reason is required: the user reads it next to the answer.' }
    const owner = sessionId === undefined ? undefined : rt.groupOwners.get(sessionId)
    if (owner === undefined) return { error: 'Only a group member Session has a group question to answer.' }
    const room = rt.roomOf(owner.roomId)
    if (room === undefined || room.admin !== owner.botId) return { error: 'Only the group\'s admin answers for the user.' }
    if (rt.answerGroupQuestion?.(questionId, decision, { by: 'admin', reason: said.slice(0, 200) }) !== true) {
      return { error: 'That question is no longer waiting for an answer.' }
    }
    return { answered: true, decision, questionId }
  }
  rt.answerGroupQuestionAsAdmin = answerAsAdmin

  rt.teamTools?.push(defineTool({
    name: 'answer_group_question',
    description: 'Answer a group question card that nobody is answering, on the user\'s behalf: deny it, or allow it for this time. Always allow is the user\'s own answer and is refused here. Use it only when the user has handed that call to you and the Bot is stuck waiting; say why in reason, which the user reads next to the answer.',
    parameters: {
      questionId: { type: 'string', required: true, description: 'The questionId of the group card that waits, from the group card or the room ledger' },
      decision: { type: 'string', enum: ['deny', 'once', 'always'], required: true, description: '"deny" refuses this attempt; "once" allows this time only, for this Session. "always" is refused here: that grant is the user\'s own' },
      reason: { type: 'string', required: true, description: 'One line on why you decided this, kept next to the answer' },
    },
    output,
    async execute(args, exec) {
      await rt.load?.()
      const result = answerAsAdmin({
        sessionId: exec.agent?.id,
        questionId: String(args?.questionId ?? ''),
        decision: String(args?.decision ?? ''),
        reason: String(args?.reason ?? ''),
      })
      if (result.error !== undefined) throw new Error(result.error)
      return `Answered ${result.questionId}: ${result.decision}. The user sees who answered and why.`
    },
  }))

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
          raise(sessionId, owner, questionId, 'waits')
        }
      }
      // A question that is gone settles its card only for a card that came from this set:
      // the user answered it in the Bot's chat. An ask this set never held — an untimed
      // one — is settled by the ask itself, not by its absence here.
      for (const record of [...seen.values()]) {
        if (record.source !== 'waits' || open.has(record.key)) continue
        settle(record, { answered: true })
      }
      void rt.save?.().catch?.(() => {})
    } catch (error) {
      warnOnce(`ds-bot: the pending questions could not be read: ${error?.message ?? error}`)
    }
  }
}
