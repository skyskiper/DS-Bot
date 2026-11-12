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
    ctx: { get: () => (waits === undefined ? undefined : { waits }) },
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
