// A group member's Session is hidden, so a question it asks has nowhere to render: cua's
// "application access" card is one, and the call waits for an answer nobody can give. Take
// those requests over for group Sessions only: put the card in the room's book, answer from
// the group, and hand the answer back to `questions.ask`. Every other Session keeps DSH's
// own card, which is why this always calls `next()` for them.
import { randomUUID } from 'node:crypto'

export function install(rt) {
  /** @type {Map<string, {id:string, sessionId:string, roomId:string, botId:string, questions:object[], timer:any, resolve:(answer:any)=>void, done:boolean}>} */
  const pending = new Map()

  // No deadline: with an entry in the group, the user answers in their own time. A card
  // nobody answers holds that turn, which the user asked for; see docs/handoff.md.

  const settle = (id, outcome) => {
    const entry = pending.get(id)
    if (entry === undefined || entry.done) return undefined
    entry.done = true
    pending.delete(id)
    const owner = rt.groupOwners.get(entry.sessionId)
    const room = rt.roomOf(owner?.roomId)
    if (room !== undefined) {
      rt.logRoom?.(room, { who: 'User', kind: 'group-question-answer', requestId: id, outcome, time: Date.now() })
    }
    return entry
  }

  const ask = (sessionId, request) => new Promise((resolve) => {
    const owner = rt.groupOwners.get(sessionId)
    const room = rt.roomOf(owner?.roomId)
    if (owner === undefined || room === undefined) { resolve(undefined); return }
    const member = rt.botOf?.(owner.botId)
    const id = randomUUID()
    const entry = { id, sessionId, roomId: owner.roomId, botId: owner.botId, questions: request.questions ?? [], resolve, done: false }
    pending.set(id, entry)
    // The card carries the question and its options verbatim: the group must show exactly
    // the choices the asker offered (cua's "Allow for this task" / "Always allow").
    rt.logRoom?.(room, {
      who: member?.name ?? 'Bot', botId: owner.botId, kind: 'group-question', requestId: id,
      questions: entry.questions, time: Date.now(),
    })
    void rt.save?.().catch?.(() => {})
    request.signal?.addEventListener?.('abort', () => {
      if (settle(id, { aborted: true }) === undefined) return
      resolve(`cancelled:${id}`)
    }, { once: true })
  })

  // A waterfall listener: the first one that answers ends `questions.ask`.
  rt.handleGroupQuestion = async (request, next) => {
    const sessionId = request.agent?.session?.id ?? request.agent?.id
    if (sessionId === undefined || !rt.groupOwners.has(sessionId)) return next()
    const answer = await ask(sessionId, request)
    if (answer === undefined) return next()
    if (typeof answer === 'string') {
      throw Object.assign(new Error('This question was closed before it was answered'), { code: 'ASK_CANCELLED' })
    }
    return answer
  }

  // The group's answer, one item per question: `{ answers: [{ id, selected, custom? }] }`.
  rt.answerGroupQuestion = (requestId, answers) => {
    const entry = pending.get(String(requestId ?? ''))
    if (entry === undefined || entry.done) {
      throw Object.assign(new Error('This question is no longer open'), { code: 'bot/stale' })
    }
    const list = (Array.isArray(answers) ? answers : []).map(item => ({
      id: String(item?.id ?? ''),
      selected: Array.isArray(item?.selected) ? item.selected.map(value => String(value)) : [],
      ...(typeof item?.custom === 'string' && item.custom !== '' ? { custom: item.custom } : {}),
    }))
    const known = new Set(entry.questions.map(question => question.id))
    if (list.length === 0 || list.some(item => !known.has(item.id))) {
      throw Object.assign(new Error('Answer every question with one of its options'), { code: 'bot/invalid' })
    }
    settle(entry.id, { answers: list })
    entry.resolve({ answers: list })
    return { answered: true }
  }

  rt.ctx.on('user-questions/request', rt.handleGroupQuestion)
  rt.groupQuestionsOpen = () => [...pending.values()].map(({ resolve: _resolve, ...entry }) => entry)
  rt.cancelGroupQuestions = (sessionId) => {
    for (const entry of [...pending.values()]) {
      if (entry.sessionId !== sessionId) continue
      if (settle(entry.id, { aborted: true }) !== undefined) entry.resolve(`cancelled:${entry.id}`)
    }
  }
}
