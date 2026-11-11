import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// The viewer draws with React; bundle it with React external and call its decisions and
// its first render directly (effects need a browser).
const bundle = await build({
  stdin: { contents: "export { registerImages, galleryOf, MessageImages, ImageViewer } from './src/client/image-viewer.js'", resolveDir: dirname(dirname(fileURLToPath(import.meta.url))) },
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
const { registerImages, galleryOf, ImageViewer } = module.exports
const plain = value => JSON.parse(JSON.stringify(value))

test('the gallery lists one conversation\'s images in message order', () => {
  const offLate = registerImages('s1', 5, [{ key: '5:0', attachment: { id: 'a' } }, { key: '5:1', attachment: { id: 'b' } }])
  const offEarly = registerImages('s1', 3, [{ key: '3:0', attachment: { id: 'c' } }])
  const offOther = registerImages('s2', 1, [{ key: '1:0', attachment: { id: 'z' } }])
  assert.deepEqual(plain(galleryOf('s1').map(entry => entry.key)), ['3:0', '5:0', '5:1'])
  // A Session's images never leak into another's list.
  assert.deepEqual(plain(galleryOf('s2').map(entry => entry.key)), ['1:0'])
  // A message that leaves the transcript takes its images with it.
  offEarly()
  assert.deepEqual(plain(galleryOf('s1').map(entry => entry.key)), ['5:0', '5:1'])
  offLate()
  offOther()
  assert.deepEqual(plain(galleryOf('s1')), [])
})

// The first and last image stop the arrows instead of wrapping, and the count says
// where the viewer is.
function navOf(viewer) {
  const tree = ImageViewer({ viewer, actions: { loadImage: () => new Promise(() => {}), closeImageViewer() {} } })
  const found = { prev: null, next: null, count: '' }
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!node || typeof node !== 'object') return
    const side = node.props?.['data-side']
    if (side === 'prev' || side === 'next') found[side] = node
    if (node.props?.className === 'bt-imgview-count') found.count = (node.children ?? []).map(String).join('')
    walk(node.children)
  }
  walk(tree)
  return found
}

test('the viewer pages through three images and stops at both ends', () => {
  const off = registerImages('s1', 1, [
    { key: '1:0', attachment: { id: 'a' } },
    { key: '1:1', attachment: { id: 'b' } },
    { key: '1:2', attachment: { id: 'c' } },
  ])
  const first = navOf({ sessionId: 's1', key: '1:0' })
  assert.equal(first.count, '1 / 3')
  assert.equal(first.prev.props.disabled, true)
  assert.equal(first.next.props.disabled, false)
  const middle = navOf({ sessionId: 's1', key: '1:1' })
  assert.equal(middle.count, '2 / 3')
  assert.equal(middle.prev.props.disabled, false)
  assert.equal(middle.next.props.disabled, false)
  const last = navOf({ sessionId: 's1', key: '1:2' })
  assert.equal(last.count, '3 / 3')
  assert.equal(last.prev.props.disabled, false)
  assert.equal(last.next.props.disabled, true)
  off()
})

test('a viewer opened without images shows no counter', () => {
  const empty = navOf({ sessionId: 'missing', key: 'x:0' })
  assert.equal(empty.count, '')
  assert.equal(empty.prev.props.disabled, true)
  assert.equal(empty.next.props.disabled, true)
})
