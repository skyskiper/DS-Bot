import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The group chat draws a member's approval in the group itself. The rows draw with React;
// bundle the two row components with React external and mount them with hooks that
// re-render the way React does, so a click can be followed from one state to the next.
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { JSDOM } = createRequire(join(process.env.DSH_HARNESS ?? join(PLUGIN, '..', 'deepseek-harness'), 'package.json'))('jsdom')

const bundle = await build({
  stdin: { contents: "export { RelayEvent, ApprovalRow } from './src/client/cells.js'", resolveDir: PLUGIN },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

let rendering = null
const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
// One mounted row: hook state kept per component in the tree, re-rendered from the top when
// a click changes it, as React does. Only what these two rows use is implemented.
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
  useRef(initial) {
    return hook({ current: initial }).value
  },
  useMemo(factory) {
    return hook(factory).value
  },
  useCallback(fn) {
    return hook(fn).value
  },
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
const { RelayEvent } = module.exports

// Everything a tree draws, in order, as nodes.
const nodes = (tree, out = []) => {
  if (tree === null || tree === undefined || typeof tree !== 'object') return out
  out.push(tree)
  for (const child of tree.children ?? []) nodes(child, out)
  return out
}
const classesOf = (node) => String(node.props?.className ?? '').split(/\s+/).filter(Boolean)
const buttons = (tree) => nodes(tree).filter(node => node.type === 'button')
const texts = (tree) => nodes(tree).map(node => {
  const own = (node.children ?? []).filter(child => typeof child === 'string' || typeof child === 'number')
  return own.join('')
}).filter(Boolean)
const settle = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve() }

const bot = { id: 'b', name: 'Writer', role: 'Write', color: 'green' }
const approvalReply = (over = {}) => ({
  kind: 'approval', botId: 'b', name: 'Writer', color: 'green', sessionId: 'gb',
  approvalId: 'a1', tool: 'pwsh', reason: 'run the tests', time: 1, ...over,
})

test('a group approval asks with Reject and Allow once, and allowing settles the row', async () => {
  const asked = []
  const actions = { answerApproval: (id, choice) => { asked.push([id, choice]); return Promise.resolve() } }
  const row = mount(RelayEvent, { reply: approvalReply(), bot, sessionId: 'gb', actions })

  assert.deepEqual(texts(row.tree), ['Writer', 'pwsh', 'run the tests', 'Reject', 'Allow once'])
  assert.deepEqual(buttons(row.tree).map(button => classesOf(button)), [
    ['bt-soft', 'bt-soft-sm'], ['bt-soft', 'bt-soft-sm'],
  ])
  assert.equal(nodes(row.tree)[0].props['data-tool'], 'pwsh')

  buttons(row.tree)[1].props.onClick()
  await settle()
  assert.deepEqual(asked, [['a1', 'allow']])
  assert.deepEqual(texts(row.tree), ['Writer', 'pwsh', 'run the tests', 'You allowed it.'])
  assert.deepEqual(buttons(row.tree), [], 'a settled row keeps no clickable card')
})

test('rejecting asks the host for a rejection and settles the same way', async () => {
  const asked = []
  const actions = { answerApproval: (id, choice) => { asked.push([id, choice]); return Promise.resolve() } }
  const row = mount(RelayEvent, { reply: approvalReply(), bot, sessionId: 'gb', actions })
  buttons(row.tree)[0].props.onClick()
  await settle()
  assert.deepEqual(asked, [['a1', 'reject']])
  assert.deepEqual(texts(row.tree), ['Writer', 'pwsh', 'run the tests', 'You rejected it.'])
  assert.deepEqual(buttons(row.tree), [])
})

test('an approval that expired says so and takes its buttons away', async () => {
  const actions = { answerApproval: () => Promise.reject(new Error('This approval is no longer open')) }
  const row = mount(RelayEvent, { reply: approvalReply(), bot, sessionId: 'gb', actions })
  assert.equal(buttons(row.tree).length, 2)
  buttons(row.tree)[1].props.onClick()
  await settle()
  assert.deepEqual(texts(row.tree), ['Writer', 'pwsh', 'run the tests', 'This approval expired.', 'This approval is no longer open'])
  assert.deepEqual(buttons(row.tree), [])
  assert.deepEqual(nodes(row.tree).filter(node => node.props?.role === 'alert').length, 1)
})

test('a row without an approval id reads as expired and offers nothing to click', () => {
  const legacy = mount(RelayEvent, { reply: approvalReply({ approvalId: undefined, tool: undefined, reason: undefined }), bot, sessionId: 'gb', actions: {} })
  assert.deepEqual(texts(legacy.tree), ['Writer paused for your approval, but that approval has expired and cannot be answered here; ask Writer to ask again.'])
  assert.deepEqual(buttons(legacy.tree), [], 'nothing to answer or open')
  assert.deepEqual(nodes(legacy.tree).filter(node => classesOf(node).includes('bt-appr')), [])
})

test('the recorded answer draws as one line under the member', () => {
  const allowed = mount(RelayEvent, { reply: { kind: 'approval-answer', botId: 'b', name: 'Writer', choice: 'allow', tool: 'pwsh', time: 2 }, bot, sessionId: 'gb', actions: {} })
  assert.deepEqual(texts(allowed.tree), ["You allowed Writer's pwsh"])
  const rejected = mount(RelayEvent, { reply: { kind: 'approval-answer', botId: 'b', name: 'Writer', choice: 'reject', tool: 'pwsh', time: 2 }, bot, sessionId: 'gb', actions: {} })
  assert.deepEqual(texts(rejected.tree), ["You rejected Writer's pwsh"])
  assert.deepEqual(buttons(allowed.tree), [])
})

// A group question (cua's "application access") is answered in the group or in the member's
// own chat: both ways in, and either answer settles the card.
const questionReply = (over = {}) => ({
  kind: 'group-question', requestId: 'q1', botId: 'b', name: 'Writer', sessionId: 'gb',
  questions: [{ id: 'cua-app-access', question: 'Allow Computer Use to control CuoCuo?', options: [{ label: 'Allow for this task' }, { label: 'Deny' }] }],
  time: 3, ...over,
})

test('a group question offers its own options and a way into the member’s chat', async () => {
  const asked = []
  const opened = []
  const actions = { answerGroupQuestion: (id, answers) => { asked.push([id, answers]); return Promise.resolve() }, openRawSession: id => opened.push(id) }
  const row = mount(RelayEvent, { reply: questionReply(), bot, sessionId: 'gb', actions })
  const labels = buttons(row.tree).map(button => button.children.filter(child => typeof child === 'string').join(''))
  assert.deepEqual(labels, ['Allow for this task', 'Deny', 'Open Writer’s chat'])
  buttons(row.tree)[2].props.onClick()
  assert.deepEqual(opened, ['gb'])
  buttons(row.tree)[0].props.onClick()
  await settle()
  assert.deepEqual(JSON.parse(JSON.stringify(asked)), [['q1', [{ id: 'cua-app-access', selected: ['Allow for this task'] }]]])
  assert.deepEqual(buttons(row.tree), [], 'answered here, the card takes its buttons away')
})

test('without a way to open the Session the card only offers its options', () => {
  const row = mount(RelayEvent, { reply: questionReply(), bot, sessionId: 'gb', actions: { answerGroupQuestion: () => Promise.resolve(), canOpenInDsh: false } })
  const labels = buttons(row.tree).map(button => button.children.filter(child => typeof child === 'string').join(''))
  assert.deepEqual(labels, ['Allow for this task', 'Deny'])
})

test('a question answered elsewhere shows as answered, with nothing left to press', () => {
  const row = mount(RelayEvent, { reply: questionReply(), bot, sessionId: 'gb', actions: { answerGroupQuestion: () => Promise.resolve() }, settled: true })
  assert.deepEqual(texts(row.tree).filter(text => text === 'Answered.'), ['Answered.'])
  assert.deepEqual(buttons(row.tree), [])
})
