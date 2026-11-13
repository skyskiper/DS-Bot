import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The tray's geometry and labels are worked out before React runs, and the chips, the card
// stack and the move menu draw without hooks, so both are read directly.
const root = fileURLToPath(new URL('..', import.meta.url))
const bundle = async (contents) => {
  const { outputFiles } = await build({
    stdin: { contents, resolveDir: root },
    bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
    external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
  })
  const react = { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) }
  const module = { exports: {} }
  const window = { innerWidth: 1920, innerHeight: 969, addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval, localStorage: { getItem: () => null, setItem() {} } }
  runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: name => (name === 'react' ? react : {}), window, document: { querySelector: () => null }, console, setTimeout, clearTimeout, setInterval, clearInterval, fetch: () => Promise.reject(new Error('no network in a unit test')) }, { filename: 'bundle.cjs' })
  return module.exports
}
const view = await bundle("export * from './src/client/topics-view.js'")
const tray = await bundle("export { TopicsTray, TopicsStack, TOPICS_TRAY_CSS } from './src/client/topics-tray.js'")
const panel = await bundle("export { TopicMoveMenu } from './src/client/topics-panel.js'")

const nodes = (tree, out = []) => {
  if (tree === null || tree === undefined || typeof tree !== 'object') return out
  out.push(tree)
  for (const child of tree.children ?? []) nodes(child, out)
  return out
}
const texts = (node, out = []) => {
  if (typeof node === 'string' || typeof node === 'number') out.push(String(node))
  if (Array.isArray(node)) node.forEach(child => texts(child, out))
  if (node && typeof node === 'object' && node.children !== undefined) texts(node.children, out)
  return out
}

// Three topics, #1 carrying three subtopics: the design's own example, six chips.
const book = {
  next: 4,
  items: {
    1: { num: 1, title: '群卡作答链路', state: 'active', createdAt: 10, subs: { 1: { title: '复现', state: 'active', lastAt: 11 }, 2: { title: '回退用例', state: 'active', lastAt: 12 }, 3: { title: '截断用例', state: 'active', lastAt: 13 } } },
    2: { num: 2, title: '话题入口', state: 'active', createdAt: 20, subs: {} },
    3: { num: 3, title: '打包校验', state: 'active', createdAt: 30, subs: {} },
  },
  other: { msgs: [90, 91] },
}

test('six chips for three topics and one topic\'s subtopics, 186 high, the active one last', () => {
  const chips = view.chipsOf(book, 3)
  assert.equal(chips.length, 6)
  assert.equal(view.chipsHeight(chips), 186, '26 + 3x22 + 4x3 + 8x2 + 40')
  assert.deepEqual(Array.from(chips, chip => (chip.kind === 'sub' ? chip.label : `#${chip.num}`)), ['#1', '#1.1', '#1.2', '#1.3', '#2', '#3'])
  assert.equal(chips.at(-1).active, true, 'the active topic is pinned at the column bottom')
  assert.equal(chipsHeightOverLimit(chips), false)
})

const chipsHeightOverLimit = chips => view.chipsHeight(chips) > view.TRAY_MAX

test('the column scrolls only past its own cap, and nothing folds away', () => {
  const many = { items: {} }
  for (let num = 1; num <= 12; num += 1) many.items[num] = { num, title: `t${num}`, state: 'active', createdAt: num, subs: {} }
  const chips = view.chipsOf(many, 12)
  assert.equal(chips.length, 12, 'every topic is still drawn')
  assert.equal(chipsHeightOverLimit(chips), true, 'past 320 the column scrolls instead of dropping a chip')
})

test('a queued topic waits in the column list, not in the chip column', () => {
  const queued = structuredClone(book)
  queued.items[2].state = 'pending'
  const chips = view.chipsOf(queued, 1)
  assert.equal(chips.length, 5, 'only the two active topics and the three subtopics of #1')
  assert.equal(Array.from(chips).some(chip => chip.num === 2), false, 'the queued one is not a chip')
})

test('the active topic owns the column bottom even when it carries subtopics', () => {
  const chips = view.chipsOf(book, 1)
  assert.equal(chips.at(-1).active, true, 'the capsule is the last chip')
  assert.equal(chips.at(-1).kind, 'topic', 'its subtopics sit above it, not below')
  assert.deepEqual(Array.from(chips, chip => (chip.kind === 'sub' ? chip.label : `#${chip.num}`)), ['#2', '#3', '#1.1', '#1.2', '#1.3', '#1'], 'the active group ends the column')
  assert.equal(view.chipsHeight(chips), 186, 'the same six chips still measure 186')
})

test('a subtopic never draws its own # twice', () => {
  const chips = view.chipsOf(book, 1)
  const sub = chips.find(chip => chip.sub === 2)
  assert.equal(sub.label, '#1.2')
  assert.equal(sub.title, '回退用例')
})

test('a message landing in another topic is found by the topic whose count grew', () => {
  const after = structuredClone(book)
  after.items[2].messages = [77]
  after.items[2].events = [{ at: 40, kind: 'attach' }]
  assert.equal(JSON.stringify(view.landedIn(book, after)), JSON.stringify({ num: 2, title: '话题入口' }))

  const deeper = structuredClone(book)
  deeper.items[1].subs[2].messages = [78]
  deeper.items[1].subs[2].lastAt = 44
  assert.equal(JSON.stringify(view.landedIn(book, deeper)), JSON.stringify({ num: 1, sub: 2, title: '群卡作答链路' }))
  assert.equal(view.landedIn(book, book), undefined, 'no change, nothing lands')
})

