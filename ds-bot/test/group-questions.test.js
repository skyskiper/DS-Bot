import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/group-questions.js'

// A group member's Session is hidden: its question card is answered from the room's book.
const room = { id: 'r1', name: 'Ops' }
const request = (over = {}) => ({
  agent: { session: { id: 'gb' } },
  signal: new AbortController().signal,
  questions: [{
    id: 'cua-app-access',
    question: 'Allow Computer Use to control CuoCuo?',
    options: [{ label: 'Allow for this task' }, { label: 'Always allow' }, { label: 'Deny' }],
  }],
  ...over,
})

const bench = () => {
  const lines = []
  const listener = { on: undefined, options: undefined }
  const rt = {
    ctx: { on: (name, fn, options) => { if (name === 'user-questions/request') { listener.on = fn; listener.options = options } } },
    groupOwners: new Map([['gb', { roomId: 'r1', botId: 'b' }]]),
    roomOf: id => (id === 'r1' ? room : undefined),
    botOf: () => ({ id: 'b', name: 'Writer' }),
    logRoom: (_room, line) => lines.push(line),
    save: async () => {},
  }
  install(rt)
  return { rt, lines, listener, ask: (req) => listener.on(req, () => Promise.reject(new Error('next'))) }
}

test('a group question becomes a card in the room instead of failing', async () => {
  const { rt, lines, ask } = bench()
  const pending = ask(request())
  const card = lines.find(line => line.kind === 'group-question')
  assert.ok(card, 'the room gets a card line')
  assert.deepEqual(card.questions, request().questions, 'the options are the asker’s, verbatim')
  assert.deepEqual([rt.groupQuestionsOpen().length, lines.filter(line => line.kind === 'stalled').length], [1, 0])
  rt.answerGroupQuestion(card.requestId, [{ id: 'cua-app-access', selected: ['Always allow'] }])
  assert.deepEqual(await pending, { answers: [{ id: 'cua-app-access', selected: ['Always allow'] }] })
  assert.deepEqual(lines.at(-1).kind, 'group-question-answer')
})

test('the listener takes its place ahead of DSH’s own answerer', () => {
  const { listener } = bench()
  assert.deepEqual(listener.options, { prepend: true, global: true })
})

test('a Session that is not a group keeps DSH’s own card', async () => {
  const { lines, ask } = bench()
  const requestOther = request({ agent: { session: { id: 'own' } } })
  await assert.rejects(() => ask(requestOther), /next/)
  assert.equal(lines.length, 0)
})

test('answering a question that already closed reports it as stale', async () => {
  const { rt, lines, ask } = bench()
  const pending = ask(request())
  const card = lines.find(line => line.kind === 'group-question')
  rt.answerGroupQuestion(card.requestId, [{ id: 'cua-app-access', selected: ['Deny'] }])
  await pending
  assert.throws(() => rt.answerGroupQuestion(card.requestId, [{ id: 'cua-app-access', selected: ['Deny'] }]), error => error?.code === 'bot/stale')
})

test('an aborted question closes its card and answers nothing', async () => {
  const { rt, lines, ask } = bench()
  const controller = new AbortController()
  const pending = ask(request({ signal: controller.signal }))
  const card = lines.find(line => line.kind === 'group-question')
  controller.abort()
  await assert.rejects(() => pending, error => error?.code === 'ASK_CANCELLED')
  assert.deepEqual(rt.groupQuestionsOpen(), [])
  assert.equal(lines.some(line => line.kind === 'group-question-answer'), true)
  assert.throws(() => rt.answerGroupQuestion(card.requestId, [{ id: 'cua-app-access', selected: ['Deny'] }]), error => error?.code === 'bot/stale', 'no answer after the abort')
})

