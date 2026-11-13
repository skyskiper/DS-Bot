import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/group-questions.js'

// The group gets a way into a question a member is waiting on: a card in the room's book
// that opens the Bot's own chat, settled once the question is gone. The pending set is read
// defensively from DSH's own service, which has no public accessor.
const room = { id: 'r1', name: 'Ops' }

const bench = (waits) => {
  const lines = []
  const rt = {
    ctx: { get: () => (waits === undefined ? undefined : { waits }), on: () => {} },
    groupOwners: new Map([['gb', { roomId: 'r1', botId: 'b' }]]),
    roomOf: id => (id === 'r1' ? room : undefined),
    botOf: () => ({ id: 'b', name: 'Writer' }),
    logRoom: (_room, line) => lines.push(line),
    save: async () => {},
    warn: () => {},
  }
  install(rt)
  return { rt, lines }
}

const pending = (id, sessionId = 'gb') => {
  const agent = { session: { id: sessionId } }
  return { agent, calls: new Map([[id, { callId: id }]]) }
}

test('a waiting group question becomes one card, however often the state is read', () => {
  const { agent, calls } = pending('c1')
  const { rt, lines } = bench(new Map([[agent, calls]]))
  rt.groupQuestionsSync()
  rt.groupQuestionsSync()
  const cards = lines.filter(line => line.kind === 'group-question')
  assert.equal(cards.length, 1)
  assert.deepEqual([cards[0].sessionId, cards[0].botId, cards[0].questionId, cards[0].who], ['gb', 'b', 'c1', 'Writer'])
})

test('a question that is gone settles its card', () => {
  const { agent, calls } = pending('c1')
  const waits = new Map([[agent, calls]])
  const { rt, lines } = bench(waits)
  rt.groupQuestionsSync()
  calls.delete('c1')
  rt.groupQuestionsSync()
  const settled = lines.filter(line => line.kind === 'group-question-answer')
  assert.deepEqual(settled.map(line => [line.sessionId, line.questionId]), [['gb', 'c1']])
  // And it is not settled twice.
  rt.groupQuestionsSync()
  assert.equal(lines.filter(line => line.kind === 'group-question-answer').length, 1)
})

test('a Session outside a group gets no card', () => {
  const privateAgent = pending('c9', 'own')
  const { rt, lines } = bench(new Map([[privateAgent.agent, privateAgent.calls]]))
  rt.groupQuestionsSync()
  assert.equal(lines.length, 0)
})

test('a service that cannot be read writes nothing and does not throw', () => {
  for (const waits of [undefined, 'nope', { not: 'a map' }]) {
    const { rt, lines } = bench(undefined)
    rt.ctx.get = () => (waits === undefined ? undefined : { waits })
    assert.doesNotThrow(() => rt.groupQuestionsSync())
    assert.equal(lines.length, 0)
  }
})

// The event is the data source that covers cua's untimed ask and timed asks alike: the
// card goes in at the moment the question is raised, and the answer still belongs to DSH.
const eventBench = () => {
  const lines = []
  const handlers = new Map()
  const rt = {
    ctx: { get: () => undefined, on: (name, fn) => { handlers.set(name, fn) } },
    groupOwners: new Map([['gb', { roomId: 'r1', botId: 'b' }]]),
    roomOf: id => (id === 'r1' ? room : undefined),
    botOf: () => ({ id: 'b', name: 'Writer' }),
    logRoom: (_room, line) => lines.push(line),
    save: async () => {},
    warn: () => {},
  }
  install(rt)
  return { rt, lines, handler: handlers.get('user-questions/request') }
}

test('a question raised on the event becomes a card in the room', async () => {
  const { lines, handler } = eventBench()
  let passed = false
  await handler({ agent: { session: { id: 'gb' } }, questions: [{ id: 'cua-app-access' }] }, () => { passed = true })
  assert.equal(passed, true, 'the request is passed on untouched: the answer stays with DSH')
  const card = lines.find(line => line.kind === 'group-question')
  assert.deepEqual([card.sessionId, card.botId], ['gb', 'b'])
  assert.match(card.questionId, /^cua-app-access-/)
})

test('a question outside a group writes nothing', async () => {
  const { lines, handler } = eventBench()
  await handler({ agent: { session: { id: 'own' } }, questions: [{ id: 'q' }] }, () => {})
  assert.equal(lines.length, 0)
})