test('a card says what is in the topic, or that nothing is yet', () => {
  const now = 1000000
  assert.equal(view.cardMeta({ num: 1, state: 'active', subs: {}, createdAt: now - 3000 }, now), 'No messages yet')
  const full = { num: 2, state: 'active', createdAt: now - 4000, messages: [1, 2], subs: { 1: { title: 'a', state: 'active', lastAt: now - 3000, messages: [3] }, 2: { title: 'b', state: 'archived', lastAt: now - 2000 } } }
  assert.equal(view.cardMeta(full, now), '1 subtopics · 3 messages · just now')
  assert.equal(view.timeAgo(now - 500, now), 'just now')
  assert.equal(view.timeAgo(now - 120000, now), '2m ago')
})

test('the move menu offers every live topic and a way back to #Other', () => {
  const targets = view.moveTargets(book)
  assert.deepEqual(Array.from(targets, target => target.label), ['#3', '#2', '#1'], 'newest first, archived ones left out')
  const asked = []
  const tree = panel.TopicMoveMenu({
    item: { seq: 90 },
    targets,
    onPick: num => asked.push(['pick', num]),
    onKeep: () => asked.push(['keep']),
    onClose: () => asked.push(['close']),
  })
  const rows = nodes(tree).filter(node => node.props?.className === 'bt-topics-move-row')
  assert.equal(rows.length, 4)
  rows[0].props.onClick()
  rows.at(-1).props.onClick()
  assert.equal(JSON.stringify(asked), JSON.stringify([['pick', 3], ['keep']]))
  assert.ok(texts(tree).includes('Move to a topic'))
  assert.ok(texts(tree).includes('Keep in #Other'))
})

test('the collapsed column draws every chip, its #N and its title', () => {
  const chips = view.chipsOf(book, 3)
  const asked = []
  const tree = tray.TopicsTray({
    chips, activeNum: 3, landing: null, anchor: { right: 24, bottom: 120 },
    onActivate: num => asked.push(['activate', num]),
    onExpand: () => asked.push(['expand']),
  })
  const chipNodes = nodes(tree).filter(node => node.props?.className === 'bt-topic-chip')
  assert.equal(chipNodes.length, 6)
  assert.deepEqual(texts(chipNodes[0]), ['#1', '群卡作答链路'])
  assert.equal(chipNodes.at(-1).props['data-active'], '', 'the active topic is the capsule')
  chipNodes[0].props.onClick()
  chipNodes.at(-1).props.onClick()
  assert.equal(JSON.stringify(asked), JSON.stringify([['activate', 1], ['expand']]), 'an inactive chip activates it; the active one expands')
  assert.equal(tree.props.style.right, 24)
  assert.equal(tree.props.style.bottom, 120)
})

test('the column carries a handle that opens the stack without guessing which chip is live', () => {
  const asked = []
  const tree = tray.TopicsTray({ chips: view.chipsOf(book, 3), anchor: { right: 24, bottom: 120 }, onExpand: () => asked.push('expand'), onActivate: () => asked.push('activate') })
  const handle = nodes(tree).find(node => node.props?.className === 'bt-topics-open')
  assert.ok(handle, 'the handle is in the DOM from the first paint')
  handle.props.onClick()
  assert.equal(JSON.stringify(asked), JSON.stringify(['expand']))
})

test('a landing slip names the speaker and the chip it hit', () => {
  const chips = view.chipsOf(book, 3)
  const tree = tray.TopicsTray({
    chips, activeNum: 3, anchor: { right: 24, bottom: 120 },
    landing: { key: 'n1.2', num: 1, sub: 2, subTitle: '回退用例', name: 'Dev', seq: 5 },
  })
  const fly = nodes(tree).find(node => node.props?.className === 'bt-topics-fly')
  assert.ok(fly, 'the slip is drawn')
  assert.deepEqual(texts(fly), ['D', 'Dev', '#1 › 回退用例'])
  assert.equal(nodes(tree).find(node => node.props?.['data-landed'] !== undefined).props['data-landed'], '')
})

test('the card stack draws one card per live topic with its meta line', () => {
  const asked = []
  const tree = tray.TopicsStack({
    book, activeNum: 2, cards: Object.values(book.items),
    onPick: (num, rect) => asked.push(['pick', num, rect !== undefined]),
    onCollapse: () => asked.push(['collapse']),
  })
  const cards = nodes(tree).filter(node => node.props?.className === 'bt-topics-tcard')
  assert.equal(cards.length, 3)
  assert.deepEqual(texts(cards[0]).slice(0, 2), ['#1', '群卡作答链路'])
  assert.equal(cards[1].props['data-active'], '')
  cards[0].props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 500, top: 300, height: 64 }) } })
  assert.equal(JSON.stringify(asked[0]), JSON.stringify(['pick', 1, true]))
  assert.ok(texts(tree).includes('Collapse ↓'))
})
