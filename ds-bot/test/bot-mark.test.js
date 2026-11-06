import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const bundle = await build({
  stdin: { contents: "export { botState, BotAvatar, BotMark, RoomAvatar } from './src/client/mark.js'\nexport { SHELL_CSS } from './src/client/styles.js'", resolveDir: dirname(dirname(fileURLToPath(import.meta.url))) },
  bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
// A test can queue the values the next useState calls return, and read what was set.
const states = []
const sets = []
const react = {
  createContext: (initial) => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx },
  useContext: ctx => ctx.value,
  useMemo: make => make(),
  useCallback: fn => fn,
  useId: () => 'dv-id',
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: initial => [states.length > 0 ? states.shift() : initial, value => sets.push(value)], useEffect: () => {}, useRef: current => ({ current }), useLayoutEffect: () => {}, Fragment: 'fragment',
}
runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require: name => (name === 'react' ? react : {}) })
const { botState, BotAvatar, BotMark, RoomAvatar, SHELL_CSS } = module.exports

test('a Bot that waits for work it handed on has a mark of its own, behind a running turn and a question', () => {
  assert.equal(botState(false, 'waiting', false), 'waiting')
  // A turn of its own runs: the turn shows, not the wait.
  assert.equal(botState(true, 'waiting', false), 'working')
  assert.equal(botState(true, 'searching', false), 'searching')
  assert.equal(botState(false, 'waiting', true), 'alert')
  assert.equal(botState(false, undefined, false), 'idle')
  // It moves like a Bot coordinating its teammates.
  assert.match(SHELL_CSS, /\.bt-mark:is\(\[data-state=orbit\],\[data-state=waiting\]\) \.bt-b\{animation:bt-sway/)
})

test('a waiting Bot does not wear the working badge, since no turn of it runs', () => {
  const badges = state => BotAvatar({ bot: { id: 'b', name: 'Writer' }, size: 36, state }).children.slice(1).filter(Boolean).map(child => child.props.className)
  assert.deepEqual(badges('waiting'), [])
  assert.deepEqual(badges('working'), ['bt-badge bt-badge-working'])
})

test('a group with its own photo wears it at every size, the inline sizes included', () => {
  const photo = 'data:image/webp;base64,UklGRg=='
  const room = { id: 'r1', members: ['a', 'b'], avatar: photo }
  const roster = { byId: {} }
  for (const size of [112, 36, 16]) {
    const mark = RoomAvatar({ room, roster, size })
    assert.deepEqual([mark.props.style.width, mark.props.style.height], [size, size])
    // Idle, so the photo states that follow a Bot never animate a group icon.
    assert.equal(mark.props['data-state'], 'idle')
    const img = mark.children[0]
    assert.equal(img.type, 'img')
    assert.equal(img.props.src, photo)
    assert.equal(img.props.className, 'bt-mark-img')
    // A photo that does not load falls back to the members, as a Bot's does.
    assert.equal(typeof img.props.onError, 'function')
  }
  // Without one the members make the icon, and the inline sizes line them up.
  const filled = { byId: { a: { id: 'a' }, b: { id: 'b' } } }
  const fallback = RoomAvatar({ room: { ...room, avatar: undefined }, roster: filled, size: 16 })
  assert.equal(fallback.props.className, 'bt-stack')
  // An empty string counts as no photo, as an old team's state may hold.
  assert.equal(RoomAvatar({ room: { ...room, avatar: '' }, roster: filled, size: 16 }).props.className, 'bt-stack')
})

test('a photo that does not load shows the Bot\'s character instead', () => {
  const photo = 'data:image/png;base64,iVBORw0KGgo='
  const bot = { id: 'b', name: 'Writer', avatar: { shape: 'fox', image: photo } }
  const img = BotMark({ bot }).children[0]
  assert.equal(img.type, 'img')
  sets.length = 0
  img.props.onError()
  assert.deepEqual(sets, [photo])
  // Rendered again with that photo marked broken: the character, not an empty image.
  states.push(false, photo)
  const mark = BotMark({ bot })
  assert.equal(mark.children[0].type, 'svg')
  assert.notEqual(mark.props['data-shape'], 'image')
  // A new photo is tried again.
  states.push(false, photo)
  assert.equal(BotMark({ bot: { ...bot, avatar: { ...bot.avatar, image: `${photo}AA` } } }).children[0].type, 'img')
})
