import assert from 'node:assert/strict'
import { test } from 'node:test'
import { install } from '../src/host/group-questions.js'

// An admin answers a group card the user is not at: the same resolve as the card's own
// buttons, so the same decision lands, and the row says who answered and why. "Always"
// is the user's own grant and stays theirs.

let n = 0
const bench = ({ admin = 'b' } = {}) => {
  // The pending set is shared by the module, so each bench names its own ask and Session.
  n += 1
  const sessionId = `gb-${n}`
  const questionId = `ask-${n}`
  const lines = []
  const rooms = { r1: { id: 'r1', admin } }
  const rt = {
    ctx: { get: () => ({ waits: new Map() }), on: () => {} },
    groupOwners: new Map([[sessionId, { roomId: 'r1', botId: 'b' }]]),
    roomOf: id => rooms[id],
    botOf: () => ({ id: 'b', name: 'Writer' }),
    logRoom: (_room, line) => lines.push(line),
    save: async () => {},
    warn: () => {},
    load: async () => {},
    teamTools: [],
  }
  install(rt)
  rt.answerAppAccessAsk = (id, decision) => {
    rt.noteAppAccessDone({ sessionId, questionId: id, answer: decision })
    return true
  }
  rt.noteAppAccessAsk({ sessionId, questionId, appName: 'Calculator' })
  return { rt, lines, sessionId, questionId }
}

const answers = lines => lines.filter(line => line.kind === 'group-question-answer')

test('the admin denies on the user\'s behalf and the row says who answered and why', () => {
  const { rt, lines, sessionId, questionId } = bench()
  const result = rt.answerGroupQuestionAsAdmin({ sessionId, questionId, decision: 'deny', reason: 'the Bot only needed the name' })
  assert.deepEqual(result, { answered: true, decision: 'deny', questionId })
  const [row] = answers(lines)
  assert.deepEqual([row.questionId, row.outcome, row.by, row.reason], [questionId, { answered: true, choice: 'deny' }, 'admin', 'the Bot only needed the name'])
})

test('the admin allows this time, and this time only', () => {
  const { rt, lines, sessionId, questionId } = bench()
  assert.equal(rt.answerGroupQuestionAsAdmin({ sessionId, questionId, decision: 'once', reason: 'reading one number' }).answered, true)
  assert.deepEqual(answers(lines).map(row => [row.outcome.choice, row.by]), [['once', 'admin']])
})

test('always is refused and the ask stays waiting', () => {
  const { rt, lines, sessionId, questionId } = bench()
  const result = rt.answerGroupQuestionAsAdmin({ sessionId, questionId, decision: 'always', reason: 'would save time' })
  assert.match(result.error, /Always is the user's own answer/)
  assert.equal(answers(lines).length, 0)
})

test('a Session that is not the group\'s admin is refused', () => {
  const { rt, lines, sessionId, questionId } = bench({ admin: 'someone-else' })
  const result = rt.answerGroupQuestionAsAdmin({ sessionId, questionId, decision: 'once', reason: 'x' })
  assert.match(result.error, /Only the group's admin/)
  assert.equal(answers(lines).length, 0)
})

test('a Session outside any group is refused', () => {
  const { rt, questionId } = bench()
  const result = rt.answerGroupQuestionAsAdmin({ sessionId: 'plain', questionId, decision: 'once', reason: 'x' })
  assert.match(result.error, /group member Session/)
})

test('a reason is required, and the ask is answered only once', () => {
  const { rt, lines, sessionId, questionId } = bench()
  assert.match(rt.answerGroupQuestionAsAdmin({ sessionId, questionId, decision: 'once', reason: '  ' }).error, /reason is required/)
  assert.equal(answers(lines).length, 0)
  assert.equal(rt.answerGroupQuestionAsAdmin({ sessionId, questionId, decision: 'once', reason: 'ok' }).answered, true)
  const second = rt.answerGroupQuestionAsAdmin({ sessionId, questionId, decision: 'deny', reason: 'again' })
  assert.match(second.error, /no longer waiting/)
  assert.equal(answers(lines).length, 1)
})

test('the tool is registered for Bot Sessions with its three arguments', () => {
  const { rt } = bench()
  const tool = rt.teamTools.find(entry => entry.name === 'answer_group_question')
  assert.ok(tool, 'the admin needs a tool to answer with')
  assert.deepEqual(Object.keys(tool.parameters.properties), ['questionId', 'decision', 'reason'])
  assert.deepEqual(tool.parameters.properties.decision.enum, ['deny', 'once', 'always'])
  assert.deepEqual(tool.parameters.required, ['questionId', 'decision', 'reason'])
})
