import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { JSDOM } = createRequire(join(process.env.DSH_HARNESS ?? join(PLUGIN, '..', 'deepseek-harness'), 'package.json'))('jsdom')

// The viewer draws with React; bundle it with React external and call its decisions and
// its first render directly (effects need a browser).
const bundle = await build({
  stdin: { contents: "export { imagesInView, openImageAt, imageClickHandler, ImageViewer } from './src/client/image-viewer.js'", resolveDir: PLUGIN },
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
const { window } = new JSDOM('<main id="chat"></main>')
const { document } = window
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports, require: name => (name === 'react' ? react : {}),
  document, Element: window.Element, MouseEvent: window.MouseEvent,
})
const { imagesInView, openImageAt, imageClickHandler, ImageViewer } = module.exports

// The conversation as the transcript draws it: a Bot's Markdown picture, a user's
// attachment tile, and a group member's picture, in that order.
function transcript() {
  document.body.innerHTML = `
    <main id="chat">
      <div class="bt-astack"><div class="bt-msg"><div class="bt-bubble"><p><img src="https://example.test/a.png" alt="第一张"></p></div></div></div>
      <div class="bt-umsg"><div class="bt-uimgs"><button class="bt-uimg"><img src="https://example.test/b.png" alt="附件"></button></div></div>
      <div class="bt-astack"><div class="bt-msg"><div class="bt-msg-line"><div class="bt-bubble"><p><img src="https://example.test/c.png"></p></div></div></div></div>
      <img src="https://example.test/elsewhere.png" alt="不在会话里">
    </main>`
}

test('the pager reads the transcript\'s images in the order they appear', () => {
  transcript()
  assert.deepEqual(JSON.parse(JSON.stringify(imagesInView())), [
    { src: 'https://example.test/a.png', label: '第一张' },
    { src: 'https://example.test/b.png', label: '附件' },
    { src: 'https://example.test/c.png', label: '' },
  ])
})

test('clicking a conversation image opens the pager at that image', () => {
  transcript()
  const opened = []
  const actions = { openImageViewer: (images, index) => opened.push({ images, index }) }
  const img = document.querySelector('[src="https://example.test/b.png"]')
  assert.equal(openImageAt(img, actions), true)
  assert.equal(opened.length, 1)
  assert.equal(opened[0].index, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(opened[0].images.map(entry => entry.src))), [
    'https://example.test/a.png',
    'https://example.test/b.png',
    'https://example.test/c.png',
  ])
  // An image outside the conversation is left to whatever owns it.
  assert.equal(openImageAt(document.querySelector('[src="https://example.test/elsewhere.png"]'), actions), false)
})

// The first and last image stop the arrows instead of wrapping, and the count says
// where the viewer is.
const images = [
  { src: 'https://example.test/a.png', label: '第一张' },
  { src: 'https://example.test/b.png', label: '第二张' },
  { src: 'https://example.test/c.png', label: '第三张' },
]

function navOf(index) {
  const tree = ImageViewer({ viewer: { images, index }, actions: { closeImageViewer() {} } })
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
  const first = navOf(0)
  assert.equal(first.count, '1 / 3')
  assert.equal(first.prev.props.disabled, true)
  assert.equal(first.next.props.disabled, false)
  const middle = navOf(1)
  assert.equal(middle.count, '2 / 3')
  assert.equal(middle.prev.props.disabled, false)
  assert.equal(middle.next.props.disabled, false)
  const last = navOf(2)
  assert.equal(last.count, '3 / 3')
  assert.equal(last.prev.props.disabled, false)
  assert.equal(last.next.props.disabled, true)
})

test('a viewer opened without images shows no counter', () => {
  const tree = ImageViewer({ viewer: { images: [], index: 0 }, actions: { closeImageViewer() {} } })
  const found = []
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!node || typeof node !== 'object') return
    if (node.props?.['data-side'] !== undefined) found.push(node)
    walk(node.children)
  }
  walk(tree)
  assert.equal(found.length, 2)
  assert.equal(found.every(node => node.props.disabled === true), true)
})

// The shell's Markdown opens its own single-image lightbox on the same click. The bubble
// handler takes the click first, so only the pager opens.
test('a bubble takes the image click before the shell lightbox does', () => {
  transcript()
  const opened = []
  const actions = { openImageViewer: (images, index) => opened.push(index) }
  const img = document.querySelector('[src="https://example.test/a.png"]')
  let shell = 0
  // The shell's handler sits on the image itself and runs in the bubble phase.
  img.addEventListener('click', () => { shell += 1 })
  const event = new document.defaultView.MouseEvent('click', { bubbles: true, cancelable: true })
  const handler = imageClickHandler(actions)
  img.addEventListener('click', (native) => { handler({ target: native.target, preventDefault: () => native.preventDefault(), stopPropagation: () => native.stopPropagation() }) }, { capture: true })
  img.dispatchEvent(event)
  assert.equal(event.defaultPrevented, true)
  assert.equal(opened.length, 1)
  assert.equal(shell, 0)
})
