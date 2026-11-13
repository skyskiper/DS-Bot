import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// A group's question card answers in place: the three options its Bot's own card offers,
// and the row settles the moment the host accepts one. The same mount as the approval row:
// hooks re-render the way React does, so a click is followed from one state to the next.
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { JSDOM } = createRequire(join(process.env.DSH_HARNESS ?? join(PLUGIN, '..', 'deepseek-harness'), 'package.json'))('jsdom')

const bundle = await build({
  stdin: { contents: "export { GroupQuestionRow } from './src/client/cells.js'", resolveDir: PLUGIN },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

let rendering = null
const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
function mount(Component, props) {
  const states = new Map()
  const mounted = { tree: null }
  const render = () => {
    const expand = (node, path) => {
      if (node === null || typeof node !== 'object') return node
      if (typeof node.type === 'function') {
        const slots = states.get(path) ?? []
        slots.cursor = 0
        states.set(path, slots)
        rendering = { slots, path, draw: render }
        const drawn = node.type(node.props)
        rendering = null
        return expand(drawn, path)
      }
      return { ...node, children: (node.children ?? []).map((child, index) => expand(child, `${path}.${index}`)) }
    }
    mounted.tree = expand(createElement(Component, props), 'root')
  }
  mounted.draw = render
  render()
  return mounted
}
const hook = (initial) => {
  const at = rendering.slots.cursor++
  if (!(at in rendering.slots)) rendering.slots[at] = typeof initial === 'function' ? initial() : initial
  return { slots: rendering.slots, at, value: rendering.slots[at], draw: rendering.draw }
}
const react = {
  createElement,
  Fragment: 'Fragment',
  createContext: value => ({ value, Provider: 'Provider', Consumer: 'Consumer' }),
  useContext: context => context?.value,
  useState(initial) {
    const { slots, at, value, draw } = hook(initial)
    return [value, (next) => {
      slots[at] = typeof next === 'function' ? next(slots[at]) : next
      draw()
    }]
  },
  useRef: initial => hook({ current: initial }).value,
  useMemo: factory => hook(factory).value,
  useCallback: fn => hook(fn).value,
  useEffect() {},
  useLayoutEffect() {},
  useId: () => 'id',
  useSyncExternalStore: (subscribe, snapshot) => snapshot(),
}
const { window } = new JSDOM('<main id="chat"></main>')
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module,
  exports: module.exports,
  require: name => (name === 'react' ? react : {}),
  document: window.document,
  Element: window.Element,
  MouseEvent: window.MouseEvent,
})
const { GroupQuestionRow } = module.exports

const nodes = (tree, out = []) => {
  if (tree === null || tree === undefined || typeof tree !== 'object') return out
  out.push(tree)
  for (const child of tree.children ?? []) nodes(child, out)
  return out
}
const texts = (tree) => nodes(tree).map(node => (node.children ?? []).filter(child => typeof child === 'string').join('')).filter(Boolean)
const buttons = (tree) => nodes(tree).filter(node => node.type === 'button')
const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }

const bot = { id: 'b1', name: 'Writer', color: 'green' }
const reply = { kind: 'group-question', botId: 'b1', sessionId: 'gb', questionId: 'q1', app: 'Calculator' }
const actionsFor = (calls, answer = () => Promise.resolve({ answered: true })) => ({
  answerGroupQuestion: (questionId, decision) => { calls.push([questionId, decision]); return answer(questionId, decision) },
  openSession: id => calls.push(['open', id]),
})

test('the group card offers the three answers and settles on This time', async () => {
  const calls = []
  const row = mount(GroupQuestionRow, { reply, bot, botKnown: true, actions: actionsFor(calls) })
  assert.deepEqual(texts(row.tree), ['Writer', 'Writer is waiting for your answer in its own chat.', 'Deny', 'This time', 'Always', 'Open Writer’s chat'])

  buttons(row.tree).find(button => texts(button).join('') === 'This time').props.onClick()
  await settle()
  assert.deepEqual(calls, [['q1', 'once']])
  assert.deepEqual(texts(row.tree), ['Writer', 'Writer is waiting for your answer in its own chat.', 'Answered.', 'Open Writer’s chat'])
  assert.equal(buttons(row.tree).length, 1, 'only the way into the chat is left')
})

test('Deny and Always send their own decision', async () => {
  for (const [label, decision] of [['Deny', 'deny'], ['Always', 'always']]) {
    const calls = []
    const row = mount(GroupQuestionRow, { reply, bot, botKnown: true, actions: actionsFor(calls) })
    buttons(row.tree).find(button => texts(button).join('') === label).props.onClick()
    await settle()
    assert.deepEqual(calls, [['q1', decision]])
  }
})

test('an ask that is already gone settles without a second write', async () => {
  const calls = []
  const gone = () => Promise.reject(new Error('This question is no longer waiting for an answer'))
  const row = mount(GroupQuestionRow, { reply, bot, botKnown: true, actions: actionsFor(calls, gone) })
  buttons(row.tree).find(button => texts(button).join('') === 'This time').props.onClick()
  await settle()
  assert.deepEqual(calls, [['q1', 'once']])
  assert.ok(texts(row.tree).includes('Answered.'))
  assert.equal(buttons(row.tree).length, 1, 'the three answers are gone, so nothing can be written twice')
})

test('a settled row from the ledger keeps only the way into the chat', () => {
  const row = mount(GroupQuestionRow, { reply, bot, botKnown: true, actions: actionsFor([]), settled: true })
  assert.deepEqual(texts(row.tree), ['Writer', 'Writer is waiting for your answer in its own chat.', 'Answered.', 'Open Writer’s chat'])
})

test('without an answer action the card still leads to the chat', () => {
  const calls = []
  const row = mount(GroupQuestionRow, { reply, bot, botKnown: true, actions: { openSession: id => calls.push(['open', id]) } })
  assert.deepEqual(texts(row.tree), ['Writer', 'Writer is waiting for your answer in its own chat.', 'Open Writer’s chat'])
})
