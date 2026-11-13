import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The strip and its labels are stateless, so their markup is checked without a browser:
// bundle with react external, run with a mock createElement, and read the tree.
const { outputFiles } = await build({
  stdin: { contents: "export { TopicStrip, RecordedLine, TopicBadge, SubtopicTag } from './src/client/topics-strip.js'", resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const react = {
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
}
const module = { exports: {} }
runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: name => (name === 'react' ? react : {}) }, { filename: 'bundle.cjs' })
const { TopicStrip, RecordedLine, TopicBadge, SubtopicTag } = module.exports

const texts = (node, out = []) => {
  if (typeof node === 'string' || typeof node === 'number') out.push(String(node))
  if (Array.isArray(node)) node.forEach(child => texts(child, out))
  if (node && typeof node === 'object') {
    if (node.children !== undefined) texts(node.children, out)
    for (const key of ['label', 'title']) if (node.props?.[key]) texts(node.props[key], out)
  }
  return out
}
// Children only: a badge also carries a title attribute, which is not its text.
const own = node => texts(node?.children ?? [])
const find = (node, test) => {
  if (Array.isArray(node)) { for (const child of node) { const hit = find(child, test); if (hit !== undefined) return hit } return undefined }
  if (node === null || typeof node !== 'object') return undefined
  if (test(node)) return node
  return find(node.children, test)
}
const book = {
  next: 4,
  items: {
    1: { num: 1, title: '群卡作答链路', state: 'active', subs: { 1: { num: 1, title: '回退用例', state: 'active' } } },
    2: { num: 2, title: '话题入口', state: 'active', subs: {} },
    3: { num: 3, title: '已归档的', state: 'archived', archivedAt: 9, subs: {} },
  },
  other: { msgs: [11, 12] },
}

test('the strip is one row while closed, and the list carries the rows plus #Other last', () => {
  const closed = TopicStrip({ book, open: false })
  assert.deepEqual(texts(closed).filter(text => text.startsWith('Topics ·')), ['Topics · 2 active · 1 archived'])
  assert.equal(find(closed, node => node.props?.className === 'bt-topics-list'), undefined, 'closed draws no list')

  const open = TopicStrip({ book, open: true })
  const rows = []
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node && typeof node === 'object') {
      if (node.props?.className === 'bt-topics-row') rows.push(node)
      walk(node.children)
    }
  }
  walk(open)
  assert.deepEqual(rows.map(row => texts(row)[0]), ['#2', '#1', '#3', '#Other'])
})

test('a click on the bar asks for the other state; a row opens that topic', () => {
  const asked = []
  const tree = TopicStrip({ book, open: false, onToggle: next => asked.push(next), onOpen: row => asked.push(row.key) })
  find(tree, node => node.props?.className === 'bt-topics-bar').props.onClick()
  const open = TopicStrip({ book, open: true, onToggle: () => {}, onOpen: row => asked.push(row.key) })
  const rows = []
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node && typeof node === 'object') { if (node.props?.className === 'bt-topics-row') rows.push(node); walk(node.children) }
  }
  walk(open)
  rows.find(row => texts(row)[0] === '#Other').props.onClick()
  assert.deepEqual(asked, [true, 'other'])
})

test('nothing renders while the group has no topic', () => {
  assert.equal(TopicStrip({ book: { items: {}, other: { msgs: [] } }, open: true }), null)
})

test('the receipt, the badge and the subtopic tag name the same number', () => {
  assert.deepEqual(texts(RecordedLine({ num: 3 })), ['→ Recorded as #3'])
  assert.deepEqual(texts(RecordedLine({ num: 3, replaces: 1 })), ['→ #3 replaces #1'])
  assert.deepEqual(own(TopicBadge({ num: 3 })), ['#3'])
  assert.deepEqual(own(SubtopicTag({ sub: '1.1' })), ['#1.1'])
  assert.deepEqual(own(SubtopicTag({ sub: '1.3', title: '回退用例' })), ['#1.3 回退用例'], 'one #, never two')
  assert.equal(RecordedLine({}), null)
  assert.equal(TopicBadge({}), null)
})
