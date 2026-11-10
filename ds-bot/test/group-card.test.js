import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// The group card module draws with React; bundle it with React external and call its
// pure decisions directly (the drawing itself needs a browser).
const bundle = await build({
  stdin: { contents: "export { groupCardOf, groupCardMode, groupAnswerFor, submitGroupQuestion, submitGroupView, GroupCard } from './src/client/group-card.js'", resolveDir: dirname(dirname(fileURLToPath(import.meta.url))) },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  createContext: initial => ({ value: initial }), useContext: ctx => ctx.value,
  useState: initial => [initial, () => {}], useRef: current => ({ current }), useEffect: () => {}, useLayoutEffect: () => {},
  useId: () => 'id', useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}
runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: name => (name === 'react' ? react : {}) })
const { groupCardOf, groupCardMode, groupAnswerFor, submitGroupQuestion, submitGroupView, GroupCard } = module.exports

const room = (answers = []) => ({ id: 'r1', name: 'Ops', answers })
const questionReply = (overrides = {}) => ({
  kind: 'card', tool: 'ask_user', botId: 'writer', name: 'Writer', color: 'green', sessionId: 'room-writer',
  card: { id: 'q1', question: '现在编译吗？', options: [{ label: '现在编译' }, { label: '先不编译' }], multiSelect: false },
  time: 1,
  ...overrides,
})
const viewReply = (awaitReply, overrides = {}) => ({
  kind: 'card', tool: 'show_view', botId: 'writer', name: 'Writer', color: 'green', sessionId: 'room-writer',
  card: { id: 'v1', title: 'Pick', view: { type: 'text', text: 'hello' }, ...(awaitReply === undefined ? {} : { awaitReply }) },
  time: 1,
  ...overrides,
})

test('a member card belongs to the member group Session, and the group\'s own Session never shows one', () => {
  const entry = groupCardOf(questionReply(), room())
  assert.equal(entry.sessionId, 'room-writer')
  assert.equal(entry.card.id, 'q1')
  assert.equal(entry.tool, 'ask_user')
  // The group's own Session carries no member card.
  assert.equal(groupCardOf(questionReply({ sessionId: 'r1' }), room()), null)
  // Nor does a row that is not a card.
  assert.equal(groupCardOf({ kind: 'working', botId: 'writer' }, room()), null)
  assert.equal(GroupCard({ reply: questionReply({ sessionId: 'r1' }), room: room(), roster: {}, actions: {} }), null)
})

test('a question card is answerable until the group records its answer', () => {
  const asked = groupCardMode(questionReply(), room())
  assert.equal(asked.mode, 'question')
  const answered = groupCardMode(questionReply(), room([
    { questionId: 'q1', sessionId: 'room-writer', answer: { text: '现在编译', selected: ['现在编译'], custom: '' } },
  ]))
  assert.equal(answered.mode, 'question-settled')
  assert.equal(answered.answer.answer.text, '现在编译')
  // An answer to another card does not settle this one.
  assert.equal(groupAnswerFor('q2', room([{ questionId: 'q1' }])), undefined)
  // A card from another member is not this member's card.
  assert.equal(groupCardMode(questionReply(), room([{ questionId: 'q1', sessionId: 'room-chief', answer: { text: 'x' } }])).mode, 'question')
})

test('a view card is interactive only when it waits, and settled once answered', () => {
  assert.equal(groupCardMode(viewReply(true), room()).mode, 'view')
  assert.equal(groupCardMode(viewReply(false), room()).mode, 'view-readonly')
  assert.equal(groupCardMode(viewReply(undefined), room()).mode, 'view-readonly')
  const settled = groupCardMode(viewReply(true), room([{ questionId: 'v1', sessionId: 'room-writer', answer: { text: 'submit {"a":1}' } }]))
  assert.equal(settled.mode, 'view-settled')
})

test('a card the host no longer keeps is closed, not answerable', () => {
  assert.equal(groupCardMode(questionReply(), room(), { questions: {}, views: {} }).mode, 'question-closed')
  assert.equal(groupCardMode(questionReply(), room(), { questions: { 'room-writer': { id: 'q1' } }, views: {} }).mode, 'question')
  assert.equal(groupCardMode(viewReply(true), room(), { questions: {}, views: {} }).mode, 'view-closed')
  assert.equal(groupCardMode(viewReply(true), room(), { questions: {}, views: { 'room-writer': { id: 'v1' } } }).mode, 'view')
})

test('the answer is sent to the member group Session, never the group id', () => {
  const calls = []
  const actions = {
    answerQuestion: (...args) => calls.push(['question', ...args]),
    answerView: (...args) => calls.push(['view', ...args]),
  }
  const entry = groupCardOf(questionReply(), room())
  submitGroupQuestion(actions, entry, { selected: ['现在编译'], custom: '' })
  const view = groupCardOf(viewReply(true), room())
  submitGroupView(actions, view, 'submit', { a: 1 })
  // The module builds the answer object in its own realm; compare its data, not its identity.
  assert.deepEqual(calls.map(entry => entry.slice(0, 3)), [
    ['question', 'room-writer', 'q1'],
    ['view', 'room-writer', 'v1'],
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][3])), { selected: ['现在编译'], custom: '' })
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].slice(3))), ['submit', { a: 1 }])
})
