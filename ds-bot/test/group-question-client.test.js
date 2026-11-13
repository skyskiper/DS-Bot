import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The group card is the only way into a member's question, and the card that answers it is
// DS Bot's own: it is drawn in the Bot's chat, never in the shell's raw view of the
// Session. So the button opens the Bot's chat and the dock that the answer needs appears.
const bundleOf = existing => build({
  stdin: { contents: existing, resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const [cellsBundle, computerBundle] = await Promise.all([
  bundleOf("export { GroupQuestionRow } from './src/client/cells.js'"),
  bundleOf("export { AppAccessDock } from './src/client/computer.js'"),
])

let rendering = null
const slotOf = make => rendering.slots[rendering.cursor++] ??= make()
const react = {
  Fragment: 'Fragment',
  createContext: value => ({ value, Provider: 'Provider', Consumer: 'Consumer' }),
  createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }),
  useCallback: fn => fn,
  useContext: context => context?.value,
  useEffect: () => {},
  useId: () => 'id',
  useLayoutEffect: () => {},
  useMemo: make => make(),
  useRef: value => slotOf(() => ({ current: value })),
  useState: initial => {
    const cell = slotOf(() => ({ value: typeof initial === 'function' ? initial() : initial }))
    return [cell.value, next => { cell.value = next }]
  },
}
const load = bundle => {
  const module = { exports: {} }
  runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: name => (name === 'react' ? react : {}) }, { filename: 'bundle.cjs' })
  return module.exports
}
const cells = load(cellsBundle)
const computer = load(computerBundle)
// Hooks are recorded per component instance; nothing here re-renders, so one pass that
// calls every function component reaches the buttons the tree really draws.
const expand = node => {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(expand)
  if (typeof node.type === 'function') {
    const saved = rendering
    rendering = { slots: [], cursor: 0 }
    let drawn
    try { drawn = node.type(node.props) } finally { rendering = saved }
    return expand(drawn)
  }
  return { ...node, props: { ...node.props, children: expand(node.props?.children) } }
}
const draw = (component, props) => expand({ type: component, props })

const find = (node, test) => {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = find(item, test)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (node === null || typeof node !== 'object') return undefined
  if (test(node)) return node
  return find(node.props?.children, test)
}
const buttons = (node, found = []) => {
  if (Array.isArray(node)) node.forEach(item => buttons(item, found))
  if (node && typeof node === 'object') {
    if (node.type === 'button') found.push(strings(node).join(''))
    for (const key of ['children', 'label', 'title']) if (node.props?.[key]) buttons(node.props[key], found)
  }
  return found
}
const strings = (node, found = []) => {
  if (typeof node === 'string' || typeof node === 'number') found.push(String(node))
  if (Array.isArray(node)) node.forEach(item => strings(item, found))
  if (node && typeof node === 'object') for (const key of ['children', 'label', 'title']) if (node.props?.[key]) strings(node.props[key], found)
  return found
}

const WRITER = { id: 'b1', name: 'Writer', sessionId: 'sess-b1' }
// indexRoster keys a Bot by its id, its current Session and every part: the dock is
// mounted with the conversation's Session id, so both find the same Bot.
const roster = { byId: { b1: WRITER, 'sess-b1': WRITER }, roomsById: {} }
const ask = { id: 'a1', botId: 'b1', sessionId: 'sess-b1', appName: 'Calculator', callId: 'c1' }
const question = { kind: 'group-question', botId: 'b1', sessionId: 'sess-b1', questionId: 'q1' }

// The two surfaces the group card can land on, as the client mounts them: the Bot's own
// chat draws its app-access dock, the shell's raw view draws the Session and nothing else.
const SURFACES = {
  bot: ({ sessionId, actions }) => computer.AppAccessDock({
    sessionId,
    useRoster: pick => pick(roster),
    useCards: () => undefined,
    useHeldCards: () => false,
    useComputer: pick => pick({ asks: { [ask.id]: ask } }),
    actions,
  }),
  raw: () => null,
}
const openFromCard = (reply, { botKnown = true, actions } = {}) => {
  let landed = null
  const app = {
    openSession: id => { landed = { surface: 'bot', sessionId: roster.byId[id]?.sessionId } },
    openRawSession: id => { landed = { surface: 'raw', sessionId: id } },
    computerAppAnswer: async () => true,
    ...actions,
  }
  const tree = draw(cells.GroupQuestionRow, { reply, bot: WRITER, botKnown, actions: app, settled: false })
  const button = find(tree, node => node.type === 'button' && strings(node).join('').startsWith('Open'))
  assert.ok(button, 'the card offers a way into the question')
  button.props.onClick()
  assert.ok(landed, 'the button goes somewhere')
  return { landed, tree, drawn: expand(SURFACES[landed.surface]({ sessionId: landed.sessionId, actions: app })) }
}

test('the group card opens the Bot chat that can answer, not the raw Session', () => {
  const { landed, drawn } = openFromCard(question)
  assert.deepEqual(landed, { surface: 'bot', sessionId: 'sess-b1' })
  assert.deepEqual(buttons(drawn), ['Deny', 'This time', 'Always'])
})

test('a Bot that left the roster falls back to the raw Session', () => {
  const { landed } = openFromCard(question, { botKnown: false })
  assert.deepEqual(landed, { surface: 'raw', sessionId: 'sess-b1' })
})

test('a settled card says so and keeps only the way into the chat', () => {
  const tree = draw(cells.GroupQuestionRow, { reply: question, bot: WRITER, botKnown: true, actions: { openSession: () => {}, openRawSession: () => {} }, settled: true })
  assert.deepEqual(strings(tree).filter(text => text === 'Answered.'), ['Answered.'])
  assert.deepEqual(buttons(tree), ['Open Writer’s chat'])
})
