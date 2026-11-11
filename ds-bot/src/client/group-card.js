import { createElement as h, useState } from 'react'
import { QuestionView, SettledQuestion } from './questions.js'
import { ViewCard } from './widget-cell.js'
import { BotMark } from './mark.js'
import { t } from './i18n.js'

// A card a group member asked in its turn: the round's replies carry it (host: groups.js
// groupCardAsked). The card belongs to the member's own group Session, so an answer must
// name that Session — never the group's own one.
export function groupCardOf(reply, room) {
  if (room === undefined || room === null) return null
  if (reply?.kind !== 'card' || reply.sessionId === room.id) return null
  const card = reply.card
  if (card === null || typeof card !== 'object' || typeof card.id !== 'string') return null
  return { tool: reply.tool === 'show_view' ? 'show_view' : 'ask_user', card, sessionId: reply.sessionId, botId: reply.botId }
}

// What the group recorded after the user answered this card (room.answers), if anything.
export function groupAnswerFor(cardId, room) {
  return (room?.answers ?? []).find(answer => answer.questionId === cardId)
}

// The host marks a card it closed without an answer on the card itself
// (state.closedCards, by the asking Session and the card's call id).
const closedOutcome = (roster, entry) =>
  entry.card.callId === undefined ? undefined : roster?.closedCards?.[entry.sessionId]?.[entry.card.callId]

// `history` draws a card read back from an earlier part: it never offers an answer
// the host no longer keeps, and a card with no answer and no close reads as one
// nothing was recorded for, instead of guessing how it ended.
export function groupCardMode(reply, room, roster, { history = false } = {}) {
  const entry = groupCardOf(reply, room)
  if (entry === null) return null
  const answer = groupAnswerFor(entry.card.id, room)
  if (answer !== undefined && answer.sessionId === entry.sessionId) {
    return { ...entry, answer, mode: entry.tool === 'ask_user' ? 'question-settled' : 'view-settled' }
  }
  if (entry.tool === 'ask_user') {
    // A roster not yet loaded tells nothing, so the card stays answerable.
    if (roster === undefined || roster.questions?.[entry.sessionId]?.id === entry.card.id) return { ...entry, mode: 'question' }
    if (closedOutcome(roster, entry) !== undefined) return { ...entry, mode: 'question-closed' }
    return { ...entry, mode: history ? 'question-unanswered' : 'question-closed' }
  }
  if (entry.card.awaitReply === true && (roster === undefined || roster.views?.[entry.sessionId]?.id === entry.card.id)) {
    return { ...entry, mode: 'view' }
  }
  if (!history && entry.card.awaitReply === true) return { ...entry, mode: 'view-closed' }
  return { ...entry, mode: 'view-readonly' }
}

// The answer goes to the member's group Session, which the card names.
export const submitGroupQuestion = (actions, entry, answer) =>
  actions.answerQuestion(entry.sessionId, entry.card.id, { selected: answer?.selected ?? [], custom: answer?.custom ?? '' })
export const submitGroupView = (actions, entry, action, values) =>
  actions.answerView(entry.sessionId, entry.card.id, action, values)

const answerTextOf = answer => {
  if (typeof answer?.text === 'string' && answer.text !== '') return answer.text
  const values = [...(answer?.selected ?? []), ...(answer?.custom ? [answer.custom] : [])]
  return values.length > 0 ? values.join(', ') : t('(skipped)')
}

