import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retireOwnChatQuestion } from '../src/host/turns.js'
import { needsOf } from '../src/client/needs.js'

// A question card is only worth showing while it is fresh and while the Bot has not moved
// on: 14 unanswered cards from 11-06 onward sat in "Needs you" and read as a broken list.

const bench = (questions = {}) => {
  const closed = []
  const state = { questions: { ...questions } }
  const rt = {
    selfOf: id => (id.startsWith('group-') ? `bot-${id.slice(6)}` : undefined),
    chatOf: botId => `own-${botId}`,
    closeCard: (id, card, reason) => closed.push([id, card.id, reason]),
  }
  return { rt, state, closed }
}

test('a Bot told something in its group retires the question left in its own chat', () => {
  const { rt, state, closed } = bench({ 'own-bot-a': { id: 'q1', question: 'Where do we start?' } })
  assert.equal(retireOwnChatQuestion(rt, state, 'group-a'), true)
  assert.deepEqual(closed, [['own-bot-a', 'q1', 'replied']])
  assert.equal(state.questions['own-bot-a'], undefined)
  // The card is gone, so a second message changes nothing.
  assert.equal(retireOwnChatQuestion(rt, state, 'group-a'), false)
  assert.equal(closed.length, 1)
})

test('its own chat keeps the card it is being written into', () => {
  const { rt, state, closed } = bench({ 'own-bot-a': { id: 'q1', question: 'Where do we start?' } })
  rt.selfOf = () => 'bot-a'
  // selfOf returns the Bot for its own chat too; the caller clears that one itself.
  assert.equal(retireOwnChatQuestion(rt, state, 'own-bot-a'), false)
  assert.equal(closed.length, 0)
  assert.ok(state.questions['own-bot-a'])
})

test('a Session that is not a Bot retires nothing', () => {
  const { rt, state } = bench({ 'own-x': { id: 'q1', question: 'x' } })
  assert.equal(retireOwnChatQuestion(rt, state, 'plain-session'), false)
})

test('Needs you drops a question older than a day and keeps a fresh one', () => {
  const now = 1_800_000_000_000
  const roster = {
    bots: [{ id: 'own-a' }, { id: 'own-b' }],
    rooms: [],
    questions: {
      'own-a': { id: 'qa', question: 'old', askedAt: now - 25 * 60 * 60 * 1000 },
      'own-b': { id: 'qb', question: 'fresh', askedAt: now - 60 * 60 * 1000 },
    },
  }
  assert.deepEqual(needsOf(roster, [], now).map(item => [item.botId, item.text]), [['own-b', 'fresh']])
})

test('an approval waits for as long as it stands', () => {
  const now = 1_800_000_000_000
  const roster = { bots: [], rooms: [], questions: {} }
  const items = needsOf(roster, [{ id: 'a1', botId: 'b', tool: 'pwsh', at: now - 30 * 60 * 60 * 1000 }], now)
  assert.deepEqual(items.map(item => [item.kind, item.text]), [['approval', 'pwsh']])
})
