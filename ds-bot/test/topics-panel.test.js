import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The right column's entry and list are stateless, so the markup is read directly.
const { outputFiles } = await build({
  stdin: { contents: "export { TopicEntry, TopicList, TopicThread } from './src/client/topics-panel.js'", resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const react = { Fragment: 'Fragment', createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) }
const module = { exports: {} }
runInNewContext(outputFiles[0].text, { module, exports: module.exports, require: name => (name === 'react' ? react : {}) }, { filename: 'bundle.cjs' })
const { TopicEntry, TopicList, TopicThread } = module.exports

const texts = (node, out = []) => {
  if (typeof node === 'string' || typeof node === 'number') out.push(String(node))
  if (Array.isArray(node)) node.forEach(child => texts(child, out))
  if (node && typeof node === 'object' && node.children !== undefined) texts(node.children, out)
  return out
}
const nodes = (tree, out = []) => {
  if (tree === null || tree === undefined || typeof tree !== 'object') return out
  out.push(tree)
  for (const child of tree.children ?? []) nodes(child, out)
  return out
}
const byClass = (tree, name) => nodes(tree).filter(node => node.props?.className === name)

const book = {
  next: 5,
  items: {
    1: { num: 1, title: '群卡作答链路', state: 'active', subs: { 1: { num: 1, title: '回退用例', state: 'active' } } },
    2: { num: 2, title: '话题入口', state: 'active', subs: {} },
    3: { num: 3, title: '已归档的', state: 'archived', archivedAt: 20, subs: {} },
    4: { num: 4, title: '排队中', state: 'pending', subs: {} },
    5: { num: 5, title: '更早归档', state: 'archived', archivedAt: 10, subs: {} },
  },
  other: { msgs: [7, 8] },
}

test('the entry shows one dot per active topic, up to three, and the counts', () => {
  const tree = TopicEntry({ book })
  assert.equal(byClass(tree, 'bt-topics-dots')[0].children.length, 2)
  assert.deepEqual(texts(tree), ['Topics', '2 active · 1 queued · 2 archived', '›'])
  const many = TopicEntry({ book: { items: { 1: { num: 1, title: 'a', state: 'active' }, 2: { num: 2, title: 'b', state: 'active' }, 3: { num: 3, title: 'c', state: 'active' }, 4: { num: 4, title: 'd', state: 'active' } } } })
  assert.equal(byClass(many, 'bt-topics-dots')[0].children.length, 3, 'at most three dots')
})

test('an empty ledger draws no entry at all', () => {
  assert.equal(TopicEntry({ book: { items: {}, other: { msgs: [] } } }), null)
})

test('the list folds the archived rows into one line, with #Other last', () => {
  const tree = TopicList({ book })
  const cards = nodes(tree).filter(node => node.props?.className === 'bt-topics-card')
  assert.deepEqual(cards.map(card => texts(card)[0].split(' ')[0]), ['#2', '#1', '#4', '#Other'], 'archived rows are folded away')
  assert.deepEqual(texts(nodes(tree).find(node => node.props?.className === 'bt-topics-fold')), ['Archived 2 ›'])
  assert.deepEqual(nodes(tree).filter(node => node.props?.className === 'bt-topics-section-head').map(node => texts(node)[0]), ['Active', 'Queued', 'Unclassified'])

  const opened = TopicList({ book, archivedOpen: true })
  const openCards = nodes(opened).filter(node => node.props?.className === 'bt-topics-card')
  assert.deepEqual(openCards.map(card => texts(card)[0].split(' ')[0]), ['#2', '#1', '#4', '#3', '#5', '#Other'], 'opening drops them in place, newest first')
  assert.deepEqual(nodes(opened).filter(node => node.props?.className === 'bt-topics-section-head').map(node => texts(node)[0]), ['Active', 'Queued', 'Archived', 'Unclassified'])
})

test('an archived row asks to reopen, and waits while the house is full', () => {
  const asked = []
  const open = TopicList({ book, archivedOpen: true, onReopen: num => asked.push(['reopen', num]), onCancelReopen: num => asked.push(['cancel', num]) })
  const reopen = nodes(open).filter(node => node.type === 'button' && texts(node).join('') === 'Reopen')
  assert.equal(reopen.length, 2)
  reopen[0].props.onClick()
  assert.deepEqual(asked, [['reopen', 3]])

  const waiting = TopicList({ book, archivedOpen: true, reopening: [3], onCancelReopen: num => asked.push(['cancel', num]) })
  assert.ok(texts(waiting).includes('已申请重开 · 待排') || texts(waiting).some(text => /Reopen queued/.test(text)), 'the row says it waits')
  const cancel = nodes(waiting).filter(node => node.type === 'button' && texts(node).join('') === 'Cancel')
  assert.equal(cancel.length, 1)
  cancel[0].props.onClick()
  assert.deepEqual(asked.at(-1), ['cancel', 3])
})

test('#Other opens as its own view, and an empty list says so', () => {
  const asked = []
  const tree = TopicList({ book, onOpen: target => asked.push(target) })
  const other = nodes(tree).find(node => node.props?.className === 'bt-topics-card' && texts(node)[0] === '#Other')
  other.props.onClick()
  assert.equal(asked.length, 1)
  assert.equal(asked[0].other, true, 'the Other row opens the unclassified view')
  assert.deepEqual(texts(TopicList({ book: { items: {}, other: { msgs: [] } } })), ['No topics yet'])
})

test('the thread draws oldest first, a day separator once, subtopic tags, and a way to older', () => {
  const asked = []
  const now = Date.now()
  const tree = TopicThread({
    title: '#1 群卡作答链路',
    items: [
      { seq: 11, ts: now, name: 'User', text: '第一句' },
      { seq: 12, ts: now, name: 'Dev', text: '第二句', sub: '1.1', subTitle: '复现' },
      { seq: 13, ts: now, name: 'User', text: '第三句' },
    ],
    hasMore: true,
    onEarlier: () => asked.push('earlier'),
  })
  const days = nodes(tree).filter(node => node.props?.className === 'bt-topics-day')
  assert.equal(days.length, 1, 'one separator for one day')
  assert.deepEqual(texts(days[0]), ['Today'])
  assert.deepEqual(nodes(tree).filter(node => node.props?.className === 'bt-topics-msg').map(node => texts(node)[0]), ['User', 'Dev', 'User'])
  assert.equal(texts(tree).filter(text => text === '#1.1 复现').length, 1, 'one #, not two')
  nodes(tree).find(node => node.type === 'button' && texts(node).join('') === 'Load earlier').props.onClick()
  assert.deepEqual(asked, ['earlier'])
})

test('an empty topic says so, and a message without a time gets no separator', () => {
  assert.deepEqual(texts(TopicThread({ title: '#2 x', items: [] })), ['‹', '#2 x', 'No messages in this topic'])
  const tree = TopicThread({ title: '#3 y', items: [{ seq: 5, ts: null, name: 'User', text: 'kept' }] })
  assert.equal(nodes(tree).filter(node => node.props?.className === 'bt-topics-day').length, 0)
})

test('a message whose text is gone shows a placeholder, not an empty bubble', () => {
  const tree = TopicThread({ title: '#1 x', items: [{ seq: 9, ts: null, name: 'User', text: null }] })
  const gone = nodes(tree).find(node => String(node.props?.className ?? '').includes('bt-topics-msg-gone'))
  assert.ok(gone, 'a placeholder is drawn')
  assert.deepEqual(texts(gone), ['—'])
  assert.equal(gone.props['aria-label'], 'text unavailable')
})

test('the fold line opens and closes the archived rows in place', () => {
  const asked = []
  const tree = TopicList({ book, onToggleArchived: () => asked.push('toggle') })
  nodes(tree).find(node => node.props?.className === 'bt-topics-fold').props.onClick()
  assert.deepEqual(asked, ['toggle'])
})