function GroupCardBody({ entry, room, actions }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(null)
  const answered = sent ?? groupAnswerFor(entry.card.id, room)
  const run = (make, done) => {
    if (busy) return
    setBusy(true)
    setError('')
    void Promise.resolve().then(make).then(() => done(), (failure) => {
      // A failed answer stays visible and the card stays usable.
      setError(String(failure?.message ?? failure))
    }).finally(() => setBusy(false))
  }
  if (entry.mode === 'question-closed' || entry.mode === 'view-closed') {
    return h('div', { className: 'bt-gcard-body' },
      h(SettledQuestion, { question: entry.tool === 'ask_user' ? entry.card : { question: entry.card.title ?? t('View') }, closed: 'dismissed' }))
  }
  // An earlier part with nothing recorded for the card: the question, and no answer.
  if (entry.mode === 'question-unanswered') {
    return h('div', { className: 'bt-gcard-body' }, h(SettledQuestion, { question: entry.card, closed: 'unanswered' }))
  }
  if (answered !== undefined && answered !== null) {
    // room.answers keeps the log line and, under `answer`, what the user chose.
    const chosen = answered.answer ?? answered
    return h('div', { className: 'bt-gcard-body' },
      entry.tool === 'ask_user'
        ? h(SettledQuestion, { question: entry.card, answer: { selected: chosen.selected ?? [], custom: chosen.custom ?? '' } })
        : h('div', { className: 'bt-gcard-settled' }, entry.card.title ?? t('View')),
      h('div', { className: 'bt-gcard-answer' }, t('The user answered: {answer}', { answer: answerTextOf(chosen) })))
  }
  if (entry.tool === 'ask_user') {
    return h('div', { className: 'bt-gcard-body' },
      h(QuestionView, {
        question: entry.card,
        busy,
        ownAnswer: entry.card.allowCustom === true,
        onAnswer: answer => run(() => submitGroupQuestion(actions, entry, answer), () => setSent({ ...answer, text: answerTextOf(answer) })),
        onDismiss: () => actions.dismissQuestion?.(entry.sessionId),
      }),
      error !== '' ? h('div', { className: 'bt-gcard-error', role: 'alert' }, t('Could not send the answer: {error}', { error })) : null)
  }
  if (entry.mode !== 'view') {
    // A display-only view: read-only, no answer of any kind.
    return h('div', { className: 'bt-gcard-body' }, h(ViewCard, { title: entry.card.title ?? '', view: entry.card.view }))
  }
  return h('div', { className: 'bt-gcard-body' },
    h(ViewCard, {
      title: entry.card.title ?? '',
      view: entry.card.view,
      busy,
      onSubmit: (action, values) => run(
        () => submitGroupView(actions, entry, action, values),
        () => setSent({ text: `${action}${values === undefined || values === null ? '' : ` ${JSON.stringify(values)}`}`, action, values: values ?? null }),
      ),
      onDismiss: () => actions.dismissView?.(entry.sessionId),
    }),
    error !== '' ? h('div', { className: 'bt-gcard-error', role: 'alert' }, t('Could not send the answer: {error}', { error })) : null)
}

// One card under the member that asked it, inside the group timeline.
export function GroupCard({ reply, room, roster, actions, history = false }) {
  const entry = groupCardMode(reply, room, roster, { history })
  if (entry === null) return null
  const bot = roster?.byId?.[entry.botId] ?? { id: entry.botId, name: reply.name ?? '', color: reply.color }
  return h('div', { className: 'bt-gcard', 'data-tool': entry.tool },
    h('div', { className: 'bt-gcard-head' },
      h(BotMark, { bot, size: 22 }),
      h('span', { className: 'bt-gcard-name' }, bot.name ?? '')),
    h(GroupCardBody, { entry, room, actions }))
}

export const GROUP_CARD_CSS = `
.bt-gcard{margin:6px 0 6px 0;padding:10px 12px 12px;border:1px solid var(--bt-line);border-radius:12px;background:var(--bt-card);max-width:var(--dsh-chat-content-width,748px);box-sizing:border-box}
.bt-gcard-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;color:var(--bt-ink-2);font-size:12px;line-height:16px}
.bt-gcard-name{font-weight:500;color:var(--bt-ink)}
.bt-gcard-body .bt-q{margin:0}
.bt-gcard-answer{margin-top:8px;font-size:12px;line-height:18px;color:var(--bt-ink-2)}
.bt-gcard-error{margin-top:8px;font-size:12px;line-height:18px;color:var(--bt-danger,var(--bt-ink))}
.bt-gcard-settled{font-size:13px;line-height:20px;color:var(--bt-ink-2)}
`
