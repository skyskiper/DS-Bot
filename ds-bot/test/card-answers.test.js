import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CARD_ANSWERS_KEPT, cardAnswersOf, recordCardAnswer } from '../src/host/card-answers.js'

// A room as the host keeps it: its latest log lines, and the answers kept with it.
const room = (log = [], cardAnswers = undefined) => ({ id: 'r1', log, ...(cardAnswers === undefined ? {} : { cardAnswers }) })
const line = (seq, text = `line ${seq}`) => ({ who: 'M', seq, text, time: seq })
const answer = (overrides = {}) => ({
  tool: 'ask_user', sessionId: 'room-writer', botId: 'writer', questionId: 'q1',
  text: 'Writer asked: 现在编译吗？\nThe user answered: 先不编译',
  answer: { selected: ['先不编译'] }, time: 10, ...overrides,
})

test('an answer kept with the room outlives the log it was written to', () => {
  const kept = room([], [])
  recordCardAnswer(kept, answer())
  // The room moved on: its log now holds 60 later lines, none of them the answer's.
  kept.log = Array.from({ length: 60 }, (_, index) => line(index + 10))
  const answers = cardAnswersOf(kept)
  assert.equal(answers.length, 1)
  assert.equal(answers[0].questionId, 'q1')
  assert.equal(answers[0].answer.selected[0], '先不编译')
  assert.match(answers[0].text, /The user answered: 先不编译/)
})

test('a room saved before answers were kept still reads them from its log', () => {
  const answers = cardAnswersOf(room([line(1), { ...answer(), who: 'User', kind: 'card-answer', seq: 2, length: 40 }, line(3)]))
  assert.equal(answers.length, 1)
  assert.equal(answers[0].questionId, 'q1')
  // The log's own fields do not leak into what the client reads.
  for (const key of ['who', 'kind', 'seq', 'length']) assert.equal(key in answers[0], false, key)
  // A kept answer is not listed twice because the log still holds its line.
  const both = room([{ ...answer(), who: 'User', kind: 'card-answer', seq: 2 }], [answer()])
  assert.equal(cardAnswersOf(both).length, 1)
})

test('a card nothing was recorded for reads as no answer, not as a failure', () => {
  assert.deepEqual(cardAnswersOf({ log: [] }), [])
  assert.deepEqual(cardAnswersOf({}), [])
  assert.deepEqual(cardAnswersOf(null), [])
  assert.deepEqual(cardAnswersOf({ cardAnswers: 'nonsense', log: [line(1), null, 7, { who: 'User', kind: 'notice', text: 'x' }] }), [])
  assert.deepEqual(cardAnswersOf({ cardAnswers: [{ questionId: 'q1' }, null, { sessionId: 's' }], log: [] }).length, 1)
})

test('a second answer to one card replaces the first, and only the newest are kept', () => {
  const kept = room()
  recordCardAnswer(kept, answer({ answer: { selected: ['先不编译'], text: '先不编译' } }))
  recordCardAnswer(kept, answer({ answer: { selected: ['现在编译'], text: '现在编译' } }))
  const answers = cardAnswersOf(kept)
  assert.equal(answers.length, 1)
  assert.equal(answers[0].answer.text, '现在编译')
  for (let index = 0; index < CARD_ANSWERS_KEPT + 5; index += 1) recordCardAnswer(kept, answer({ questionId: `q${index}`, time: 100 + index }))
  assert.equal(kept.cardAnswers.length, CARD_ANSWERS_KEPT)
  assert.equal(cardAnswersOf(kept).at(-1).questionId, `q${CARD_ANSWERS_KEPT + 4}`)
  // A write that carries no card id records nothing, so a log line cannot be mistaken
  // for a card the client can find.
  recordCardAnswer(kept, answer({ questionId: undefined }))
  assert.equal(kept.cardAnswers.length, CARD_ANSWERS_KEPT)
})