// The pending set holds timed asks only, so reading it as "the question is gone" would
// settle a card raised from an untimed ask (cua's) before anyone answered it. The state
// read runs every 1.5 s while the window is open, so that would be the card's first paint.
test('an untimed ask is not settled by a state read while it is open', () => {
  const lines = []
  const handlers = new Map()
  const waits = new Map()
  const rt = {
    ctx: { get: () => ({ waits }), on: (name, fn) => { handlers.set(name, fn) } },
    groupOwners: new Map([['ga', { roomId: 'r1', botId: 'b' }]]),
    roomOf: id => (id === 'r1' ? room : undefined),
    botOf: () => ({ id: 'b', name: 'Writer' }),
    logRoom: (_room, line) => lines.push(line),
    save: async () => {},
    warn: () => {},
  }
  install(rt)
  handlers.get('user-questions/request')({ agent: { session: { id: 'ga' } }, questions: [{ id: 'cua-app-access' }] }, () => new Promise(() => {}))
  rt.groupQuestionsSync()
  rt.groupQuestionsSync()
  assert.deepEqual(lines.map(line => line.kind), ['group-question'])
})

// The card DS Bot asks for an app in the Bot's own chat: the group's observer never sees
// that request, so the card is taken from the ask, and the ask's own id settles it.
test('an app access ask becomes a card and goes away with the answer', () => {
  const { rt, lines } = bench(new Map())
  rt.noteAppAccessAsk({ sessionId: 'gb', botId: 'b', questionId: 'ask-1', appName: '计算器' })
  assert.equal(lines.find(line => line.kind === 'group-question')?.app, '计算器')
  rt.groupQuestionsSync()
  assert.deepEqual(lines.map(line => line.kind), ['group-question'])
  rt.noteAppAccessDone({ sessionId: 'gb', questionId: 'ask-1', answer: 'once' })
  const answer = lines.find(line => line.kind === 'group-question-answer')
  assert.deepEqual([answer.sessionId, answer.questionId, answer.who, answer.outcome], ['gb', 'ask-1', 'Writer', { answered: true, choice: 'once' }])
  // Every question gets its own card, not the first one's place.
  rt.noteAppAccessAsk({ sessionId: 'gb', botId: 'b', questionId: 'ask-2', appName: 'Notes' })
  assert.deepEqual(lines.filter(line => line.kind === 'group-question').map(line => line.questionId), ['ask-1', 'ask-2'])
})

test('an app access ask outside a group writes nothing', () => {
  const { rt, lines } = bench(new Map())
  rt.noteAppAccessAsk({ sessionId: 'own', botId: 'b', questionId: 'ask-3', appName: 'Notes' })
  assert.equal(lines.length, 0)
})

// The group's own buttons answer the same ask the Bot's chat draws, so the session
// decision (or an "always" grant) lands as if it were clicked there, and the row says
// which answer it was.
test('the group answers the ask in place, once', () => {
  const { rt, lines } = bench(new Map())
  const asked = []
  rt.answerAppAccessAsk = (id, decision) => {
    asked.push([id, decision])
    rt.noteAppAccessDone({ sessionId: 'gb', questionId: id, answer: decision })
    return true
  }
  rt.noteAppAccessAsk({ sessionId: 'gb', questionId: 'ask-9', appName: '计算器' })
  assert.equal(rt.answerGroupQuestion('ask-9', 'once'), true)
  assert.deepEqual(asked, [['ask-9', 'once']])
  const answer = lines.find(line => line.kind === 'group-question-answer')
  assert.deepEqual([answer.sessionId, answer.questionId, answer.outcome], ['gb', 'ask-9', { answered: true, choice: 'once' }])
  // The ask is gone, so a second click is refused instead of writing a second row.
  assert.equal(rt.answerGroupQuestion('ask-9', 'deny'), false)
  assert.equal(lines.filter(line => line.kind === 'group-question-answer').length, 1)
})

test('a question the group does not hold, or an answer it does not offer, writes nothing', () => {
  const { rt, lines } = bench(new Map())
  assert.equal(rt.answerGroupQuestion('unknown', 'once'), false)
  rt.noteAppAccessAsk({ sessionId: 'gb', questionId: 'ask-8', appName: 'Calculator' })
  assert.equal(rt.answerGroupQuestion('ask-8', 'maybe'), false)
  assert.equal(lines.filter(line => line.kind === 'group-question-answer').length, 0)
})
